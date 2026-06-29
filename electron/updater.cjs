const { app, BrowserWindow, nativeImage, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const { spawn } = require('child_process');

// ── Module-level state ─────────────────────────────────────────────────
let mainWindowRef = null;
let updaterCanClose = false;
let activeDownload = null; // { cancel: fn }

// Download state — persisted so renderer can query it
const downloadState = {
  version: null,
  path: null,
  status: 'idle', // idle | downloading | ready | error
  error: null,
};

// ── Helpers ─────────────────────────────────────────────────────────────
const log = (...args) => console.log('[updater]', ...args);
const logErr = (...args) => console.error('[updater]', ...args);

function downloadsDir() {
  const dir = path.join(app.getPath('temp'), 'callerflash-updates');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function exePathFor(version) {
  return path.join(downloadsDir(), `CallerFlash-${version}.exe`);
}

function loadAppIcon() {
  const resPath = process.resourcesPath || '';
  for (const iconPath of [
    path.join(resPath, 'cflogo.png'),
    path.join(resPath, 'cflogo.ico'),
    path.join(__dirname, '../buildResources/cflogo.png'),
    path.join(__dirname, '../buildResources/cflogo.ico'),
  ]) {
    try {
      const img = nativeImage.createFromPath(iconPath);
      if (!img.isEmpty()) return img;
    } catch { /* continue */ }
  }
  return nativeImage.createEmpty();
}

// ── Send to main window ────────────────────────────────────────────────
function sendStatus(payload) {
  log('sendStatus:', JSON.stringify(payload), '| mainWindowRef:', mainWindowRef ? (mainWindowRef.isDestroyed() ? 'destroyed' : 'OK') : 'null');
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    mainWindowRef.webContents.send('updater:status', payload);
  }
}

function sendProgress(payload) {
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    mainWindowRef.webContents.send('updater:progress', payload);
  }
}

// ── Friendly version ───────────────────────────────────────────────────
function friendlyVersion(version) {
  if (!version) return 'Unknown';
  const v = version.replace(/^v/, '').replace(/^0\.0\.0-/, '');
  // Match nightly-YYYYMMDD-N or nightly.YYYYMMDD.N (both separators)
  const nightly = v.match(/^nightly[.\-](\d{4})(\d{2})(\d{2})(?:[.\-](\d+))?$/i);
  if (nightly) {
    const [, y, m, d, n] = nightly;
    return `Nightly ${y}.${m}.${d}${n ? ' #' + n : ''}`;
  }
  if (/beta/i.test(v)) return `Beta ${v.replace(/[.\-]beta.*/, '')}`;
  return `Version ${v}`;
}

// ── Fetch JSON from URL ────────────────────────────────────────────────
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const transport = parsed.protocol === 'https:' ? https : http;
    const req = transport.get(url, {
      headers: { 'User-Agent': 'CallerFlash-Updater', Accept: 'application/json' },
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return fetchJson(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      let body = '';
      res.on('data', (c) => body += c);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error('Invalid JSON')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(new Error('Timeout')); });
  });
}

// ── Nightly version parsing ───────────────────────────────────────────
// Nightly tags: nightly-YYYYMMDD-N  (e.g., nightly-20260629-17)
// Installed version may be: "0.0.0-nightly.20260629-17" or "1.4.2"
function parseNightly(str) {
  if (!str || typeof str !== 'string') return null;
  // Strip leading 'v' and '0.0.0-' prefix
  const cleaned = str.replace(/^v/, '').replace(/^0\.0\.0-/, '');
  // Match nightly-YYYYMMDD or nightly.YYYYMMDD with optional -N or .N suffix
  const m = cleaned.match(/^nightly[.\-](\d{8})(?:[.\-](\d+))?$/i);
  if (!m) return null;
  return { date: m[1], index: parseInt(m[2] || '0', 10) };
}

