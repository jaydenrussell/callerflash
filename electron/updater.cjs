const { app, BrowserWindow, nativeImage, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const { spawn } = require('child_process');
const { createHash } = require('crypto');

// ── State ───────────────────────────────────────────────────────────────
let updaterWindow = null;
let mainWindowRef = null;
let updaterCanClose = false;
let currentDownload = null; // { filePath, version, channel, request }

// ── Paths ───────────────────────────────────────────────────────────────
function downloadsDir() {
  const dir = path.join(app.getPath('temp'), 'callerflash-updates');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function filePathFor(version) {
  return path.join(downloadsDir(), `CallerFlash-${version}.exe`);
}

function manifestUrl(channel) {
  const base = 'https://github.com/jaydenrussell/CallerFlash/releases/latest/download';
  if (channel === 'beta') return `${base}/beta.yml`;
  if (channel === 'nightly') return `${base}/nightly.yml`;
  return `${base}/latest.yml`;
}

function manifestUrlForVersion(channel, version) {
  const base = `https://github.com/jaydenrussell/CallerFlash/releases/download/v${version}`;
  if (channel === 'beta') return `${base}/beta.yml`;
  if (channel === 'nightly') return `${base}/nightly.yml`;
  return `${base}/latest.yml`;
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
  // Strip leading 'v'
  let v = version.replace(/^v/, '');
  // nightly: "0.0.0-nightly.20260627-3" → "Nightly 2026.06.27 (build 3)"
  const nightly = v.match(/nightly\.(\d{4})(\d{2})(\d{2})(?:-(\d+))?/);
  if (nightly) {
    const [, y, m, d, n] = nightly;
    return `Nightly ${y}.${m}.${d}${n ? ' (build ' + n + ')' : ''}`;
  }
  // beta: "1.5.0-beta.3" → "Beta 1.5.0 (beta 3)"
  const beta = v.match(/^(\d+\.\d+\.\d+)-beta\.(\d+)$/);
  if (beta) return `Beta ${beta[1]} (beta ${beta[2]})`;
  // stable: "1.5.0" → "Version 1.5.0"
  return `Version ${v}`;
}

// ── Clean up old downloads ─────────────────────────────────────────────
function cleanupOldDownloads(keepVersion) {
  try {
    const dir = downloadsDir();
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.exe')) continue;
      // Keep the file matching our current target version
      if (keepVersion && name.includes(keepVersion)) continue;
      fs.unlinkSync(path.join(dir, name));
      console.log('[updater] cleaned up old download:', name);
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
        // Follow redirects
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

// ── Fetch JSON manifest from GitHub ───────────────────────────────────
function fetchManifest(url) {
  return new Promise((resolve, reject) => {
    try {
      const parsed = new URL(url);
      const transport = parsed.protocol === 'https:' ? https : http;
      const request = transport.get(url, { headers: { 'User-Agent': 'CallerFlash-Updater', Accept: 'application/json' } }, (response) => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          response.resume();
          fetchManifest(response.headers.location).then(resolve).catch(reject);
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
          catch (e) { reject(new Error('Invalid manifest JSON')); }
        });
      });
      request.on('error', reject);
      request.setTimeout(10_000, () => request.destroy(new Error('Manifest fetch timeout')));
    } catch (err) {
      reject(err);
    }
  });
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

// ── Updater window HTML ──────────────────────────────────────────────
function buildUpdaterHtml(iconDataUrl) {
  const safeIcon = iconDataUrl || '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
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

    /* ── Title bar ─────────────────────────────────────────────────── */
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
      letter-spacing: 0.3px;
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

    /* ── Frame ─────────────────────────────────────────────────────── */
    .frame {
      width: 340px; height: 480px;
      background: var(--surface);
      border-radius: 0 0 48px 48px;
      border: 1px solid var(--border);
      border-top: none;
      box-shadow: 0 30px 80px rgba(0,0,0,0.7);
      padding: 0 32px 32px;
      display: flex;
      flex-direction: column;
      align-items: center;
      position: absolute;
      top: 36px; left: 50%;
      transform: translateX(-50%);
    }
    .logo {
      width: 64px; height: 64px;
      border-radius: 18px;
      padding: 12px;
      background: rgba(96,205,255,0.10);
      border: 1px solid rgba(96,205,255,0.18);
      display: grid;
      place-items: center;
      margin-bottom: 20px;
    }
    .logo img { width: 100%; height: 100%; object-fit: contain; }

    /* ── Circular progress ─────────────────────────────────────────── */
    .progress-ring {
      position: relative;
      width: 100px; height: 100px;
      margin-bottom: 16px;
    }
    .progress-ring svg { width: 100%; height: 100%; transform: rotate(-90deg); }
    .progress-ring .track {
      fill: none;
      stroke: rgba(255,255,255,0.06);
      stroke-width: 5;
    }
    .progress-ring .fill {
      fill: none;
      stroke: url(#progressGradient);
      stroke-width: 5;
      stroke-linecap: round;
      stroke-dasharray: 282.74;
      stroke-dashoffset: 282.74;
      transition: stroke-dashoffset 0.4s cubic-bezier(0.4, 0, 0.2, 1);
    }
    .progress-ring .fill.indeterminate {
      animation: spin 1.4s linear infinite;
      stroke-dashoffset: 71;
    }
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
    .progress-ring .center-text {
      position: absolute;
      top: 50%; left: 50%;
      transform: translate(-50%, -50%);
      text-align: center;
    }
    .progress-ring .percent {
      font-size: 18px;
      font-weight: 700;
      color: var(--text);
    }
    .progress-ring .label {
      font-size: 9px;
      color: var(--text-dim);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-top: 1px;
    }

    /* ── Status ────────────────────────────────────────────────────── */
    .status-text {
      font-size: 13px;
      font-weight: 600;
      color: var(--text);
      text-align: center;
      margin-bottom: 4px;
      min-height: 18px;
    }
    .detail {
      font-size: 11px;
      color: var(--text-dim);
      text-align: center;
      min-height: 14px;
    }
    .size-info {
      font-size: 10px;
      color: var(--text-dim);
      text-align: center;
      margin-top: 2px;
    }
    .status-text.success { color: var(--success); }
    .status-text.error { color: var(--error); }

    /* ── Version display ───────────────────────────────────────────── */
    .version-display {
      margin-top: auto;
      text-align: center;
    }
    .version-display .from-to {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      font-size: 11px;
      color: var(--text-dim);
    }
    .version-display .from-to .arrow {
      color: var(--accent);
      font-size: 10px;
    }
    .version-display .from-to .ver {
      padding: 3px 10px;
      border-radius: 999px;
      background: rgba(255,255,255,0.04);
      border: 1px solid var(--border);
      font-variant-numeric: tabular-nums;
    }
    .version-display .from-to .ver.new {
      background: rgba(96,205,255,0.10);
      border-color: rgba(96,205,255,0.20);
      color: var(--accent);
    }
  </style>
</head>
<body>
  <div class="title-bar">
    <span class="title">CallerFlash Update</span>
    <button class="close-btn" id="closeBtn" title="Close">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 6L6 18"/><path d="M6 6l12 12"/></svg>
    </button>
  </div>
  <div class="frame">
    <div class="logo"><img src="${safeIcon}" alt="CallerFlash" /></div>

    <div class="progress-ring">
      <svg viewBox="0 0 100 100">
        <defs>
          <linearGradient id="progressGradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="#60cdff"/>
            <stop offset="100%" stop-color="#6ccb5f"/>
          </linearGradient>
        </defs>
        <circle class="track" cx="50" cy="50" r="45"/>
        <circle class="fill indeterminate" id="ringFill" cx="50" cy="50" r="45" style="transform-origin: center;"/>
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

    const CIRC = 2 * Math.PI * 45;

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

    // Close button
    document.getElementById('closeBtn').addEventListener('click', function() {
      window.close();
    });

    // Event listeners from main process
    window.callerflashUpdater?.onProgress?.(function(data) {
      if (data.percent != null && data.percent > 0) {
        setProgress(data.percent);
      }
      if (data.bytesTransferred != null && data.total != null) {
        const dl = (data.bytesTransferred / 1048576).toFixed(1);
        const tot = (data.total / 1048576).toFixed(1);
        setSize(dl + ' / ' + tot + ' MB');
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
        setDetail('Applying update and restarting…');
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
      } else if (data.status === 'checking') {
        setStatus('Checking for updates', '');
        setDetail('Contacting GitHub…');
        setIndeterminate();
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

  // Position: centered on the main CallerFlash window
  let posX = null, posY = null;
  if (mainWindow && !mainWindow.isDestroyed()) {
    const [x, y] = mainWindow.getPosition();
    const [w, h] = mainWindow.getSize();
    posX = Math.round(x + (w / 2) - 170);
    posY = Math.round(y + (h * 0.2) - 160);
    const { screen } = require('electron');
    const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize;
    posX = Math.max(8, Math.min(posX, screenW - 348));
    posY = Math.max(8, Math.min(posY, screenH - 488));
  }

  updaterWindow = new BrowserWindow({
    width: 340,
    height: 480,
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
    if (!updaterCanClose) {
      event.preventDefault();
      return;
    }
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

/**
 * Check for updates. Returns { version, friendlyName } or { upToDate: true } or { error }.
 */
async function checkForUpdates(channel) {
  try {
    const url = manifestUrl(channel);
    console.log('[updater] checking:', url);
    const manifest = await fetchManifest(url);
    if (!manifest || !manifest.version) {
      return { error: 'No version found in manifest' };
    }
    return {
      version: manifest.version,
      friendlyName: friendlyVersion(manifest.version),
      sha512: manifest.sha512,
    };
  } catch (err) {
    console.error('[updater] check failed:', err.message);
    return { error: err.message };
  }
}

/**
 * Download the update in the background. Called automatically when an update
 * is detected. Cleans up old downloads first.
 */
async function downloadUpdate(channel, version) {
  if (currentDownload) {
    console.log('[updater] download already in progress');
    return { status: 'already-downloading' };
  }

  const filePath = filePathFor(version);
  const url = `https://github.com/jaydenrussell/CallerFlash/releases/download/v${version}/${path.basename(filePath)}`;

  // Check if already downloaded
  if (fs.existsSync(filePath)) {
    console.log('[updater] already downloaded:', filePath);
    sendUpdaterStatus({ status: 'ready', message: 'Update already downloaded' });
    return { status: 'ready', filePath };
  }

  // Clean up old downloads
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
    // Clean up partial download
    try { fs.unlinkSync(filePath); } catch {}
    sendUpdaterStatus({ status: 'error', message: err.message });
    return { status: 'error', error: err.message };
  }
}

/**
 * Install the downloaded update. Runs NSIS silently and quits the app.
 */
function installUpdate(version) {
  const filePath = filePathFor(version);
  if (!fs.existsSync(filePath)) {
    sendUpdaterStatus({ status: 'error', message: 'Update file not found. Please download again.' });
    return { status: 'error', error: 'File not found' };
  }

  sendUpdaterStatus({ status: 'installing', message: 'Installing update…' });

  // Run NSIS installer silently, then relaunch
  const installDir = path.dirname(process.execPath);
  const args = ['`/S`'];
  if (installDir && !installDir.toLowerCase().includes('temp')) {
    args.push('`/D=' + installDir + '`');
  }

  const psScript = [
    '$ErrorActionPreference = "SilentlyContinue";',
    '$installer = "' + filePath.replace(/'/g, "''") + '";',
    '$appPath = "' + process.execPath.replace(/'/g, "''") + '";',
    '$installDir = "' + installDir.replace(/'/g, "''") + '";',
    'Start-Sleep -Seconds 1;',
    '$proc = Start-Process -FilePath $installer -ArgumentList "/S", ("/D=" + $installDir) -Wait -PassThru -NoNewWindow;',
    'if ($proc.ExitCode -eq 0) { Start-Process -FilePath $appPath | Out-Null }',
  ].join(' ');

  const encodedCommand = Buffer.from(psScript, 'utf16le').toString('base64');
  const launcher = spawn('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-EncodedCommand', encodedCommand,
  ], { detached: true, stdio: 'ignore', windowsHide: true });
  launcher.unref();

  // Quit the app after a short delay so NSIS can replace files
  setTimeout(() => {
    updaterCanClose = true;
    app.quit();
  }, 1500);

  return { status: 'installing' };
}

/**
 * Wire up IPC handlers for the renderer.
 */
function initUpdaterIPC(mainWindow) {
  mainWindowRef = mainWindow;

  // Check for updates (no download)
  ipcMain.handle('updater:check', async () => {
    const result = await checkForUpdates(currentChannel);
    if (result?.version) {
      if (updaterWindow && !updaterWindow.isDestroyed()) {
        updaterWindow.webContents.send('updater:version', {
          current: 'v' + app.getVersion(),
          latest: result.friendlyName || friendlyVersion(result.version),
        });
      }
    }
    return result || { upToDate: true };
  });

  // Download update (background)
  ipcMain.on('updater:download', (_event, { channel, version }) => {
    downloadUpdate(channel, version);
  });

  // Install update (runs NSIS)
  ipcMain.on('updater:install', (_event, { version }) => {
    console.log('[updater] install requested for', version);
    installUpdate(version);
  });

  // Show the updater window
  ipcMain.on('updater:show', () => {
    createUpdaterWindow(mainWindow);
  });

  // Set channel
  ipcMain.on('updater:set-channel', (_event, channel) => {
    currentChannel = channel || 'stable';
  });

  // Background silent check (no UI)
  ipcMain.handle('updater:background-check', async (_event, { channel }) => {
    const result = await checkForUpdates(channel);
    return result || { upToDate: true };
  });
}

let currentChannel = 'stable';

module.exports = {
  initUpdaterIPC,
  checkForUpdates,
  downloadUpdate,
  installUpdate,
  friendlyVersion,
};
