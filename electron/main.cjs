// CallerFlash — Electron main process
//
// Responsibilities:
//   • Create the single browser window that hosts the renderer (React UI).
//   • Own the Windows system-tray icon and its context menu.
//   • Bridge IPC calls from the sandboxed renderer (via preload.cjs).
//   • Persist the app across window-close events — only the tray "Quit"
//     entry actually terminates the process.

const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell, safeStorage, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const { spawn } = require('child_process');
const sipClient = require('./sipClient.cjs');

// ── Single-instance lock ───────────────────────────────────────────────
// If a second copy is launched (double-click on the .exe again, etc.),
// focus the existing window instead of starting a duplicate.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
  process.exit(0);
}

// Disable hardware acceleration for better compatibility in background apps
app.disableHardwareAcceleration();

// App user model ID — required on Windows so the tray icon, taskbar pin,
// and toast notifications all group under the same identity.
if (process.platform === 'win32') {
  app.setAppUserModelId('com.callerflash.app');
}

// ── Module-level state ─────────────────────────────────────────────────
let mainWindow = null;
let tray = null;

// Cached SIP status from the renderer. Refreshed via the
// `tray:set-sip-status` IPC so the tray tooltip + menu label stay current.
let lastSipStatus = 'Offline';

// Pre-generated colored tray icons for each SIP state.
// Created at startup from the main cflogo icon with a colored overlay.
let trayIconDefault = null;
let trayIconGreen = null;
let trayIconYellow = null;
let trayIconRed = null;
let updateAvailableVersion = null;

// Set to true ONLY when the user explicitly chose Quit from the tray menu.
// Prevents the window `close` interceptor from trapping a real shutdown.
let isQuitting = false;

// ── Window State Management ────────────────────────────────────────────
const MAIN_WINDOW_DEFAULT = { x: null, y: null, width: 1000, height: 700 };

function mainWindowStatePath() {
  return path.join(app.getPath('userData'), 'main-window-state.json');
}

function loadMainWindowState() {
  try {
    const p = mainWindowStatePath();
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    // Corrupt or unreadable — fall through to defaults.
  }
  return null;
}

function saveMainWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    const [x, y] = mainWindow.getPosition();
    const [w, h] = mainWindow.getSize();
    fs.writeFileSync(
      mainWindowStatePath(),
      JSON.stringify({ x, y, width: w, height: h }),
      'utf8'
    );
  } catch {
    // Don't crash the app over a state-write failure.
  }
}

// ── Window creation ────────────────────────────────────────────────────
function createWindow() {
  const state = { ...MAIN_WINDOW_DEFAULT, ...(loadMainWindowState() || {}) };
  
  const opts = {
    width: state.width,
    height: state.height,
    minWidth: 360,
    minHeight: 400,
    title: 'CallerFlash',
    icon: loadTrayIcon(),
    autoHideMenuBar: true,
    // Native Windows 11 styling hints
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#202020',
      symbolColor: '#ffffff',
      height: 36
    },
    // If the renderer opted in to "Start minimized", it will hide the window
    // itself a moment after load. We default to visible here so the
    // first-paint UI shows during boot.
    show: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.cjs'),
    }
  };

  // Only pass x/y when we actually have a saved position; otherwise
  // let Electron choose (center-ish on the primary display).
  if (Number.isFinite(state.x) && Number.isFinite(state.y)) {
    opts.x = state.x;
    opts.y = state.y;
  }

  mainWindow = new BrowserWindow(opts);

  // Load the single-file output from Vite
  mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));

  // Open external links in the default browser instead of inside the app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (typeof url === 'string' && url.startsWith('https:')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // Intercept window-close events. The user can still trigger close via:
  //   • The renderer X button (calls `window:close` IPC → hideWindow())
  //   • Alt+F4 / real OS chrome → fires this `close` event
  //   • Right-click taskbar → Close → fires this `close` event
  // In every case we hide to the tray. The tray "Quit" menu sets
  // `isQuitting = true` so this interceptor lets the close through.
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      saveMainWindowState();
      mainWindow.hide();
      notifyRenderer('window:hidden-to-tray');
    } else {
      saveMainWindowState();
    }
  });

  // Persist position + size on move / resize so the window restores exactly
  // where the user left it, even if they never "close" the app gracefully.
  mainWindow.on('resize', saveMainWindowState);
  mainWindow.on('move', saveMainWindowState);
}