// Compare two nightly info objects. Returns 1 if a > b, -1 if a < b, 0 if equal.
function compareNightly(a, b) {
  if (a.date > b.date) return 1;
  if (a.date < b.date) return -1;
  if (a.index > b.index) return 1;
  if (a.index < b.index) return -1;
  return 0;
}

// Simple semver comparison (x.y.z). Returns 1 if a > b, -1 if a < b, 0 if equal.
function compareSemver(a, b) {
  const pa = a.replace(/^v/, '').replace(/[-+].*/, '').split('.').map(Number);
  const pb = b.replace(/^v/, '').replace(/[-+].*/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const na = pa[i] || 0, nb = pb[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

// ── STRICT channel filtering ───────────────────────────────────────────
// No cross-channel fallback. Each channel only matches its own releases.
function findRelease(releases, channel) {
  if (!Array.isArray(releases) || !releases.length) return null;

  if (channel === 'stable') {
    // Stable: NOT a prerelease, NO beta/nightly in tag
    const stable = releases.filter((r) =>
      !r.prerelease && !r.draft &&
      !/beta/i.test(r.tag_name) &&
      !/nightly/i.test(r.tag_name)
    );
    if (!stable.length) return null;
    // Pick the one with the highest semver tag
    stable.sort((a, b) => {
      const c = compareSemver(b.tag_name, a.tag_name);
      return c !== 0 ? c : new Date(b.published_at || 0) - new Date(a.published_at || 0);
    });
    return stable[0] || null;
  }
  if (channel === 'beta') {
    // Beta: tag must contain "beta"
    const betas = releases.filter((r) => /beta/i.test(r.tag_name) && !r.draft);
    if (!betas.length) return null;
    betas.sort((a, b) => {
      const c = compareSemver(b.tag_name, a.tag_name);
      return c !== 0 ? c : new Date(b.published_at || 0) - new Date(a.published_at || 0);
    });
    return betas[0] || null;
  }
  // Nightly: tag must match nightly-YYYYMMDD-N pattern
  const nightlies = releases.filter((r) => parseNightly(r.tag_name) !== null && !r.draft);
  if (!nightlies.length) return null;
  // Sort by nightly date+index descending (newest first)
  nightlies.sort((a, b) => {
    const na = parseNightly(a.tag_name);
    const nb = parseNightly(b.tag_name);
    return compareNightly(nb, na); // descending
  });
  return nightlies[0] || null;
}

function getExeUrl(release) {
  const exe = (release.assets || []).find((a) => /\.exe$/i.test(a.name));
  return exe ? exe.browser_download_url : null;
}

// ── Check for updates ──────────────────────────────────────────────────
async function checkForUpdates(channel) {
  log('checking channel:', channel);

  const releases = await fetchJson('https://api.github.com/repos/jaydenrussell/CallerFlash/releases');
  if (!Array.isArray(releases)) return { error: 'Invalid GitHub response' };

  const release = findRelease(releases, channel);
  if (!release) {
    log('no release for channel:', channel);
    return { upToDate: true, version: app.getVersion() };
  }

  const releaseVersion = release.tag_name.replace(/^v/, '');
  const currentVersion = app.getVersion();

  log('found release:', releaseVersion, '| installed:', currentVersion);

  // ── Nightly channel comparison ──────────────────────────────────────
  if (channel === 'nightly') {
    const releaseNightly = parseNightly(release.tag_name);
    const currentNightly = parseNightly(currentVersion);

    log('release nightly info:', JSON.stringify(releaseNightly),
        '| current nightly info:', JSON.stringify(currentNightly));

    if (releaseNightly && currentNightly) {
      // Both are nightly — compare date then index
      const cmp = compareNightly(releaseNightly, currentNightly);
      if (cmp <= 0) {
        log('nightly: release is same or older than installed → up to date');
        return { upToDate: true, version: currentVersion };
      }
    } else if (releaseNightly && !currentNightly) {
      // Current version is NOT a nightly (e.g., "1.4.2") — any nightly is newer
      log('nightly: current version is not a nightly build, offering update');
    } else if (!releaseNightly) {
      // Release didn't parse as nightly (shouldn't happen given findRelease filter)
      log('nightly: release tag did not parse as nightly → up to date');
      return { upToDate: true, version: currentVersion };
    }
    // Fall through to offer the update
  }

  // ── Stable/Beta channel comparison ─────────────────────────────────
  if (channel === 'stable') {
    const cmp = compareSemver(releaseVersion, currentVersion);
    if (cmp <= 0) {
      log('stable: release is same or older than installed → up to date');
      return { upToDate: true, version: currentVersion };
    }
  }

  if (channel === 'beta') {
    const releaseBase = releaseVersion.replace(/[-+].*/, '');
    const currentBase = currentVersion.replace(/^v/, '').replace(/[-+].*/, '');
    const cmp = compareSemver(releaseBase, currentBase);
    if (cmp <= 0) {
      log('beta: release is same or older than installed → up to date');
      return { upToDate: true, version: currentVersion };
    }
  }

  const downloadUrl = getExeUrl(release);
  const releaseDate = new Date(release.published_at || release.created_at);
  return {
    version: releaseVersion,
    friendlyName: friendlyVersion(releaseVersion),
    downloadUrl,
    releaseDate: releaseDate.toISOString(),
  };
}

// ── Download update (background, no UI window) ─────────────────────────
async function downloadUpdate(channel, version, downloadUrl) {
  log('downloadUpdate START: channel=' + channel + ' version=' + version);
  if (activeDownload) { log('download already in progress'); return { status: 'busy' }; }

  const destPath = exePathFor(version);
  log('downloadUpdate: destPath=' + destPath);

  // Already downloaded?
  if (fs.existsSync(destPath)) {
    log('already downloaded:', destPath);
    downloadState.version = version;
    downloadState.path = destPath;
    downloadState.status = 'ready';
    downloadState.error = null;
    sendStatus({ status: 'ready', version });
    return { status: 'ready', path: destPath };
  }

  if (!downloadUrl) {
    log('ERROR: no download URL provided');
    downloadState.status = 'error';
    downloadState.error = 'No download URL';
    sendStatus({ status: 'error', message: 'No download URL' });
    return { status: 'error', error: 'No URL' };
  }

  // Clean old downloads
  try {
    for (const f of fs.readdirSync(downloadsDir())) {
      if (f.endsWith('.exe') && !f.includes(version)) {
        fs.unlinkSync(path.join(downloadsDir(), f));
      }
    }
  } catch {}

  log('downloading:', downloadUrl, '→', destPath);
  downloadState.status = 'downloading';
  downloadState.version = version;
  sendStatus({ status: 'downloading', version });

  try {
    await new Promise((resolve, reject) => {
      const parsed = new URL(downloadUrl);
      const transport = parsed.protocol === 'https:' ? https : http;
      const file = fs.createWriteStream(destPath);

      const req = transport.get(downloadUrl, {
        headers: { 'User-Agent': 'CallerFlash-Updater' },
      }, (res) => {
        log('download: response statusCode=' + res.statusCode);
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          log('download: following redirect to', res.headers.location);
          // Follow redirect by recursing
          downloadUpdate(channel, version, res.headers.location).then(resolve).catch(reject);
          return;
        }
        if (res.statusCode !== 200) {
          file.close();
          return reject(new Error(`HTTP ${res.statusCode}`));
        }

        const total = parseInt(res.headers['content-length'] || '0', 10);
        let received = 0;
        log('download: content-length=' + total);

        res.on('data', (chunk) => {
          received += chunk.length;
          const pct = total > 0 ? Math.round((received / total) * 100) : 0;
          sendProgress({ pct, received, total });
        });

        res.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve();
        });
      });

      req.on('error', reject);
      req.setTimeout(120000, () => { req.destroy(new Error('Download timeout')); });
    });

    activeDownload = null;
    downloadState.version = version;
    downloadState.path = destPath;
    downloadState.status = 'ready';
    downloadState.error = null;
    log('download complete:', destPath);
    sendStatus({ status: 'ready', version });
    return { status: 'ready', path: destPath };
  } catch (err) {
    activeDownload = null;
    downloadState.status = 'error';
    downloadState.error = err.message;
    logErr('download failed:', err.message);
    try { fs.unlinkSync(destPath); } catch {}
    sendStatus({ status: 'error', message: err.message });
    return { status: 'error', error: err.message };
  }
}

