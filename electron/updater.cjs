const { app, BrowserWindow, nativeImage, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');

// ── Updater state ──────────────────────────────────────────────────────
let updaterWindow = null;
let mainWindowRef = null;
let updaterCanClose = false;
let isQuittingForUpdate = false;

// Configure electron-updater
autoUpdater.autoDownload = false;       // We control when download starts
autoUpdater.autoInstallOnAppQuit = false; // We control when install happens
autoUpdater.allowDowngrade = false;
autoUpdater.channel = 'stable';          // Updated based on user preference

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

// ── Updater window HTML (Discord-style portrait) ──────────────────────
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
      --text-secondary: rgba(255,255,255,0.5);
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
      -webkit-app-region: drag;
    }
    .frame {
      width: 320px;
      height: 520px;
      background: var(--surface);
      border-radius: 44px;
      border: 1px solid var(--border);
      box-shadow: 0 30px 80px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.03);
      padding: 36px 28px 28px;
      display: flex;
      flex-direction: column;
      align-items: center;
      position: absolute;
      top: 50%; left: 50%;
      transform: translate(-50%, -50%);
    }
    .logo {
      width: 72px; height: 72px;
      border-radius: 20px;
      padding: 14px;
      background: rgba(96,205,255,0.10);
      border: 1px solid rgba(96,205,255,0.18);
      display: grid;
      place-items: center;
      margin-bottom: 28px;
      flex-shrink: 0;
    }
    .logo img { width: 100%; height: 100%; object-fit: contain; }
    .title {
      font-size: 16px;
      font-weight: 600;
      margin-bottom: 4px;
      text-align: center;
    }
    .subtitle {
      font-size: 12px;
      color: var(--text-secondary);
      margin-bottom: 28px;
      text-align: center;
    }
    .progress-area {
      width: 100%;
      flex: 1;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
    }
    .progress-track {
      width: 100%;
      height: 6px;
      background: rgba(255,255,255,0.06);
      border-radius: 999px;
      overflow: hidden;
      margin-bottom: 12px;
    }
    .progress-fill {
      height: 100%;
      width: 0%;
      background: linear-gradient(90deg, var(--accent), var(--success));
      border-radius: 999px;
      transition: width 0.4s cubic-bezier(0.4, 0, 0.2, 1);
    }
    .progress-info {
      display: flex;
      justify-content: space-between;
      width: 100%;
      font-size: 11px;
      color: var(--text-secondary);
    }
    .status-text {
      margin-top: 20px;
      font-size: 12px;
      color: var(--text-secondary);
      text-align: center;
      min-height: 16px;
    }
    .status-text.success { color: var(--success); }
    .status-text.error { color: var(--error); }
    .version-badge {
      margin-top: auto;
      padding: 6px 14px;
      border-radius: 999px;
      background: rgba(255,255,255,0.04);
      border: 1px solid var(--border);
      font-size: 11px;
      color: var(--text-secondary);
    }
    .pulse {
      animation: pulse 2s ease-in-out infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.6; }
    }
  </style>
</head>
<body>
  <div class="frame">
    <div class="logo"><img src="${safeIcon}" alt="CallerFlash" /></div>
    <div class="title" id="title">Updating CallerFlash</div>
    <div class="subtitle" id="subtitle">Downloading the latest version…</div>
    <div class="progress-area">
      <div class="progress-track"><div class="progress-fill" id="fill"></div></div>
      <div class="progress-info">
        <span id="percent">0%</span>
        <span id="size">—</span>
      </div>
    </div>
    <div class="status-text" id="status"></div>
    <div class="version-badge" id="version"></div>
  </div>
  <script>
    const el = {
      fill: document.getElementById('fill'),
      percent: document.getElementById('percent'),
      size: document.getElementById('size'),
      status: document.getElementById('status'),
      title: document.getElementById('title'),
      subtitle: document.getElementById('subtitle'),
      version: document.getElementById('version'),
    };
    function setProgress(pct, downloaded, total) {
      el.fill.style.width = Math.max(0, Math.min(100, pct)) + '%';
      el.percent.textContent = Math.round(pct) + '%';
      if (downloaded != null && total != null) {
        const dl = (downloaded / 1048576).toFixed(1);
        const tot = (total / 1048576).toFixed(1);
        el.size.textContent = dl + ' / ' + tot + ' MB';
      }
    }
    function setStatus(text, cls) {
      el.status.textContent = text || '';
      el.status.className = 'status-text' + (cls ? ' ' + cls : '');
    }
    function setTitles(title, subtitle) {
      if (title) el.title.textContent = title;
      if (subtitle) el.subtitle.textContent = subtitle;
    }
    function setVersion(text) { el.version.textContent = text; }
    window.callerflashUpdater?.onProgress?.((data) => {
      setProgress(data.percent, data.bytesTransferred, data.total);
    });
    window.callerflashUpdater?.onStatus?.((data) => {
      if (data.status === 'downloading') {
        setTitles('Updating CallerFlash', 'Downloading the latest version…');
        setStatus(data.message || 'Downloading…');
      } else if (data.status === 'installing') {
        setTitles('Installing update', 'Almost done…');
        setProgress(100, null, null);
        setStatus('Installing and restarting…');
      } else if (data.status === 'success') {
        setTitles('Update complete', 'Restarting CallerFlash…');
        setStatus('Success!', 'success');
      } else if (data.status === 'error') {
        setStatus(data.message || 'Update failed', 'error');
      } else if (data.status === 'no-update') {
        setTitles('Up to date', 'You are running the latest version.');
        setStatus('');
        el.subtitle.textContent = data.message || '';
      }
    });
    window.callerflashUpdater?.onVersion?.((data) => {
      setVersion(data.current + ' → ' + data.latest);
    });
  </script>
