const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const { spawn } = require('child_process');

// ── State ─────────────────────────────────────────────────────────────
let mainWindowRef = null;
let updaterCanClose = false;

const downloadState = {
  version: null, path: null, status: 'idle', error: null,
};

const log = (...a) => console.log('[updater]', ...a);
const logErr = (...a) => console.error('[updater]', ...a);

// ── Downloads ─────────────────────────────────────────────────────────
function downloadsDir() {
  const d = path.join(app.getPath('temp'), 'callerflash-updates');
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  return d;
}

function exePathFor(version) {
  return path.join(downloadsDir(), `CallerFlash-${version}.exe`);
}

// ── Fetch GitHub releases ────────────────────────────────────────────
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, { headers: { 'User-Agent': 'CallerFlash' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchJson(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch { reject(new Error('Bad JSON')); } });
    }).on('error', reject);
  });
}

// ── Find latest release for channel ───────────────────────────────────
// Returns { version, downloadUrl, publishedAt } or null
async function findLatestRelease(channel) {
  const releases = await fetchJson('https://api.github.com/repos/jaydenrussell/CallerFlash/releases');
  if (!Array.isArray(releases) || !releases.length) return null;

  // Filter by channel
  let filtered;
  if (channel === 'stable') {
    filtered = releases.filter(r => !r.prerelease && !r.draft && !/beta|nightly/i.test(r.tag_name));
  } else if (channel === 'beta') {
    filtered = releases.filter(r => /beta/i.test(r.tag_name) && !r.draft);
  } else {
    // nightly
    filtered = releases.filter(r => /nightly/i.test(r.tag_name) && !r.draft);
  }
  if (!filtered.length) return null;

  // Sort by published date descending (newest first)
  filtered.sort((a, b) => new Date(b.published_at || 0) - new Date(a.published_at || 0));

  const latest = filtered[0];
  const exe = (latest.assets || []).find(a => /\.exe$/i.test(a.name));
  if (!exe) return null;

  return {
    version: latest.tag_name,           // e.g. "nightly-20260629-17"
    downloadUrl: exe.browser_download_url,
    publishedAt: latest.published_at,
  };
}

// ── Normalise version strings ─────────────────────────────────────────
// Internal helper: strips any "0.0.0-" or "0.0.0." semver prefix that may have
// been baked into package.json by older CI runs, so nightly versions always
// compare as "nightly-YYYYMMDD-N".
function normaliseVersion(v) {
  if (!v) return v;
  return String(v)
    .replace(/^v/, '')
    .replace(/^0\.0\.0-nightly[.\-]/i, 'nightly-')
    .replace(/^nightly\.(\d{8})(?:\.(\d+))?$/i, (_, d, n) => `nightly-${d}${n ? `-${n}` : ''}`);
}

