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

// Set to true ONLY when the user explicitly chose Quit from the tray menu.
// Prevents the window `close` interceptor from trapping a real shutdown.
let isQuitting = false;

// ── Window creation ────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    minWidth: 360,
    minHeight: 400,
    title: 'CallerFlash',
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
  });

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
      mainWindow.hide();
      notifyRenderer('window:hidden-to-tray');
    }
  });
}

// ── Tray icon + menu ───────────────────────────────────────────────────
function loadTrayIcon() {
  // Prefer the multi-resolution .ico (16x16, 32x32 baked in).
  // Fall back to the .png if the .ico is missing or unreadable.
  const candidates = [
    path.join(__dirname, '../build/icon.ico'),
    path.join(__dirname, '../build/icon.png'),
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
  const menu = Menu.buildFromTemplate([
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
    { type: 'separator' },
    {
      label: 'Quit CallerFlash',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(menu);
  tray.setToolTip(`CallerFlash — SIP ${lastSipStatus}`);
}

function createTray() {
  tray = new Tray(loadTrayIcon());

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

// ── IPC: updater channels (placeholder) ────────────────────────────────
// The preload bridge exposes these so the renderer can call them without
// crashing; the real auto-update logic ships in a separate change set.
ipcMain.handle('updater:check', async () => ({ status: 'noop' }));
ipcMain.handle('updater:download', async () => ({ status: 'noop' }));
ipcMain.on('updater:install', () => { /* handled by separate feature */ });
ipcMain.on('updater:set-channel', () => { /* handled by separate feature */ });

// ── IPC: tray status sync ──────────────────────────────────────────────
// Renderer pushes the current SIP status string so the tray tooltip
// and "SIP: …" menu label reflect reality.
ipcMain.on('tray:set-sip-status', (_event, status) => {
  if (typeof status === 'string' && status.length > 0 && status.length < 64) {
    lastSipStatus = status;
    refreshTrayMenu();
  }
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
