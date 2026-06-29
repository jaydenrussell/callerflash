const { app, BrowserWindow, nativeImage, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const { spawn } = require('child_process');
const { createHash } = require('crypto');

// ── State ──────────────────────────────────────────────────────────────
let updaterWindow = null;
let mainWindowRef = null;
let updaterCanClose = false;
let currentDownload = null;

// ── Paths ───────────────────────────────────────────────────────────────
function downloadsDir() {
  const dir = path.join(app.getPath('temp'), 'callerflash-updates');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function filePathFor(version) {
  return path.join(downloadsDir(), `CallerFlash-${version}.exe`);
}

// ── Icon helper ────────────────────────────────────────────────────────
function loadAppIcon() {
  const resPath = typeof process.resourcesPath === 'string' ? process.resourcesPath : '';
  const candidates = [
    path.join(resPath, 'cflogo.png'),
    path.join(resPath, 'cflogo.ico'),
    path.join(__dirname, '../buildResources/cflogo.png'),
    path.join(__dirname, '../buildResources/cflogo.ico'),
  ];
  for (const iconPath of candidates) {
    try {
      const img = nativeImage.createFromPath(iconPath);
      if (!img.isEmpty()) return img;
    } catch { /* continue */ }
  }
  return nativeImage.createEmpty();
}

function loadAppIconDataURL() {
  const icon = loadAppIcon();
  return icon.isEmpty() ? '' : icon.toDataURL();
}

// ── Friendly version names ─────────────────────────────────────────────
function friendlyVersion(version) {
  if (!version) return 'Unknown';
  let v = version.replace(/^v/, '');
  const nightly = v.match(/nightly\.(\d{4})(\d{2})(\d{2})(?:-(\d+))?/);
  if (nightly) {
    const [, y, m, d, n] = nightly;
    return `Nightly ${y}.${m}.${d}${n ? ' (build ' + n + ')' : ''}`;
  }
  const beta = v.match(/^(\d+\.\d+\.\d+)-beta\.(\d+)$/);
  if (beta) return `Beta ${beta[1]} (beta ${beta[2]})`;
  return `Version ${v}`;
}

// ── Clean up old downloads ─────────────────────────────────────────────
function cleanupOldDownloads(keepVersion) {
  try {
    const dir = downloadsDir();
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.exe')) continue;
      if (keepVersion && name.includes(keepVersion)) continue;
      fs.unlinkSync(path.join(dir, name));
    }
  } catch { /* ignore */ }
}

// ── Download a URL to a file with progress ────────────────────────────
function downloadFile(url, filePath, onProgress) {
  return new Promise((resolve, reject) => {
    try {
      const parsed = new URL(url);
      const transport = parsed.protocol === 'https:' ? https : http;
      const fileStream = fs.createWriteStream(filePath);
      const hash = createHash('sha512');

      const request = transport.get(url, { headers: { 'User-Agent': 'CallerFlash-Updater' } }, (response) => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          response.resume();
          downloadFile(response.headers.location, filePath, onProgress).then(resolve).catch(reject);
          return;
        }
        if (response.statusCode !== 200) {
          reject(new Error(`HTTP ${response.statusCode}`));
          return;
        }

        const totalBytes = parseInt(response.headers['content-length'] || '0', 10);
        let received = 0;

        response.on('data', (chunk) => {
          received += chunk.length;
          hash.update(chunk);
          if (totalBytes > 0 && typeof onProgress === 'function') {
            onProgress(Math.round((received / totalBytes) * 100), received, totalBytes);
          }
        });

        response.pipe(fileStream);

        fileStream.on('finish', () => {
          fileStream.close(() => {
            resolve({ filePath, sha512: hash.digest('hex'), bytesReceived: received });
          });
        });
      });

      request.on('error', reject);
      request.setTimeout(120_000, () => {
        request.destroy(new Error('Download timeout (120s)'));
      });
    } catch (err) {
      reject(err);
    }
  });
}