// ── Version comparison ────────────────────────────────────────────────
// Returns true if remoteVersion is newer than currentVersion
// Rules:
//   - Never consider the SAME version as an update
//   - For stable: compare by semver
//   - For beta/nightly: compare by publish date (we sort releases newest-first,
//     so the first matching release IS the newest — if it differs from installed, it's newer)
function isUpdateAvailable(currentVersion, remoteVersion, channel, remotePublishedAt) {
  // Normalise both versions to strip any legacy "0.0.0-" prefix
  const normRemote = normaliseVersion(remoteVersion);
  const normLocal = normaliseVersion(currentVersion);

  // Exact match (after normalisation) = same version = not an update
  if (normRemote === normLocal) return false;

  // For stable: semver comparison
  if (channel === 'stable') {
    const remote = normRemote.split('.').map(Number);
    const local = normLocal.split('.').map(Number);
    for (let i = 0; i < 3; i++) {
      const r = remote[i] || 0, l = local[i] || 0;
      if (r > l) return true;
      if (r < l) return false;
    }
    return false; // equal
  }

  // For beta/nightly: the releases are already sorted newest-first by publish date.
  // If we found a release whose tag name differs from the installed version,
  // AND it was published AFTER the installed version's release, it's an update.
  //
  // The key insight: we compare the tag names. For nightly, "nightly-20260629-17"
  // vs "nightly-20260629-6" — the one with the higher index is newer.
  // Since findLatestRelease sorts by publish date and returns the first match,
  // the returned release IS the newest. If it's different from installed, offer it.
  //
  // But we also need to check: is the installed version HIGHER than the remote?
  // If user has nightly-20260629-17 installed and the latest release is nightly-20260629-9,
  // we should NOT offer a downgrade.
  if (remotePublishedAt) {
    // Extract date+index from both versions for comparison.
    // After normalisation both are in "nightly-YYYYMMDD-N" form.
    const parseTag = (v) => {
      const m = String(v).match(/(\d{8})(?:-(\d+))?$/);
      if (!m) return null;
      return { date: m[1], index: parseInt(m[2] || '0', 10) };
    };
    const remote = parseTag(normRemote);
    const local = parseTag(normLocal);
    if (remote && local) {
      if (remote.date > local.date) return true;
      if (remote.date < local.date) return false;
      if (remote.index > local.index) return true;
      if (remote.index < local.index) return false;
      return false; // same date+index
    }
    // If we can't parse both, fall through to string comparison
  }

  // Fallback: different strings = offer update (safe for testing)
  return true;
}

