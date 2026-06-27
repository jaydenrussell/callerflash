const { app, BrowserWindow, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

let updaterWindow = null;
let updaterCanClose = false;

function loadTrayIcon() {
  const resPath = typeof process.resourcesPath === 'string' ? process.resourcesPath : '';
  const candidates = [
    path.join(resPath, 'cflogo.ico'),
    path.join(resPath, 'cflogo.png'),
    path.join(__dirname, '../buildResources/cflogo.ico'),
    path.join(__dirname, '../buildResources/cflogo.png'),
    path.join(__dirname, '../buildResources/icon.ico'),
    path.join(__dirname, '../buildResources/icon.png'),
  ];
  for (const iconPath of candidates) {
    try {
      const img = nativeImage.createFromPath(iconPath);
      if (!img.isEmpty()) return img;
    } catch {
      // Continue to next candidate.
    }
  }
  return nativeImage.createEmpty();
}

function buildUpdaterHtml(iconDataUrl) {
  const safeIcon = iconDataUrl || '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, height=device-height, initial-scale=1.0, viewport-fit=cover" />
  <style>
    :root {
      color-scheme: dark;
      --bg: #0a0a0a;
      --surface: #161616;
      --border: rgba(255, 255, 255, 0.08);
      --text: #ffffff;
      --accent: #60cdff;
      --success: #6ccb5f;
      --error: #ff8a80;
    }
    html, body {
      margin: 0;
      padding: 0;
      width: 100vw;
      height: 100vh;
      background: var(--bg);
      font-family: 'Segoe UI', system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
      color: var(--text);
      overflow: hidden;
    }
    .phone-frame {
      width: 340px;
      height: 580px;
      background: var(--surface);
      border-radius: 48px;
      border: 1px solid var(--border);
      box-shadow: 0 24px 70px rgba(0, 0, 0, 0.6);
      padding: 32px 24px;
      display: flex;
      flex-direction: column;
      align-items: center;
      margin: 0 auto;
      position: relative;
      top: 50%;
      transform: translateY(-50%);
    }
    .logo {
      width: 80px;
      height: 80px;
      border-radius: 22px;
      padding: 12px;
      background: rgba(96, 205, 255, 0.12);
      border: 1px solid rgba(96, 205, 255, 0.22);
      display: grid;
      place-items: center;
      margin-bottom: 32px;
    }
    .logo img {
      width: 100%;
      height: 100%;
      object-fit: contain;
    }
    .progress-label {
      font-size: 17px;
      font-weight: 600;
      margin-bottom: 12px;
      color: var(--text);
      text-align: center;
    }
    .progress-percent {
      font-size: 13px;
      color: var(--accent);
      margin-bottom: 8px;
      text-align: center;
    }
    .progress-track {
      width: 100%;
      height: 8px;
      background: rgba(255, 255, 255, 0.08);
      border-radius: 999px;
      overflow: hidden;
    }
    .progress-fill {
      height: 100%;
      width: 0%;
      background: linear-gradient(90deg, var(--accent), var(--success));
      border-radius: 999px;
      transition: width 0.3s ease-out;
    }
    .status-text {
      margin-top: 14px;
      font-size: 13px;
      color: var(--accent);
      text-align: center;
    }
    .success { color: var(--success); }
    .error { color: var(--error); }
  </style>
</head>
<body>
  <div class="phone-frame">
    <div class="logo"><img src="${safeIcon}" alt="CallerFlash" /></div>
    <div class="progress-label" id="label">Preparing update…</div>
    <div class="progress-percent" id="percent">—</div>
    <div class="progress-track"><div class="progress-fill" id="fill"></div></div>
    <div class="status-text" id="status">Waiting…</div>
  </div>
  <script>
    const state = {
      label: document.getElementById('label'),
      percent: document.getElementById('percent'),
      fill: document.getElementById('fill'),
      status: document.getElementById('status'),
    };

    function render(payload) {
      if (!payload) return;
      const pct = typeof payload.progress === 'number' ? payload.progress : 0;
      state.fill.style.width = Math.max(0, Math.min(100, pct)) + '%';
      state.percent.textContent = Math.round(pct) + '%';

      if (payload.status === 'downloading') {
        state.label.textContent = 'Downloading update…';
        state.status.textContent = payload.message || 'Fetching installer…';
      } else if (payload.status === 'installing') {
        state.label.textContent = 'Installing update…';
        state.status.textContent = payload.message || 'Installing…';
      } else if (payload.status === 'success') {
        state.label.textContent = 'Update complete';
        state.status.textContent = 'Relaunching CallerFlash…';
        state.status.classList.add('success');
      } else if (payload.status === 'error') {
        state.label.textContent = 'Update failed';
        state.status.textContent = payload.message || 'Error';
        state.status.classList.add('error');
      } else if (payload.status === 'starting') {
        state.label.textContent = payload.message || 'Preparing update…';
        state.status.textContent = payload.detail || 'Starting installer…';
      }
    }

    window.callerflashUpdater?.onStatus?.(render);
  </script>
</body>
</html>`;
}

function createUpdaterWindow() {
  const icon = loadTrayIcon();
  const savedStatePath = path.join(app.getPath('userData'), 'main-window-state.json');
  let savedX = null, savedY = null;
  try {
    if (fs.existsSync(savedStatePath)) {
      const saved = JSON.parse(fs.readFileSync(savedStatePath, 'utf8'));
      savedX = Number.isFinite(saved.x) ? saved.x : null;
      savedY = Number.isFinite(saved.y) ? saved.y : null;
    }
  } catch {}

  updaterWindow = new BrowserWindow({
    width: 340,
    height: 580,
    resizable: false,
    maximizable: false,
    minimizable: false,
    closable: false,
    show: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#0a0a0a',
    icon,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'updaterPreload.cjs'),
    },
  });

  if (savedX !== null && savedY !== null) {
    updaterWindow.setPosition(Math.round(savedX + 230), Math.round(savedY + 70));
  } else {
    updaterWindow.center();
  }

  updaterWindow.on('close', (event) => {
    if (!updaterCanClose) {
      event.preventDefault();
      return;
    }
    updaterWindow = null;
  });

  updaterWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(buildUpdaterHtml(icon.toDataURL()))}`);
  updaterWindow.once('ready-to-show', () => {
    updaterWindow.show();
  });
}