// ── Auto-download on startup (background, no UI) ───────────────────────
async function autoDownload(channel) {
  log('auto-download check for channel:', channel);
  try {
    const result = await checkForUpdates(channel);
    if (result?.version && result.downloadUrl) {
      log('auto-download: update found, downloading in background');
      // Download silently — no UI window
      return await downloadUpdate(channel, result.version, result.downloadUrl);
    }
    log('auto-download: up to date');
    return { status: 'up-to-date' };
  } catch (err) {
    logErr('auto-download failed:', err.message);
    return { status: 'error', error: err.message };
  }
}

// ── Install update ─────────────────────────────────────────────────────
function installUpdate(version) {
  log('installUpdate START: version=' + version);
  const exePath = exePathFor(version);
  log('installUpdate: path=' + exePath + ' exists=' + fs.existsSync(exePath));
  if (!fs.existsSync(exePath)) {
    sendStatus({ status: 'error', message: 'File not found. Download again.' });
    return { status: 'error' };
  }

  sendStatus({ status: 'installing', message: 'Starting installer…' });

  // Spawn helper process that waits for us to exit, then runs NSIS
  const helperPath = path.join(__dirname, 'updater-helper.cjs');
  const appExe = process.execPath;
  const installDir = path.dirname(appExe);

  log('spawning helper:', helperPath);
  log('  installer:', exePath);
  log('  app:', appExe);
  log('  dir:', installDir);
  log('  pid:', process.pid);

  try {
    const helper = spawn(process.execPath, [
      helperPath,
      '--installer', exePath,
      '--app', appExe,
      '--dir', installDir,
      '--pid', String(process.pid),
    ], { detached: true, stdio: 'ignore', windowsHide: true });
    helper.unref();
  } catch (err) {
    logErr('failed to spawn helper:', err.message);
    sendStatus({ status: 'error', message: 'Failed to start installer' });
    return { status: 'error' };
  }

  // Quit after a delay to let helper spawn
  setTimeout(() => {
    updaterCanClose = true;
    app.quit();
  }, 1500);

  return { status: 'installing' };
}