</body>
</html>`;
}

// ── Create updater window ──────────────────────────────────────────────
function createUpdaterWindow(mainWindow) {
  if (updaterWindow && !updaterWindow.isDestroyed()) return updaterWindow;

  // Position: centered on the main window's saved position
  let savedX = null, savedY = null;
  if (mainWindow && !mainWindow.isDestroyed()) {
    const [x, y] = mainWindow.getPosition();
    savedX = x; savedY = y;
    const [w, h] = mainWindow.getSize();
    // Center the 320x520 updater on the main window
    savedX = Math.round(x + (w / 2) - 160);
    savedY = Math.round(y + (h / 2) - 260);
  }

  updaterWindow = new BrowserWindow({
    width: 320,
    height: 520,
    frame: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    closable: false,
    show: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: '#0d0d0d',
    icon: loadAppIcon(),
    x: savedX ?? undefined,
    y: savedY ?? undefined,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'updaterPreload.cjs'),
    },
  });

  if (savedX == null) updaterWindow.center();

  updaterWindow.setMenuBarVisibility(false);

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
    // Send current version info for the badge
    updaterWindow.webContents.send('updater:version', {
      current: app.getVersion(),
      latest: '…',
    });
  });

  return updaterWindow;
}

// ── Send status to updater window renderer ─────────────────────────────
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

// ── Public API ─────────────────────────────────────────────────────────

/**
 * Check for updates. Returns release info or null.
 * Does NOT download — just checks.
 */
function checkForUpdates() {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(null), 15000);

    autoUpdater.once('update-available', (info) => {
      clearTimeout(timeout);
      if (updaterWindow && !updaterWindow.isDestroyed()) {
        updaterWindow.webContents.send('updater:version', {
          current: app.getVersion(),
          latest: info.version,
        });
      }
      resolve({ version: info.version, notes: info.releaseNotes, date: info.releaseDate });
    });
    autoUpdater.once('update-not-cancelled', () => {});
    autoUpdater.once('update-not-available', (info) => {
      clearTimeout(timeout);
      resolve({ upToDate: true, version: info?.version });
    });
    autoUpdater.once('error', (err) => {
      clearTimeout(timeout);
      resolve({ error: err.message });
    });

    autoUpdater.checkForUpdates().catch((err) => {
      clearTimeout(timeout);
      resolve({ error: err.message });
    });
  });
}

/**
 * Download + install with progress UI.
 * Shows the Discord-style updater window.
 */
function downloadAndInstall(mainWindow) {
  createUpdaterWindow(mainWindow);
  mainWindowRef = mainWindow;

  sendUpdaterStatus({ status: 'downloading', message: 'Connecting to GitHub…' });

  // Progress events
  autoUpdater.on('download-progress', (progress) => {
    sendUpdaterProgress({
      percent: progress.percent || 0,
      bytesTransferred: progress.bytesTransferred,
      total: progress.total,
    });
    sendUpdaterStatus({
      status: 'downloading',
      message: `Downloading ${Math.round(progress.percent || 0)}%`,
    });
  });

  // Download complete → install
  autoUpdater.once('update-downloaded', (info) => {
    sendUpdaterStatus({ status: 'installing', message: 'Installing update…' });
    // Quit and install. electron-updater handles the NSIS silent install
    // and relaunch automatically.
    isQuittingForUpdate = true;
    autoUpdater.quitAndInstall(true, true);
  });

  autoUpdater.once('error', (err) => {
    sendUpdaterStatus({ status: 'error', message: err.message });
    updaterCanClose = true;
    setTimeout(() => {
      if (updaterWindow && !updaterWindow.isDestroyed()) {
        updaterWindow.close();
        updaterWindow = null;
      }
    }, 4000);
  });

  // Start download
  autoUpdater.downloadUpdate().catch((err) => {
    sendUpdaterStatus({ status: 'error', message: err.message });
    updaterCanClose = true;
  });
}

/**
 * Set the update channel (stable/beta/nightly).
 */
function setUpdateChannel(channel) {
  autoUpdater.channel = channel || 'stable';
}

/**
 * Wire up IPC handlers for the renderer.
 */
function initUpdaterIPC(mainWindow) {
  // Check for updates (no download)
  ipcMain.handle('updater:check', async () => {
    const result = await checkForUpdates();
    if (result?.version) {
      sendUpdaterStatus({
        status: 'downloading',
        message: `Update available: v${result.version}`,
      });
    }
    return result;
  });

  // Download + install (shows updater window)
  ipcMain.on('updater:install', () => {
    downloadAndInstall(mainWindow);
  });

  // Set channel
  ipcMain.on('updater:set-channel', (_event, channel) => {
    setUpdateChannel(channel);
  });

  // Background silent check (no UI)
  ipcMain.handle('updater:background-check', async (_event, { channel }) => {
    if (channel) setUpdateChannel(channel);
    const result = await checkForUpdates();
    return result || { upToDate: true };
  });
}

module.exports = {
  initUpdaterIPC,
  checkForUpdates,
  downloadAndInstall,
  setUpdateChannel,
};