// ── Fetch JSON from URL ────────────────────────────────────────────────
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    try {
      const parsed = new URL(url);
      const transport = parsed.protocol === 'https:' ? https : http;
      const request = transport.get(url, { headers: { 'User-Agent': 'CallerFlash-Updater', Accept: 'application/json' } }, (response) => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          response.resume();
          fetchJson(response.headers.location).then(resolve).catch(reject);
          return;
        }
        if (response.statusCode !== 200) {
          reject(new Error(`HTTP ${response.statusCode}`));
          return;
        }
        let body = '';
        response.on('data', (chunk) => { body += chunk; });
        response.on('end', () => {
          try { resolve(JSON.parse(body)); }
          catch (e) { reject(new Error('Invalid JSON response')); }
        });
      });
      request.on('error', reject);
      request.setTimeout(10_000, () => request.destroy(new Error('Request timeout')));
    } catch (err) {
      reject(err);
    }
  });
}

// ── Find release for channel ──────────────────────────────────────────
function findReleaseForChannel(releases, channel) {
  if (!Array.isArray(releases) || releases.length === 0) return null;
  const sorted = [...releases].sort((a, b) => {
    return new Date(b.published_at || b.created_at || 0).getTime() -
           new Date(a.published_at || a.created_at || 0).getTime();
  });

  if (channel === 'stable') {
    // Prefer non-prerelease, but fall back to latest if all are prerelease
    return sorted.find((r) => !r.prerelease && !r.draft) ||
           sorted.find((r) => !r.prerelease) ||
           sorted[0];
  }
  if (channel === 'beta') {
    // Tag contains "beta", or fall back to latest prerelease
    return sorted.find((r) => /beta/i.test(r.tag_name)) ||
           sorted.find((r) => r.prerelease) ||
           sorted[0];
  }
  // Nightly: tag contains "nightly", or any prerelease, or latest
  return sorted.find((r) => /nightly/i.test(r.tag_name)) ||
         sorted.find((r) => r.prerelease) ||
         sorted[0];
}

function getExeDownloadUrl(release) {
  const assets = release.assets || [];
  const exe = assets.find((a) => /\.exe$/i.test(a.name));
  return exe ? exe.browser_download_url : null;
}

// ── Send to updater window ─────────────────────────────────────────────
function sendUpdaterStatus(payload) {
  if (updaterWindow && !updaterWindow.isDestroyed()) {
    updaterWindow.webContents.send('updater:status', payload);
  }
}

function sendUpdaterProgress(payload) {
  if (updaterWindow && !updaterWindow.isDestroyed()) {
    updaterWindow.webContents.send('updater:progress', payload);
  }
}

