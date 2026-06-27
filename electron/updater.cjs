const { app, BrowserWindow, nativeImage, ipcMain } = require('electron');
const path = require('path');
const { autoUpdater } = require('electron-updater');

// ── Updater state ──────────────────────────────────────────────────────
let updaterWindow = null;
let updaterCanClose = false;

// Configure electron-updater
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;  // Install when app quits
autoUpdater.allowDowngrade = false;

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

// ── Updater window HTML ───────────────────────────────────────────────
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
    .frame {
      width: 340px; height: 480px;
      background: var(--surface);
      border-radius: 48px;
      border: 1px solid var(--border);
      box-shadow: 0 30px 80px rgba(0,0,0,0.7);
      padding: 40px 32px 32px;
      display: flex;
      flex-direction: column;
      align-items: center;
      position: absolute;
      top: 50%; left: 50%;
      transform: translate(-50%, -50%);
    }
    .logo {
      width: 64px; height: 64px;
      border-radius: 18px;
      padding: 12px;
      background: rgba(96,205,255,0.10);
      border: 1px solid rgba(96,205,255,0.18);
      display: grid;
      place-items: center;
      margin-bottom: 24px;
    }
    .logo img { width: 100%; height: 100%; object-fit: contain; }

    /* ── Circular progress ──────────────────────────────────────── */
    .progress-ring {
      position: relative;
      width: 120px; height: 120px;
      margin-bottom: 24px;
    }
    .progress-ring svg {
      width: 100%; height: 100%;
      transform: rotate(-90deg);
    }
    .progress-ring .track {
      fill: none;
      stroke: rgba(255,255,255,0.06);
      stroke-width: 6;
    }
    .progress-ring .fill {
      fill: none;
      stroke: url(#progressGradient);
      stroke-width: 6;
      stroke-linecap: round;
      stroke-dasharray: 339.292;  /* 2πr where r=54 */
      stroke-dashoffset: 339.292;
      transition: stroke-dashoffset 0.4s cubic-bezier(0.4, 0, 0.2, 1);
    }
    .progress-ring .fill.indeterminate {
      animation: spin 1.4s linear infinite;
      stroke-dashoffset: 85;  /* ~25% arc */
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
      font-size: 22px;
      font-weight: 700;
      color: var(--text);
    }
    .progress-ring .label {
      font-size: 10px;
      color: var(--text-dim);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-top: 2px;
    }

    /* ── Status ─────────────────────────────────────────────────── */
    .status {
      font-size: 14px;
      font-weight: 600;
      color: var(--text);
      text-align: center;
      margin-bottom: 6px;
      min-height: 20px;
    }
    .detail {
      font-size: 12px;
      color: var(--text-dim);
      text-align: center;
      min-height: 16px;
    }
    .size-info {
      font-size: 11px;
      color: var(--text-dim);
      text-align: center;
      margin-top: 4px;
    }

    /* ── Version badge ──────────────────────────────────────────── */
    .version-badge {
      margin-top: auto;
      padding: 6px 16px;
      border-radius: 999px;
      background: rgba(255,255,255,0.04);
      border: 1px solid var(--border);
      font-size: 11px;
      color: var(--text-dim);
      font-variant-numeric: tabular-nums;
    }

    /* ── States ─────────────────────────────────────────────────── */
    .status.success { color: var(--success); }
    .status.error { color: var(--error); }
  </style>
</head>
<body>
  <div class="frame">
    <div class="logo"><img src="${safeIcon}" alt="CallerFlash" /></div>

    <div class="progress-ring">
      <svg viewBox="0 0 120 120">
        <defs>
          <linearGradient id="progressGradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="#60cdff"/>
            <stop offset="100%" stop-color="#6ccb5f"/>
          </linearGradient>
        </defs>
        <circle class="track" cx="60" cy="60" r="54"/>
        <circle class="fill indeterminate" id="ringFill" cx="60" cy="60" r="54"
                style="transform-origin: center;"/>
      </svg>
      <div class="center-text">
        <div class="percent" id="percent">—</div>
        <div class="label" id="label">Waiting</div>
      </div>
    </div>

    <div class="status" id="status">Preparing…</div>
    <div class="detail" id="detail"></div>
    <div class="size-info" id="size"></div>
    <div class="version-badge" id="version">v${app.getVersion()}</div>
  </div>
  <script>
    const ring = document.getElementById('ringFill');
    const percent = document.getElementById('percent');
    const label = document.getElementById('label');
    const status = document.getElementById('status');
    const detail = document.getElementById('detail');
    const sizeEl = document.getElementById('size');
    const versionEl = document.getElementById('version');

    const CIRC = 2 * Math.PI * 54; // ~339.29

    function setProgress(pct) {
      // Switch from indeterminate to determinate
      ring.classList.remove('indeterminate');
      ring.style.transform = 'none';
      const offset = CIRC * (1 - pct / 100);
      ring.style.strokeDashoffset = offset;
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
      status.className = 'status' + (cls ? ' ' + cls : '');
    }

    function setDetail(text) { detail.textContent = text || ''; }
    function setSize(text) { sizeEl.textContent = text || ''; }
    function setVersion(text) { versionEl.textContent = text; }

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
      setVersion(data.current + ' → ' + data.latest);
    });
  </script>