// ── Tray icon + menu ───────────────────────────────────────────────────
function loadTrayIcon() {
  // Tray-specific icon (transparent background). In a packaged build the
  // buildResources/ directory is NOT inside app.asar — extraResources copies the
  // files into process.resourcesPath. Try the packaged location first,
  // then fall back to the source-tree location (dev mode).
  const resPath = typeof process.resourcesPath === 'string' ? process.resourcesPath : '';
  const candidates = [
    path.join(resPath, 'cflogo.ico'),
    path.join(resPath, 'cflogo.png'),
    path.join(__dirname, '../buildResources/cflogo.ico'),
    path.join(__dirname, '../buildResources/cflogo.png'),
    path.join(__dirname, '../buildResources/tray-icon.ico'),
    path.join(__dirname, '../buildResources/tray-icon.png'),
    path.join(__dirname, '../buildResources/Untitled.png'),
    path.join(__dirname, '../buildResources/icon.ico'),
    path.join(__dirname, '../buildResources/icon.png'),
  ];
  for (const iconPath of candidates) {
    try {
      const img = nativeImage.createFromPath(iconPath);
      if (!img.isEmpty()) return img;
    } catch {
      // Continue to next candidate
    }
  }
  // Last-resort: empty image. The tray will still appear but without art.
  return nativeImage.createEmpty();
}

function refreshTrayMenu() {
  if (!tray) return;
  const items = [
    {
      label: 'Show CallerFlash',
      click: () => showWindow(),
    },
    {
      label: 'Hide to Tray',
      click: () => hideWindow(),
    },
    { type: 'separator' },
    {
      label: `SIP: ${lastSipStatus}`,
      enabled: false, // Status indicator only — not interactive
    },
  ];

  if (updateAvailableVersion) {
    const cleanVer = updateAvailableVersion.replace(/^v/, '').replace(/^0\.0\.0-/, '');
    items.push({ type: 'separator' });
    items.push({
      label: `⬆ Update available: ${cleanVer}`,
      click: () => {
        showWindow();
        // Tell the renderer to navigate to the Updates tab.
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('navigate-to-update');
        }
      },
    });
  }

  items.push({ type: 'separator' });
  items.push({
    label: 'Quit CallerFlash',
    click: () => {
      isQuitting = true;
      app.quit();
    },
  });

  const menu = Menu.buildFromTemplate(items);
  tray.setContextMenu(menu);
  const tip = updateAvailableVersion
    ? `CallerFlash — SIP ${lastSipStatus} · Update ${updateAvailableVersion.replace(/^v/, '').replace(/^0\.0\.0-/, '')} available`
    : `CallerFlash — SIP ${lastSipStatus}`;
  tray.setToolTip(tip);
}

function createTray() {
  trayIconDefault = loadTrayIcon();
  tray = new Tray(trayIconDefault);

  // Pre-generate icon variants with a status dot in the top-right corner.
  // The base icon is kept exactly as-is (transparent background preserved).
  // A small solid circle is drawn in the top-right corner for SIP status.
  const size = 32;
  const baseBuf = trayIconDefault.resize({ width: size, height: size }).toBitmap();

  function makeStatusIcon(cr, cg, cb) {
    // nativeImage.createFromBuffer expects BGRA pixel format.
    // Start with a copy of the base icon.
    const buf = Buffer.from(baseBuf);

    // Draw a solid colored circle in the top-right corner.
    const dotCx = size - 6; // 6px from right edge
    const dotCy = 6;        // 6px from top edge
    const dotR = 5;         // radius

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = x - dotCx;
        const dy = y - dotCy;
        if (dx * dx + dy * dy <= dotR * dotR) {
          const i = (y * size + x) * 4;
          buf[i]     = cb; // B
          buf[i + 1] = cg; // G
          buf[i + 2] = cr; // R
          buf[i + 3] = 255; // A (fully opaque)
        }
      }
    }

    return nativeImage.createFromBuffer(buf, { width: size, height: size });
  }

  // Green = registered, Yellow = connecting, Red = offline
  trayIconGreen  = makeStatusIcon(0x6c, 0xcb, 0x5f); // #6ccb5f
  trayIconYellow = makeStatusIcon(0xfc, 0xb8, 0x27); // #fcb827
  trayIconRed    = makeStatusIcon(0xff, 0x6b, 0x6b); // #ff6b6b

  // Windows convention: single left-click toggles window visibility.
  // Double-click is also accepted as a convenience for users who expect it.
  tray.on('click', () => toggleWindow());
  tray.on('double-click', () => showWindow());

  refreshTrayMenu();
}

