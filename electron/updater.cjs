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
  const v = version.replace(/^v/, '');
  const nightly = v.match(/nightly[.\-](\d{4})(\d{2})(\d{2})(?:[.\-](\d+))?/);
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

// ── STRICT channel filtering ───────────────────────────────────────────
// No cross-channel fallback. Each channel only matches its own releases.
function findRelease(releases, channel) {
  if (!Array.isArray(releases) || !releases.length) return null;
  const sorted = [...releases].sort((a, b) =>
    new Date(b.published_at || 0) - new Date(a.published_at || 0));

  if (channel === 'stable') {
    // Stable: NOT a prerelease, NO beta/nightly in tag
    return sorted.find((r) =>
      !r.prerelease && !r.draft &&
      !/beta/i.test(r.tag_name) &&
      !/nightly/i.test(r.tag_name)
    ) || null;
  }
  if (channel === 'beta') {
    // Beta: tag must contain "beta"
    return sorted.find((r) => /beta/i.test(r.tag_name)) || null;
  }
  // Nightly: tag must contain "nightly"
  return sorted.find((r) => /nightly/i.test(r.tag_name)) || null;
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

  const version = release.tag_name.replace(/^v/, '');
  const currentVersion = app.getVersion();
  const releaseDate = new Date(release.published_at || release.created_at);

  log('found:', version, 'published:', releaseDate.toISOString(), 'current:', currentVersion);

  // Compare versions
  if (channel === 'stable') {
    // Stable: simple semver compare
    const remote = version.replace(/[-+].*/, '').split('.').map(Number);
    const local = currentVersion.replace(/[-+].*/, '').split('.').map(Number);
    let newer = false;
    for (let i = 0; i < 3; i++) {
      const r = remote[i] || 0, l = local[i] || 0;
      if (r > l) { newer = true; break; }
      if (r < l) break;
    }
    if (!newer) return { upToDate: true, version: currentVersion };
  } else {
    // Beta/Nightly: in dev mode always offer update; in packaged mode compare dates
    const isDev = process.execPath.includes('electron') || process.execPath.includes('node');
    if (!isDev) {
      // Packaged: compare release date vs exe mtime
      let buildTime = Date.now();
      try { buildTime = fs.statSync(process.execPath).mtimeMs; } catch {}
      if (releaseDate.getTime() <= buildTime) {
        log('release is same or older than current build → up to date');
        return { upToDate: true, version: currentVersion };
      }
    }
    // Dev mode or newer release: check if version strings are identical
    if (version === currentVersion) {
      return { upToDate: true, version: currentVersion };
    }
  }

  const downloadUrl = getExeUrl(release);
  return {
    version,
    friendlyName: friendlyVersion(version),
    downloadUrl,
    releaseDate: releaseDate.toISOString(),
  };
}

// ── Download update (background, no UI window) ─────────────────────────
async function downloadUpdate(channel, version, downloadUrl) {
  if (activeDownload) { log('download already in progress'); return { status: 'busy' }; }

  const destPath = exePathFor(version);

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
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
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
  const exePath = exePathFor(version);
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

  ipcMain.handle('updater:check', async (_e, channel) => {
    const result = await checkForUpdates(channel || 'stable');
    return result || { upToDate: true };
  });

  ipcMain.on('updater:download', async (_e, { channel, version, downloadUrl }) => {
    log('download requested:', channel, version, downloadUrl?.substring(0, 60));
    await downloadUpdate(channel, version, downloadUrl);
  });

  ipcMain.on('updater:install', (_e, { version }) => {
    log('install requested:', version);
    installUpdate(version);
  });

  ipcMain.handle('updater:getDownloadState', () => {
    return getDownloadState();
  });

  ipcMain.on('updater:set-channel', (_e, channel) => {
    log('channel set to:', channel);
    // Channel is stored in renderer; this is just for logging
  });
}

module.exports = { initUpdaterIPC, autoDownload, checkForUpdates, downloadUpdate, installUpdate, getDownloadState };