</body>
</html>`;
}

// ── Create updater window ──────────────────────────────────────────────
function createUpdaterWindow(mainWindow) {
  if (updaterWindow && !updaterWindow.isDestroyed()) return updaterWindow;

  // Center on main window position
  let posX = null, posY = null;
  if (mainWindow && !mainWindow.isDestroyed()) {
    const [x, y] = mainWindow.getPosition();
    const [w, h] = mainWindow.getSize();
    posX = Math.round(x + (w / 2) - 170);
    posY = Math.round(y + (h / 2) - 240);
  }

  updaterWindow = new BrowserWindow({
    width: 340,
    height: 480,
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
    updaterWindow.webContents.send('updater:version', {
      current: 'v' + app.getVersion(),
      latest: '…',
    });
  });

  return updaterWindow;
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

// ── Public API ─────────────────────────────────────────────────────────

function checkForUpdates() {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve({ error: 'Connection timeout — check your internet' }), 15000);

    autoUpdater.once('update-available', (info) => {
      clearTimeout(timeout);
      console.log('[updater] update available:', info.version);
      if (updaterWindow && !updaterWindow.isDestroyed()) {
        updaterWindow.webContents.send('updater:version', {
          current: 'v' + app.getVersion(),
          latest: 'v' + info.version,
        });
      }
      resolve({ version: info.version, notes: info.releaseNotes, date: info.releaseDate });
    });
    autoUpdater.once('update-not-available', (info) => {
      clearTimeout(timeout);
      console.log('[updater] up to date:', info?.version);
      resolve({ upToDate: true, version: info?.version });
    });
    autoUpdater.once('error', (err) => {
      clearTimeout(timeout);
      console.error('[updater] check error:', err.message);
      resolve({ error: err.message });
    });

    autoUpdater.checkForUpdates().catch((err) => {
      clearTimeout(timeout);
      console.error('[updater] checkForUpdates failed:', err.message);
      resolve({ error: err.message });
    });
  });
}

function downloadAndInstall(mainWindow) {
  // If window already exists and is alive, just show it
  if (updaterWindow && !updaterWindow.isDestroyed()) {
    updaterWindow.show();
    updaterWindow.focus();
  } else {
    createUpdaterWindow(mainWindow);
  }

  let progressHandler = null;
  let started = false;

  // Progress events
  progressHandler = (progress) => {
    started = true;
    sendUpdaterProgress({
      percent: progress.percent || 0,
      bytesTransferred: progress.bytesTransferred,
      total: progress.total,
    });
  };
  autoUpdater.on('download-progress', progressHandler);

  // Download complete → install
  autoUpdater.once('update-downloaded', (info) => {
    autoUpdater.removeListener('download-progress', progressHandler);
    sendUpdaterStatus({ status: 'installing', message: 'Installing update…' });
    autoUpdater.quitAndInstall(true, true);
  });

  autoUpdater.once('error', (err) => {
    autoUpdater.removeListener('download-progress', progressHandler);
    console.error('[updater] error:', err.message);
    sendUpdaterStatus({ status: 'error', message: err.message || 'Download failed' });
    updaterCanClose = true;
    setTimeout(() => {
      if (updaterWindow && !updaterWindow.isDestroyed()) {
        updaterWindow.close();
        updaterWindow = null;
      }
    }, 5000);
  });

  // Safety timeout: if no progress after 10s, show error
  const safetyTimeout = setTimeout(() => {
    if (!started) {
      autoUpdater.removeListener('download-progress', progressHandler);
      sendUpdaterStatus({ status: 'error', message: 'No download started. The release may be missing update files (latest.yml), or GitHub is unreachable.' });
      updaterCanClose = true;
      setTimeout(() => {
        if (updaterWindow && !updaterWindow.isDestroyed()) {
          updaterWindow.close();
          updaterWindow = null;
        }
      }, 8000);
    }
  }, 10000);

  // Clear safety timeout once download starts
  autoUpdater.once('download-progress', () => clearTimeout(safetyTimeout));

  // Start download
  sendUpdaterStatus({ status: 'downloading', message: 'Connecting to GitHub…' });
  autoUpdater.downloadUpdate()
    .then(() => {
      clearTimeout(safetyTimeout);
    })
    .catch((err) => {
      clearTimeout(safetyTimeout);
      autoUpdater.removeListener('download-progress', progressHandler);
      console.error('[updater] downloadUpdate failed:', err.message);
      sendUpdaterStatus({ status: 'error', message: err.message || 'Download failed' });
      updaterCanClose = true;
      setTimeout(() => {
        if (updaterWindow && !updaterWindow.isDestroyed()) {
          updaterWindow.close();
          updaterWindow = null;
        }
      }, 5000);
    });
}

function setUpdateChannel(channel) {
  // electron-updater reads channel from latest.yml filename
  // but we can also set it directly
  autoUpdater.channel = channel || 'stable';
}

function initUpdaterIPC(mainWindow) {
  // Check for updates (no download)
  ipcMain.handle('updater:check', async () => {
    setUpdateChannel(mainWindow ? null : null); // ensure channel is current
    const result = await checkForUpdates();
    return result || { upToDate: true };
  });

  // Download + install (shows updater window)
  ipcMain.on('updater:install', () => {
    console.log('[updater] install requested, channel:', autoUpdater.channel);
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