// ── Window visibility helpers ──────────────────────────────────────────
function showWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  notifyRenderer('window:restored-from-tray');
}

function hideWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isVisible()) {
    mainWindow.hide();
    notifyRenderer('window:hidden-to-tray');
  }
}

function toggleWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const visible = mainWindow.isVisible() && !mainWindow.isMinimized();
  if (visible) hideWindow();
  else showWindow();
}

// ── IPC: SIP Engine (Real network backend) ─────────────────────────────
ipcMain.handle('sip:connect', async (_event, config) => {
  return new Promise((resolve) => {
    sipClient.connect(config, {
      onConnected: () => {
        // TCP/UDP socket bound
      },
      onRegistered: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('sip:status', { status: 'registered' });
        }
        resolve({ success: true });
      },
      onError: (message) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('sip:status', { status: 'error', message });
        }
        resolve({ success: false, message });
      },
      onInvite: (callerData) => {
        // Incoming call hit the wire! Trigger toast.
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('sip:invite', callerData);
        }
      }
    });
  });
});

ipcMain.handle('sip:disconnect', async () => {
  sipClient.disconnect();
  return { success: true };
});

// Send an event to the renderer so it can keep its UI in sync
// (e.g., swap MinimizedShell for the full UI when restored from tray).
function notifyRenderer(channel) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel);
  }
}

// ── IPC: window controls ───────────────────────────────────────────────
ipcMain.on('window:minimize', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.minimize();
  }
});

ipcMain.on('window:maximize', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});

ipcMain.on('window:close', () => hideWindow());
ipcMain.on('window:hide-to-tray', () => hideWindow());
ipcMain.on('window:show', () => showWindow());

// ── Toast window (separate frameless BrowserWindow) ─────────────
// A dedicated always-on-top, transparent, frameless window that
// renders incoming-call alerts. Lives independently of the main
// window so toasts still appear when the main app is hidden to the
// tray.
let toastWindow = null;
// Buffered toast events. The toast window's renderer needs to load
// before it can receive IPC events; if the renderer is still loading
// when toast:show arrives, the event is buffered here and flushed
// once `did-finish-load` fires. Without this, the very first toast
// after app launch is silently dropped.
let pendingToasts = [];
let toastRendererReady = false;

const TOAST_DEFAULT = { x: null, y: null, width: 380, height: 150 };

function toastStatePath() {
  return path.join(app.getPath('userData'), 'toast-window-state.json');
}

function loadToastState() {
  try {
    const p = toastStatePath();
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    // Corrupt or unreadable — fall through to defaults.
  }
  return null;
}

function saveToastState() {
  if (!toastWindow || toastWindow.isDestroyed()) return;
  try {
    const [x, y] = toastWindow.getPosition();
    const [w, h] = toastWindow.getSize();
    fs.writeFileSync(
      toastStatePath(),
      JSON.stringify({ x, y, width: w, height: h }),
      'utf8'
    );
  } catch {
    // Don't crash the app over a state-write failure.
  }
}

function createToastWindow() {
  if (toastWindow && !toastWindow.isDestroyed()) return toastWindow;

  const state = { ...TOAST_DEFAULT, ...(loadToastState() || {}) };
  const opts = {
    width: state.width,
    height: state.height,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: true, // was false; needed for show() to be reliable
    hasShadow: false,
    paintWhenInitiallyHidden: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  };
  // Only pass x/y when we actually have a saved position; otherwise
  // let Electron choose (center-ish on the primary display).
  if (Number.isFinite(state.x) && Number.isFinite(state.y)) {
    opts.x = state.x;
    opts.y = state.y;
  }
  toastWindow = new BrowserWindow(opts);

  // The renderer detects ?toast=1 and renders the dedicated ToastWindow
  // component instead of the main app shell.
  toastWindow.loadFile(path.join(__dirname, '../dist/index.html'), {
    search: 'toast=1',
  });

  toastWindow.setMenuBarVisibility(false);
  toastWindow.setAlwaysOnTop(true, 'screen-saver');

  // Reset the ready flag on (re)load so events that arrive between
  // a reload and the new renderer's mount get buffered, not dropped.
  toastRendererReady = false;
  toastWindow.webContents.on('did-finish-load', () => {
    toastRendererReady = true;
    // Flush anything that arrived while the renderer was loading.
    for (const data of pendingToasts) {
      toastWindow.webContents.send('toast:show:event', data);
    }
    pendingToasts = [];
  });

  // Persist position + size on every move / resize so closing & reopening
  // the app restores the toast window exactly where the user left it.
  toastWindow.on('resize', saveToastState);
  toastWindow.on('move', saveToastState);

  return toastWindow;
}