// ── Updater window HTML ────────────────────────────────────────────────
function buildUpdaterHtml(iconDataUrl) {
  const safeIcon = iconDataUrl || '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <style>
    :root {
      color-scheme: dark;
      --bg: #0d0d0d;
      --surface: #181818;
      --border: rgba(255,255,255,0.06);
      --text: #f0f0f0;
      --text-dim: rgba(255,255,255,0.45);
      --accent: #60cdff;
      --success: #6ccb5f;
      --error: #ff6b6b;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body {
      width: 100vw; height: 100vh;
      background: var(--bg);
      font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
      color: var(--text);
      overflow: hidden;
    }
    .title-bar {
      height: 36px;
      display: flex;
      align-items: center;
      justify-content: center;
      position: relative;
      -webkit-app-region: drag;
      flex-shrink: 0;
    }
    .title-bar .title {
      font-size: 11px;
      color: var(--text-dim);
      font-weight: 500;
    }
    .title-bar .close-btn {
      position: absolute;
      right: 12px;
      top: 50%;
      transform: translateY(-50%);
      width: 28px; height: 28px;
      border-radius: 8px;
      border: none;
      background: transparent;
      color: var(--text-dim);
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      -webkit-app-region: no-drag;
      transition: all 0.15s ease;
    }
    .title-bar .close-btn:hover {
      background: var(--error);
      color: white;
    }
    .frame {
      width: 340px; height: 460px;
      background: var(--surface);
      border-radius: 0 0 48px 48px;
      border: 1px solid var(--border);
      border-top: none;
      box-shadow: 0 30px 80px rgba(0,0,0,0.7);
      padding: 24px 32px 32px;
      display: flex;
      flex-direction: column;
      align-items: center;
      position: absolute;
      top: 36px; left: 50%;
      transform: translateX(-50%);
    }
    .logo {
      width: 56px; height: 56px;
      border-radius: 16px;
      padding: 10px;
      background: rgba(96,205,255,0.10);
      border: 1px solid rgba(96,205,255,0.18);
      display: grid;
      place-items: center;
      margin-bottom: 16px;
    }
    .logo img { width: 100%; height: 100%; object-fit: contain; }
    .progress-ring {
      position: relative;
      width: 80px; height: 80px;
      margin-bottom: 12px;
    }
    .progress-ring svg { width: 100%; height: 100%; transform: rotate(-90deg); }
    .progress-ring .track { fill: none; stroke: rgba(255,255,255,0.06); stroke-width: 4; }
    .progress-ring .fill {
      fill: none; stroke: url(#progressGradient); stroke-width: 4; stroke-linecap: round;
      stroke-dasharray: 226.19; stroke-dashoffset: 226.19;
      transition: stroke-dashoffset 0.4s ease;
    }
    .progress-ring .fill.indeterminate {
      animation: spin 1.4s linear infinite;
      stroke-dashoffset: 57;
    }
    @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
    .progress-ring .center-text {
      position: absolute; top: 50%; left: 50%;
      transform: translate(-50%, -50%); text-align: center;
    }
    .progress-ring .percent { font-size: 16px; font-weight: 700; }
    .progress-ring .label { font-size: 8px; color: var(--text-dim); text-transform: uppercase; }
    .status-text { font-size: 13px; font-weight: 600; text-align: center; margin-bottom: 4px; min-height: 18px; }
    .detail { font-size: 11px; color: var(--text-dim); text-align: center; min-height: 14px; }
    .size-info { font-size: 10px; color: var(--text-dim); text-align: center; margin-top: 2px; }
    .status-text.success { color: var(--success); }
    .status-text.error { color: var(--error); }
    .version-display { margin-top: auto; text-align: center; }
    .version-display .from-to {
      display: flex; align-items: center; justify-content: center; gap: 8px;
      font-size: 11px; color: var(--text-dim);
    }
    .version-display .from-to .arrow { color: var(--accent); font-size: 10px; }
    .version-display .from-to .ver {
      padding: 3px 10px; border-radius: 999px;
      background: rgba(255,255,255,0.04); border: 1px solid var(--border);
      font-variant-numeric: tabular-nums;
    }
    .version-display .from-to .ver.new {
      background: rgba(96,205,255,0.10); border-color: rgba(96,205,255,0.20); color: var(--accent);
    }
  </style>
</head>
<body>
  <div class="title-bar">
    <span class="title">CallerFlash Update</span>
    <button class="close-btn" id="closeBtn" title="Close">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
        <path d="M18 6L6 18"/><path d="M6 6l12 12"/>
      </svg>
    </button>
  </div>
  <div class="frame">
    <div class="logo"><img src="${safeIcon}" alt="CallerFlash" /></div>
    <div class="progress-ring">
      <svg viewBox="0 0 80 80">
        <defs>
          <linearGradient id="progressGradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="#60cdff"/><stop offset="100%" stop-color="#6ccb5f"/>
          </linearGradient>
        </defs>
        <circle class="track" cx="40" cy="40" r="36"/>
        <circle class="fill indeterminate" id="ringFill" cx="40" cy="40" r="36" style="transform-origin: center;"/>
      </svg>
      <div class="center-text">
        <div class="percent" id="percent">—</div>
        <div class="label" id="label">Waiting</div>
      </div>
    </div>
    <div class="status-text" id="status"></div>
    <div class="detail" id="detail"></div>
    <div class="size-info" id="size"></div>
    <div class="version-display">
      <div class="from-to">
        <span class="ver" id="verCurrent">v${app.getVersion()}</span>
        <span class="arrow">→</span>
        <span class="ver new" id="verLatest">…</span>
      </div>
    </div>
  </div>
  <script>
    const ring = document.getElementById('ringFill');
    const percent = document.getElementById('percent');
    const label = document.getElementById('label');
    const status = document.getElementById('status');
    const detail = document.getElementById('detail');
    const sizeEl = document.getElementById('size');
    const verLatest = document.getElementById('verLatest');
    const CIRC = 2 * Math.PI * 36;

    function setProgress(pct) {
      ring.classList.remove('indeterminate');
      ring.style.transform = 'none';
      ring.style.strokeDashoffset = CIRC * (1 - pct / 100);
      percent.textContent = Math.round(pct) + '%';
      label.textContent = 'Downloading';
    }
    function setIndeterminate() {
      ring.classList.add('indeterminate');
      ring.style.strokeDashoffset = CIRC * 0.75;
      percent.textContent = '—';
      label.textContent = 'Working';
    }
    function setStatus(text, cls) {
      status.textContent = text || '';
      status.className = 'status-text' + (cls ? ' ' + cls : '');
    }
    function setDetail(text) { detail.textContent = text || ''; }
    function setSize(text) { sizeEl.textContent = text || ''; }
    function setLatestVersion(text) { verLatest.textContent = text; }

    document.getElementById('closeBtn').addEventListener('click', function() { window.close(); });

    window.callerflashUpdater?.onProgress?.(function(data) {
      if (data.percent != null && data.percent > 0) setProgress(data.percent);
      if (data.bytesTransferred != null && data.total != null) {
        setSize((data.bytesTransferred / 1048576).toFixed(1) + ' / ' + (data.total / 1048576).toFixed(1) + ' MB');
      }
    });

    window.callerflashUpdater?.onStatus?.(function(data) {
      if (data.status === 'downloading') {
        setStatus('Downloading update', '');
        setDetail(data.message || 'Fetching from GitHub…');
        if (!ring.classList.contains('indeterminate')) setIndeterminate();
      } else if (data.status === 'ready') {
        setStatus('Ready to install', 'success');
        setDetail('Click Install in the app to update.');
        label.textContent = 'Ready';
        ring.classList.remove('indeterminate');
        ring.style.strokeDashoffset = 0;
        percent.textContent = '100%';
      } else if (data.status === 'installing') {
        setStatus('Installing update', '');
        setDetail('Closing app and running installer…');
        label.textContent = 'Installing';
        ring.classList.remove('indeterminate');
        ring.style.strokeDashoffset = 0;
        percent.textContent = '100%';
      } else if (data.status === 'success') {
        setStatus('Update complete', 'success');
        setDetail('CallerFlash is restarting…');
        label.textContent = 'Done';
      } else if (data.status === 'error') {
        setStatus('Update failed', 'error');
        setDetail(data.message || 'An error occurred');
        label.textContent = 'Error';
      }
    });

    window.callerflashUpdater?.onVersion?.(function(data) {
      setLatestVersion(data.latest);
    });
  </script>
</body>
</html>`;
}

// ── Create updater window ──────────────────────────────────────────────
function createUpdaterWindow(mainWindow) {
  if (updaterWindow && !updaterWindow.isDestroyed()) return updaterWindow;

  let posX = null, posY = null;
  if (mainWindow && !mainWindow.isDestroyed()) {
    const [x, y] = mainWindow.getPosition();
    const [w, h] = mainWindow.getSize();
    posX = Math.round(x + (w / 2) - 170);
    posY = Math.round(y + (h * 0.2) - 160);
    const { screen } = require('electron');
    const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize;
    posX = Math.max(8, Math.min(posX, screenW - 348));
    posY = Math.max(8, Math.min(posY, screenH - 468));
  }

  updaterWindow = new BrowserWindow({
    width: 340,
    height: 496,
    frame: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    show: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: '#0d0d0d',
    icon: loadAppIcon(),
    x: posX ?? undefined,
    y: posY ?? undefined,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'updaterPreload.cjs'),
    },
  });

  if (posX == null) updaterWindow.center();

  updaterWindow.on('close', (event) => {
    if (!updaterCanClose) { event.preventDefault(); return; }
    updaterWindow = null;
  });

  updaterWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(buildUpdaterHtml(loadAppIconDataURL()))}`);
  updaterWindow.once('ready-to-show', () => {
    updaterWindow.show();
    updaterWindow.setAlwaysOnTop(true, 'screen-saver');
    updaterWindow.focus();
  });

  return updaterWindow;
}