// ── Get download state (for renderer queries) ──────────────────────────
function getDownloadState() {
  return { ...downloadState };
}

// ── IPC handlers ───────────────────────────────────────────────────────
function initUpdaterIPC(mainWindow) {
  mainWindowRef = mainWindow;
  log('initUpdaterIPC: mainWindow =', mainWindow ? 'OK' : 'NULL');

  ipcMain.handle('updater:check', async (_e, channel) => {
    log('updater:check handler invoked, channel:', channel);
    const result = await checkForUpdates(channel || 'stable');
    log('updater:check result:', JSON.stringify(result));
    return result || { upToDate: true };
  });

  ipcMain.on('updater:download', async (_e, { channel, version, downloadUrl }) => {
    log('updater:download handler invoked:', channel, version, downloadUrl?.substring(0, 80));
    setImmediate(() => {
      downloadUpdate(channel, version, downloadUrl);
    });
  });

  ipcMain.on('updater:install', (_e, { version }) => {
    log('updater:install handler invoked:', version);
    installUpdate(version);
  });

  ipcMain.handle('updater:getDownloadState', () => {
    log('updater:getDownloadState handler invoked');
    return getDownloadState();
  });

  ipcMain.on('updater:set-channel', (_e, channel) => {
    log('channel set to:', channel);
    // Channel is stored in renderer; this is just for logging
  });
}

module.exports = { initUpdaterIPC, autoDownload, checkForUpdates, downloadUpdate, installUpdate, getDownloadState };