ipcMain.on('toast:show', (_event, data) => {
  const win = createToastWindow();
  // Always re-show — even if previously hidden, the toast window
  // must come back every time a new call comes in.
  if (!win.isVisible()) win.show();
  if (toastRendererReady) {
    win.webContents.send('toast:show:event', data);
  } else {
    // Renderer still loading (first toast after app launch is the
    // typical case) — buffer until `did-finish-load` fires.
    pendingToasts.push(data);
  }
});

ipcMain.on('toast:hide', () => {
  if (toastWindow && !toastWindow.isDestroyed() && toastWindow.isVisible()) {
    toastWindow.hide();
  }
});

ipcMain.on('toast:set-position', (_event, x, y) => {
  if (!toastWindow || toastWindow.isDestroyed()) return;
  if (typeof x !== 'number' || typeof y !== 'number') return;
  toastWindow.setPosition(Math.round(x), Math.round(y));
  saveToastState();
});

ipcMain.handle('toast:get-position', () => {
  if (!toastWindow || toastWindow.isDestroyed()) return null;
  return toastWindow.getPosition();
});

// ── IPC: shell link opening (mirror of preload bridge) ─────────────────
ipcMain.on('shell:open-external', (_event, url) => {
  if (typeof url === 'string' && url.startsWith('https:')) {
    shell.openExternal(url);
  }
});

// ── IPC: system notifications (triggers a native OS toast) ─────────────
// Used by the renderer when an update is verified + downloaded to let
// the user know via the OS notification surface, in addition to the
// tray menu.
ipcMain.on('notify:show', (_event, title, body) => {
  if (!app.isReady() || !Notification?.isSupported?.()) return;
  const safeTitle = typeof title === 'string' ? title.slice(0, 120) : 'CallerFlash';
  const safeBody = typeof body === 'string' ? body.slice(0, 240) : '';
  const n = new Notification({
    title: safeTitle,
    body: safeBody,
    silent: false,
  });
  n.show();
  // If the main window exists, clicking the notification brings it
  // forward so the user lands on the Updates tab.
  n.on('click', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      if (!mainWindow.isVisible()) mainWindow.show();
      mainWindow.focus();
    }
  });
});

// ── IPC: safeStorage (DPAPI on Windows) ────────────────────────────────
// Wraps the main-process safeStorage API for the sandboxed renderer.
ipcMain.handle('safe-storage:encrypt', async (_event, plaintext) => {
  if (typeof plaintext !== 'string' || plaintext.length === 0) return null;
  if (!safeStorage.isEncryptionAvailable()) return null;
  try {
    const buf = safeStorage.encryptString(plaintext);
    return buf.toString('base64');
  } catch {
    return null;
  }
});

ipcMain.handle('safe-storage:decrypt', async (_event, base64Cipher) => {
  if (typeof base64Cipher !== 'string' || base64Cipher.length === 0) return null;
  if (!safeStorage.isEncryptionAvailable()) return null;
  try {
    const buf = Buffer.from(base64Cipher, 'base64');
    return safeStorage.decryptString(buf);
  } catch {
    return null;
  }
});

// ── IPC: updater channels ────────────────────────────────────────────
ipcMain.handle('updater:check', async () => ({ status: 'noop' }));
ipcMain.handle('updater:download', async () => ({ status: 'noop' }));

/**
 * One-click update: download the installer from the given URL and run it.
 * The installer is saved to the OS temp directory, executed, and the app
 * quits so the installer can replace the running binary.
 */