// ── Public API ─────────────────────────────────────────────────────────

async function checkForUpdates(channel) {
  try {
    const apiUrl = 'https://api.github.com/repos/jaydenrussell/CallerFlash/releases';
    console.log('[updater] checking:', apiUrl);
    const releases = await fetchJson(apiUrl);
    if (!Array.isArray(releases)) return { error: 'Invalid response from GitHub' };

    const release = findReleaseForChannel(releases, channel);
    if (!release) {
      return { error: 'No releases found on GitHub.' };
    }

    const version = release.tag_name.replace(/^v/, '');
    const currentVersion = app.getVersion().replace(/^v/, '');

    // Check if this is actually newer (string compare works for semver)
    if (version === currentVersion || version <= currentVersion) {
      return { upToDate: true, version };
    }

    const exeDlUrl = getExeDownloadUrl(release);
    console.log('[updater] found update:', version, 'exe:', exeDlUrl);

    return {
      version,
      friendlyName: friendlyVersion(version),
      releaseNotes: release.body || '',
      downloadUrl: exeDlUrl,
      htmlUrl: release.html_url,
    };
  } catch (err) {
    console.error('[updater] check failed:', err.message);
    return { error: err.message };
  }
}

async function downloadUpdate(channel, version, downloadUrl) {
  if (currentDownload) return { status: 'already-downloading' };

  const filePath = filePathFor(version);
  if (fs.existsSync(filePath)) {
    sendUpdaterStatus({ status: 'ready', message: 'Update already downloaded' });
    return { status: 'ready', filePath };
  }

  let url = downloadUrl;
  if (!url) {
    url = `https://github.com/jaydenrussell/CallerFlash/releases/download/v${version}/CallerFlash-Setup-${version}.exe`;
  }

  cleanupOldDownloads(version);
  console.log('[updater] downloading:', url);
  sendUpdaterStatus({ status: 'downloading', message: 'Connecting to GitHub…' });

  try {
    currentDownload = { filePath, version, channel };
    await downloadFile(url, filePath, (percent, received, total) => {
      sendUpdaterProgress({ percent, bytesTransferred: received, total });
    });
    currentDownload = null;
    cleanupOldDownloads(version);
    sendUpdaterStatus({ status: 'ready', message: 'Download complete' });
    return { status: 'ready', filePath };
  } catch (err) {
    currentDownload = null;
    console.error('[updater] download failed:', err.message);
    try { fs.unlinkSync(filePath); } catch {}
    sendUpdaterStatus({ status: 'error', message: err.message });
    return { status: 'error', error: err.message };
  }
}