function setUpdaterStatus(payload) {
  if (updaterWindow && !updaterWindow.isDestroyed()) {
    updaterWindow.webContents.send('updater:status', payload);
  }
}

function psQuote(value) {
  return `'${String(value || '').replace(/'/g, "''")}'`;
}

function shouldAppendInstallDirArg(installDir) {
  if (!installDir || !fs.existsSync(installDir)) return false;
  const lowered = installDir.toLowerCase();
  return !lowered.includes('temp') && !lowered.includes('tmp');
}

function launchWindowsInstaller(installerPath, installDir, appPath) {
  const psScript = [
    '$ErrorActionPreference = "Stop";',
    `$installer = ${psQuote(installerPath)};`,
    `$appPath = ${psQuote(appPath)};`,
    `$args = @("/S");`,
    shouldAppendInstallDirArg(installDir) ? `$args += "/D=${String(installDir).replace(/'/g, "''")}";` : '',
    '$proc = Start-Process -FilePath $installer -ArgumentList $args -Wait -PassThru;',
    'if ($proc.ExitCode -eq 0 -and $appPath) { Start-Process -FilePath $appPath | Out-Null }',
    'exit $proc.ExitCode;'
  ].filter(Boolean).join(' ');

  const encodedCommand = Buffer.from(psScript, 'utf16le').toString('base64');
  const launcher = spawn('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-EncodedCommand',
    encodedCommand,
  ], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  launcher.unref();
  return launcher;
}

async function startUpdaterHelper() {
  createUpdaterWindow();

  updaterWindow.webContents.once('did-finish-load', () => {
    const installerPath = process.env.CALLERFLASH_INSTALLER_PATH;
    const installDir = process.env.CALLERFLASH_INSTALL_DIR;
    const appPath = process.env.CALLERFLASH_APP_PATH || process.execPath;

    if (!installerPath || !fs.existsSync(installerPath)) {
      setUpdaterStatus({ status: 'error', message: 'Installer path missing.' });
      updaterCanClose = true;
      setTimeout(() => app.quit(), 2500);
      return;
    }

    setUpdaterStatus({
      status: 'installing',
      message: 'Running silent installer…',
      progress: 50,
    });

    try {
      const launcher = launchWindowsInstaller(installerPath, installDir, appPath);
      launcher.on('error', (err) => {
        setUpdaterStatus({ status: 'error', message: err.message });
        updaterCanClose = true;
      });
      updaterCanClose = true;
      setTimeout(() => app.quit(), 400);
    } catch (err) {
      setUpdaterStatus({ status: 'error', message: err.message });
      updaterCanClose = true;
      setTimeout(() => app.quit(), 2500);
    }
  });
}

module.exports = { startUpdaterHelper };