ipcMain.on('updater:install', async (_event, downloadUrl) => {
  // Validate the URL — only allow HTTPS from GitHub's CDN.
  if (typeof downloadUrl !== 'string' || !downloadUrl.startsWith('https://')) {
    console.error('[updater] Refusing non-HTTPS download URL:', downloadUrl);
    return;
  }
  const allowedHosts = ['objects.githubusercontent.com', 'github.com', 'releases.githubusercontent.com'];
  let parsed;
  try { parsed = new URL(downloadUrl); } catch { return; }
  if (!allowedHosts.includes(parsed.hostname)) {
    console.error('[updater] Refusing download from non-allowed host:', parsed.hostname);
    return;
  }

  // Always use a clean fixed filename to avoid issues with complex
  // multi-dot names from GitHub (e.g. CallerFlash.Setup.1.5.0-nightly.bfb419d.exe)
  // where Windows can misparse the extension.
  const tmpDir = app.getPath('temp');
  const filePath = path.join(tmpDir, 'CallerFlash-Update.exe');

  // Notify the renderer that download + install is starting.
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('updater:status', { status: 'downloading', message: 'Downloading update…' });
  }

  const download = (url) => new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const request = mod.get(url, { headers: { 'User-Agent': 'CallerFlash-Updater' } }, (response) => {
      // Follow redirects (GitHub CDN uses 302).
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        download(response.headers.location).then(resolve).catch(reject);
        return;
      }
      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode}`));
        return;
      }
      const totalBytes = parseInt(response.headers['content-length'] || '0', 10);
      let received = 0;
      const fileStream = fs.createWriteStream(filePath);
      response.on('data', (chunk) => {
        received += chunk.length;
        if (totalBytes > 0 && mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('updater:status', {
            status: 'downloading',
            progress: Math.round((received / totalBytes) * 100),
          });
        }
      });
      response.pipe(fileStream);
      fileStream.on('finish', () => {
        fileStream.close();
        resolve(filePath);
      });
      fileStream.on('error', (err) => {
        fs.unlink(filePath, () => {});
        reject(err);
      });
    });
    request.on('error', reject);
    request.setTimeout(300_000, () => { request.destroy(); reject(new Error('Download timeout')); });
  });

  try {
    const savedPath = await download(downloadUrl);
    console.log('[updater] Downloaded to:', savedPath);

    // Verify the file exists and is an .exe before launching.
    if (!fs.existsSync(savedPath)) {
      throw new Error('Downloaded file not found at ' + savedPath);
    }
    const stats = fs.statSync(savedPath);
    if (stats.size < 1000000) {
      throw new Error('Downloaded file is too small (' + stats.size + ' bytes) — likely not a valid installer');
    }
    // Ensure the file has .exe extension (Windows needs this to execute it).
    let execPath = savedPath;
    if (process.platform === 'win32' && !savedPath.toLowerCase().endsWith('.exe')) {
      execPath = savedPath + '.exe';
      fs.renameSync(savedPath, execPath);
    }

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('updater:status', { status: 'installing', message: 'Launching installer…' });
    }

    // Launch the installer and quit the app so the installer can replace files.
    // For NSIS installers, `/S` runs it silently, `/D=...` overrides the install dir.
    // We pass `/S` to make it a seamless background update.
    // We also pass `--updated` so the app knows it was just updated and should launch visibly.
    const args = ['/S', '--updated'];
    
    // We need to figure out where the app is installed to pass it to the installer, 
    // otherwise the silent installer defaults to C:\Program Files (or AppData) and might create a parallel install.
    // process.execPath is usually `<InstallDir>\CallerFlash.exe`
    const installDir = path.dirname(process.execPath);
    if (installDir && fs.existsSync(installDir) && !installDir.includes('temp') && !installDir.includes('tmp')) {
      args.push(`/D=${installDir}`);
    }

    const safeExecPath = execPath.replace(/\\/g, '\\\\');
    const safeArgs = args.map(a => a.startsWith('/D=') ? a.replace(/\\/g, '\\\\') : a).join(' ');
    
    // Read the logo from the ASAR to embed in the progress window
    let base64Logo = '';
    try {
      const logoPath = path.join(__dirname, '../buildResources/cflogo.png');
      base64Logo = 'data:image/png;base64,' + fs.readFileSync(logoPath).toString('base64');
    } catch { /* ignore missing logo */ }

    // Write a tiny HTML Application (HTA) script to the temp folder. 
    // HTA allows us to show a beautifully styled, borderless progress window 
    // that stays open and animated while our main Electron process completely shuts down!
    const htaContent = \`
    <!DOCTYPE html>
    <html>
    <head>
    <meta http-equiv="x-ua-compatible" content="ie=edge">
    <title>Updating CallerFlash</title>
    <HTA:APPLICATION ID="oUpdater" APPLICATIONNAME="Updater" ICON="\${process.execPath.replace(/\\\\/g, '\\\\\\\\')}" BORDER="dialog" CAPTION="yes" CONTEXTMENU="no" INNERBORDER="no" MAXIMIZEBUTTON="no" MINIMIZEBUTTON="no" SCROLL="no" SYSMENU="no" SHOWINTASKBAR="yes" SINGLEINSTANCE="yes" />
    <script>
        window.resizeTo(420, 160);
        window.moveTo((screen.width - 420) / 2, (screen.height - 160) / 2);
        
        function runUpdate() {
            var wsh = new ActiveXObject("WScript.Shell");
            var cmd = '"\${safeExecPath}" \${safeArgs}';
            setTimeout(function() {
                wsh.Run(cmd, 0, true);
                window.close();
            }, 2000);
        }
    </script>
    <style>
        body { font-family: 'Segoe UI', system-ui, sans-serif; background: #1a1a2e; color: #fff; padding: 25px; overflow: hidden; margin: 0; box-sizing: border-box; display: flex; align-items: center; gap: 15px; border: 1px solid #333; }
        .icon { width: 50px; height: 50px; flex-shrink: 0; background: rgba(96, 205, 255, 0.15); border-radius: 12px; padding: 10px; box-sizing: border-box; }
        .icon img { width: 100%; height: 100%; object-fit: contain; }
        .content { flex: 1; min-width: 0; }
        .title { font-weight: 600; font-size: 16px; color: #60cdff; margin-bottom: 4px; }
        .desc { font-size: 12px; color: #a0a0a0; margin-bottom: 12px; }
        .loader { width: 100%; height: 4px; background: #000; position: relative; overflow: hidden; border-radius: 2px; }
        .bar { position: absolute; left: -50%; width: 50%; height: 100%; background: #60cdff; animation: slide 1.5s infinite ease-in-out; }
        @keyframes slide { 0% { left: -50%; } 100% { left: 100%; } }
    </style>
    </head>
    <body onload="runUpdate()">
        <div class="icon">
           <img src="\${base64Logo}" />
        </div>
        <div class="content">
          <div class="title">Installing Update...</div>
          <div class="desc">Please wait, CallerFlash will restart automatically.</div>
          <div class="loader"><div class="bar"></div></div>
        </div>
    </body>
    </html>
    \`;

    const htaPath = path.join(tmpDir, 'CallerFlash-Updater.hta');
    fs.writeFileSync(htaPath, htaContent, 'utf8');

    // Launch the HTA window detached.
    const child = spawn('mshta.exe', [htaPath], {
      detached: true,
      stdio: 'ignore',
      shell: false,
    });
    child.unref();

    // Give the app time to flush state and fully exit before the
    // installer starts replacing files. 2s is generous but safe.
    setTimeout(() => {
      isQuitting = true;
      app.quit();
    }, 500);
  } catch (err) {
    console.error('[updater] Install failed:', err.message);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('updater:status', { status: 'error', message: err.message });
    }
  }
});

ipcMain.on('updater:set-channel', () => { /* handled by separate feature */ });

// ── IPC: tray status sync ──────────────────────────────────────────────
// Renderer pushes the current SIP status string so the tray tooltip
// and "SIP: …" menu label reflect reality.
ipcMain.on('tray:set-sip-status', (_event, status) => {
  if (typeof status === 'string' && status.length > 0 && status.length < 64) {
    lastSipStatus = status;
    refreshTrayMenu();
    // Swap tray icon color to reflect SIP state.
    if (tray && !tray.isDestroyed()) {
      const icon = status === 'Registered' ? trayIconGreen
        : status === 'Connecting' ? trayIconYellow
        : trayIconRed;
      if (icon && !icon.isEmpty()) tray.setImage(icon);
    }
  }
});

// Renderer pushes update availability so the tray can show it.
ipcMain.on('tray:set-update-available', (_event, version) => {
  updateAvailableVersion = (typeof version === 'string' && version.length > 0) ? version : null;
  refreshTrayMenu();
});

// ── Second-instance handler ────────────────────────────────────────────
app.on('second-instance', () => showWindow());

// ── App lifecycle ──────────────────────────────────────────────────────
app.whenReady().then(() => {
  createWindow();
  createTray();

  app.on('activate', () => {
    // macOS: re-create the window when the dock icon is clicked.
    // On Windows this is a no-op unless both window and tray were lost.
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
      createTray();
    }
  });
});

// IMPORTANT: do NOT quit on window-all-closed. The tray keeps the app
// alive in the background so SIP registration and call detection
// continue running. The tray "Quit CallerFlash" menu is the only
// legitimate exit path.
app.on('window-all-closed', () => {
  // Intentionally empty — see comment above.
});

app.on('before-quit', () => {
  isQuitting = true;
  if (tray) {
    tray.destroy();
    tray = null;
  }
});
