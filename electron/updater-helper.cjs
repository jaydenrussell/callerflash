const { app, BrowserWindow, Menu, nativeImage, shell } = require('electron');
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
    path.join(__dirname, '../buildResources/tray-icon.ico'),
    path.join(__dirname, '../buildResources/tray-icon.png'),
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
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Updating CallerFlash</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #111315;
      --surface: #171b20;
      --surface-2: #1f242b;
      --border: rgba(255, 255, 255, 0.08);
      --text: #eef2ff;
      --muted: #9ca3af;
      --accent: #60cdff;
      --success: #6ccb5f;
      --error: #ff8a80;
      --shadow: 0 24px 70px rgba(0, 0, 0, 0.45);
    }
    html, body {
      margin: 0;
      width: 100%;
      height: 100%;
      background: radial-gradient(circle at top, #17202a, var(--bg) 58%);
      font-family: 'Segoe UI', system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
      color: var(--text);
      overflow: hidden;
    }
    .shell {
      box-sizing: border-box;
      width: 100%;
      height: 100%;
      padding: 26px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .card {
      width: min(560px, 100%);
      background: linear-gradient(180deg, rgba(31, 36, 43, 0.96), rgba(17, 19, 21, 0.98));
      border: 1px solid var(--border);
      border-radius: 20px;
      box-shadow: var(--shadow);
      padding: 24px;
    }
    .header {
      display: flex;
      align-items: center;
      gap: 16px;
      margin-bottom: 18px;
    }
    .logo {
      width: 58px;
      height: 58px;
      border-radius: 16px;
      padding: 10px;
      box-sizing: border-box;
      background: rgba(96, 205, 255, 0.12);
      border: 1px solid rgba(96, 205, 255, 0.18);
      display: grid;
      place-items: center;
      flex: 0 0 auto;
    }
    .logo img {
      width: 100%;
      height: 100%;
      object-fit: contain;
    }
    .eyebrow {
      color: var(--accent);
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.14em;
      margin: 0 0 4px;
      font-weight: 700;
    }
    h1 {
      margin: 0;
      font-size: 22px;
      line-height: 1.1;
    }
    .sub {
      margin: 8px 0 0;
      color: var(--muted);
      font-size: 13px;
      line-height: 1.45;
    }
    .progress-shell {
      margin-top: 18px;
      background: var(--surface-2);
      border: 1px solid var(--border);
      border-radius: 999px;
      height: 14px;
      overflow: hidden;
      position: relative;
    }
    .progress-bar {
      width: 32%;
      height: 100%;
      border-radius: inherit;
      background: linear-gradient(90deg, rgba(108, 203, 95, 0.95), rgba(96, 205, 255, 0.95));
      box-shadow: 0 0 20px rgba(96, 205, 255, 0.25);
      animation: glide 1.6s ease-in-out infinite;
      transform-origin: left center;
    }
    .progress-shell[data-mode='determinate'] .progress-bar {
      animation: none;
      width: var(--progress, 0%);
    }
    .progress-shell[data-mode='determinate']::after {
      display: none;
    }
    .progress-shell::after {
      content: '';
      position: absolute;
      inset: 0;
      background: linear-gradient(90deg, transparent, rgba(255,255,255,0.08), transparent);
      transform: translateX(-100%);
      animation: sweep 1.8s ease-in-out infinite;
    }
    @keyframes glide {
      0% { transform: translateX(-6%); }
      50% { transform: translateX(160%); }
      100% { transform: translateX(-6%); }
    }
    @keyframes sweep {
      0% { transform: translateX(-100%); }
      100% { transform: translateX(100%); }
    }
    .footer {
      margin-top: 14px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      font-size: 12px;
      color: var(--muted);
    }
    .status {
      font-weight: 600;
      color: var(--text);
    }
    .hint {
      margin-top: 10px;
      font-size: 12px;
      color: var(--muted);
    }
    .success { color: var(--success); }
    .error { color: var(--error); }
  </style>
</head>
<body>
  <div class="shell">
    <div class="card">
      <div class="header">
        <div class="logo"><img src="${safeIcon}" alt="CallerFlash" /></div>
        <div>
          <p class="eyebrow">CallerFlash updater</p>
          <h1 id="title">Preparing update…</h1>
          <p class="sub" id="subtitle">This window stays open while the silent installer works.</p>
        </div>
      </div>

      <div class="progress-shell" id="progressShell" data-mode="indeterminate">
        <div class="progress-bar" id="progressBar"></div>
      </div>

      <div class="footer">
        <div class="status" id="status">Waiting for installer…</div>
        <div id="percent">—</div>
      </div>
      <div class="hint" id="hint">You can keep using your desktop; CallerFlash will reopen automatically when installation completes.</div>
    </div>
  </div>

  <script>
    const state = {
      title: document.getElementById('title'),
      subtitle: document.getElementById('subtitle'),
      status: document.getElementById('status'),
      hint: document.getElementById('hint'),
      percent: document.getElementById('percent'),
      shell: document.getElementById('progressShell'),
    };

    function render(payload) {
      if (!payload) return;
      if (payload.status === 'downloading') {
        state.title.textContent = 'Downloading update…';
        state.subtitle.textContent = payload.message || 'Fetching the signed installer.';
        state.status.textContent = payload.message || 'Downloading…';
        if (typeof payload.progress === 'number') {
          state.shell.dataset.mode = 'determinate';
          state.shell.style.setProperty('--progress', Math.max(0, Math.min(100, payload.progress)) + '%');
          state.percent.textContent = Math.round(payload.progress) + '%';
        } else {
          state.shell.dataset.mode = 'indeterminate';
          state.percent.textContent = '—';
        }
      } else if (payload.status === 'installing') {
        state.title.textContent = 'Installing update…';
        state.subtitle.textContent = payload.message || 'The installer is running silently in the background.';
        state.status.textContent = payload.message || 'Installing…';
        state.percent.textContent = '—';
        state.shell.dataset.mode = 'indeterminate';
      } else if (payload.status === 'success') {
        state.title.textContent = 'Update complete';
        state.subtitle.textContent = payload.message || 'CallerFlash is restarting now.';
        state.status.textContent = payload.message || 'Done';
        state.status.classList.add('success');
        state.hint.textContent = 'The updater will close once CallerFlash relaunches.';
        state.percent.textContent = '✓';
        state.shell.dataset.mode = 'determinate';
        state.shell.style.setProperty('--progress', '100%');
      } else if (payload.status === 'error') {
        state.title.textContent = 'Update failed';
        state.subtitle.textContent = payload.message || 'The installer could not finish.';
        state.status.textContent = payload.message || 'Error';
        state.status.classList.add('error');
        state.hint.textContent = 'You can close this window and try again from Updates.';
        state.percent.textContent = '!';
        state.shell.dataset.mode = 'determinate';
        state.shell.style.setProperty('--progress', '100%');
      } else if (payload.status === 'starting') {
        state.title.textContent = payload.message || 'Preparing update…';
        state.subtitle.textContent = payload.detail || 'Opening a dedicated installer window.';
      }
    }

    window.callerflashUpdater?.onStatus?.(render);
  </script>
</body>
</html>`;
}

function createUpdaterWindow() {
  const icon = loadTrayIcon();
  const menu = Menu.buildFromTemplate([
    {
      label: 'CallerFlash',
      submenu: [
        { label: 'Updating CallerFlash', enabled: false },
        { type: 'separator' },
        {
          label: 'Open Releases',
          click: () => shell.openExternal('https://github.com/jaydenrussell/callerflash/releases'),
        },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Project site',
          click: () => shell.openExternal('https://github.com/jaydenrussell/callerflash'),
        },
      ],
    },
  ]);
  Menu.setApplicationMenu(menu);

  updaterWindow = new BrowserWindow({
    width: 560,
    height: 340,
    minWidth: 520,
    minHeight: 320,
    resizable: false,
    maximizable: false,
    minimizable: false,
    closable: true,
    show: false,
    title: 'CallerFlash updater',
    icon,
    backgroundColor: '#111315',
    autoHideMenuBar: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'updaterPreload.cjs'),
    },
  });

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
      setUpdaterStatus({ status: 'error', message: 'Installer path missing or unavailable.' });
      updaterCanClose = true;
      setTimeout(() => app.quit(), 2500);
      return;
    }

    setUpdaterStatus({
      status: 'installing',
      message: 'Silent installer launched in a separate updater monitor.',
      detail: installDir ? `Target folder: ${installDir}` : 'Target folder: default install location',
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