// ── Friendly version display ──────────────────────────────────────────
// Returns a human-readable version name for UI display.
//   nightly-20260629-6  → "Nightly 2026.06.29 (#6)"
//   1.5.0-beta.28       → "Beta 1.5.0 (#28)"
//   1.4.2               → "1.4.2"
function friendlyVersion(version) {
  const v = normaliseVersion(version);
  if (!v) return version;

  // Nightly
  const nightlyMatch = v.match(/^nightly-(\d{4})(\d{2})(\d{2})(?:-(\d+))?$/i);
  if (nightlyMatch) {
    const [, y, m, d, n] = nightlyMatch;
    return `Nightly ${y}.${m}.${d}${n ? ` (#${n})` : ''}`;
  }

  // Beta
  const betaMatch = v.match(/^(.+?)-beta\.(\d+)$/);
  if (betaMatch) {
    return `Beta ${betaMatch[1]} (#${betaMatch[2]})`;
  }

  return v;
}

// ── Check for updates ─────────────────────────────────────────────────
async function checkForUpdates(channel) {
  // In dev mode, skip entirely — package.json version is meaningless
  if (!app.isPackaged) {
    log('dev mode: skipping update check');
    return { upToDate: true, version: app.getVersion() };
  }

  const currentVersion = app.getVersion();
  log(`checking channel=${channel} current=${currentVersion}`);

  try {
    const release = await findLatestRelease(channel);
    if (!release) {
      log('no release found for channel:', channel);
      return { upToDate: true, version: currentVersion };
    }

    log(`found release: ${release.version} (${release.publishedAt})`);

    if (!isUpdateAvailable(currentVersion, release.version, channel, release.publishedAt)) {
      log('up to date');
      return { upToDate: true, version: currentVersion };
    }

    return {
      version: release.version,
      downloadUrl: release.downloadUrl,
      publishedAt: release.publishedAt,
    };
  } catch (err) {
    logErr('check failed:', err.message);
    return { error: err.message };
  }
}

// ── Download update ───────────────────────────────────────────────────
async function downloadUpdate(channel, version, downloadUrl) {
  if (activeDownload) return { status: 'busy' };

  const destPath = exePathFor(version);
  if (fs.existsSync(destPath)) {
    log('already downloaded:', destPath);
    downloadState.version = version;
    downloadState.path = destPath;
    downloadState.status = 'ready';
    return { status: 'ready', path: destPath };
  }

  if (!downloadUrl) {
    downloadState.status = 'error';
    downloadState.error = 'No download URL';
    return { status: 'error', error: 'No URL' };
  }

  log('downloading:', downloadUrl);
  downloadState.status = 'downloading';
  sendStatus({ status: 'downloading', version });

  try {
    await new Promise((resolve, reject) => {
      const mod = downloadUrl.startsWith('https') ? https : http;
      const file = fs.createWriteStream(destPath);
      const req = mod.get(downloadUrl, { headers: { 'User-Agent': 'CallerFlash' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          downloadUpdate(channel, version, res.headers.location).then(resolve).catch(reject);
          return;
        }
        if (res.statusCode !== 200) { file.close(); return reject(new Error(`HTTP ${res.statusCode}`)); }
        const total = parseInt(res.headers['content-length'] || '0', 10);
        let received = 0;
        res.on('data', (chunk) => {
          received += chunk.length;
          if (total > 0) sendProgress({ percent: Math.round((received / total) * 100), received, total });
        });
        res.pipe(file);
        file.on('finish', () => { file.close(); resolve(); });
      });
      req.on('error', reject);
      req.setTimeout(120000, () => { req.destroy(new Error('Download timeout')); });
    });

    // Clean old downloads
    try {
      for (const f of fs.readdirSync(downloadsDir())) {
        if (f.endsWith('.exe') && !f.includes(version)) fs.unlinkSync(path.join(downloadsDir(), f));
      }
    } catch {}

    downloadState.version = version;
    downloadState.path = destPath;
    downloadState.status = 'ready';
    downloadState.error = null;
    log('download complete:', destPath);
    sendStatus({ status: 'ready', version });
    return { status: 'ready', path: destPath };
  } catch (err) {
    downloadState.status = 'error';
    downloadState.error = err.message;
    logErr('download failed:', err.message);
    try { fs.unlinkSync(destPath); } catch {}
    sendStatus({ status: 'error', message: err.message });
    return { status: 'error', error: err.message };
  }
}

// ── Install update ────────────────────────────────────────────────────
function installUpdate(version) {
  const exePath = exePathFor(version);
  if (!fs.existsSync(exePath)) {
    sendStatus({ status: 'error', message: 'File not found. Download again.' });
    return { status: 'error' };
  }

  sendStatus({ status: 'installing', version });

  // Spawn updater helper — separate Electron process that:
  // 1. Waits for this app to exit
  // 2. Runs NSIS installer silently
  // 3. Relaunches the app
  const helperPath = path.join(__dirname, 'updater-helper.cjs');
  const appPath = process.execPath;
  const installDir = path.dirname(appPath);

  log('spawning helper:', helperPath);
  try {
    const helper = spawn(process.execPath, [
      helperPath,
      '--installer', exePath,
      '--app', appPath,
      '--dir', installDir,
      '--pid', String(process.pid),
    ], { detached: true, stdio: 'ignore', windowsHide: true });
    helper.unref();
  } catch (err) {
    logErr('failed to spawn helper:', err.message);
    sendStatus({ status: 'error', message: 'Failed to start installer' });
    return { status: 'error' };
  }

  // Quit after a delay — helper takes over
  setTimeout(() => {
    updaterCanClose = true;
    app.quit();
  }, 1500);

  return { status: 'installing' };
}

// ── Send to renderer ──────────────────────────────────────────────────
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

// ── IPC handlers ──────────────────────────────────────────────────────
function initUpdaterIPC(mainWindow) {
  mainWindowRef = mainWindow;

  ipcMain.handle('updater:check', async (_e, channel) => {
    return await checkForUpdates(channel || 'stable') || { upToDate: true };
  });

  ipcMain.on('updater:download', async (_e, { channel, version, downloadUrl }) => {
    log('download requested:', channel, version);
    await downloadUpdate(channel, version, downloadUrl);
  });

  ipcMain.on('updater:install', (_e, { version }) => {
    log('install requested:', version);
    installUpdate(version);
  });

  ipcMain.handle('updater:getDownloadState', () => {
    return { ...downloadState };
  });
}

module.exports = { initUpdaterIPC, checkForUpdates, downloadUpdate, installUpdate, normaliseVersion, friendlyVersion };