function installUpdate(version) {
  const filePath = filePathFor(version);
  if (!fs.existsSync(filePath)) {
    sendUpdaterStatus({ status: 'error', message: 'Update file not found. Please download again.' });
    return { status: 'error', error: 'File not found' };
  }

  sendUpdaterStatus({ status: 'installing', message: 'Preparing installer…' });

  // Spawn the updater helper — a separate process that will:
  // 1. Wait for this app to exit
  // 2. Run the NSIS installer
  // 3. Relaunch the app
  const helperPath = path.join(__dirname, 'updater-helper.cjs');
  const appPath = process.execPath;
  const installDir = path.dirname(appPath);

  const helper = spawn(process.execPath, [
    helperPath,
    '--installer', filePath,
    '--app', appPath,
    '--dir', installDir,
    '--pid', String(process.pid),
  ], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  helper.unref();

  // Quit the app — the helper will take over
  setTimeout(() => {
    updaterCanClose = true;
    app.quit();
  }, 1000);

  return { status: 'installing' };
}

function initUpdaterIPC(mainWindow) {
  mainWindowRef = mainWindow;

  ipcMain.handle('updater:check', async (_event, channel) => {
    const ch = channel || 'stable';
    const result = await checkForUpdates(ch);
    if (result?.version && updaterWindow && !updaterWindow.isDestroyed()) {
      updaterWindow.webContents.send('updater:version', {
        current: 'v' + app.getVersion(),
        latest: result.friendlyName || friendlyVersion(result.version),
      });
    }
    return result || { upToDate: true };
  });

  ipcMain.on('updater:download', (_event, { channel, version, downloadUrl }) => {
    downloadUpdate(channel, version, downloadUrl);
  });

  ipcMain.on('updater:install', (_event, { version }) => {
    console.log('[updater] install requested for', version);
    installUpdate(version);
  });

  ipcMain.on('updater:show', () => {
    createUpdaterWindow(mainWindow);
  });

  ipcMain.on('updater:set-channel', (_event, channel) => {
    // Channel is now passed per-request, no module state needed
  });

  ipcMain.handle('updater:background-check', async (_event, { channel }) => {
    const result = await checkForUpdates(channel);
    return result || { upToDate: true };
  });
}

module.exports = {
  initUpdaterIPC,
  checkForUpdates,
  downloadUpdate,
  installUpdate,
  friendlyVersion,
};
