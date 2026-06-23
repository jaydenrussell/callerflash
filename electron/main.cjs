// CallerFlash — Electron Main Process
// Hardened per SECURITY.md: sandbox, context-isolation, no node in renderer.

const { app, BrowserWindow, shell, safeStorage, ipcMain, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const { autoUpdater } = require('electron-updater');

// ── Globals ──────────────────────────────────────────────────────────
let mainWindow = null;
let tray = null;
let isQuitting = false;

// ── Auto-updater config ──────────────────────────────────────────────
autoUpdater.autoDownload = false;
autoUpdater.allowPrerelease = false; // overridden per-channel
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.allowDowngrade = false; // version-monotonicity: never roll back

// ── Single instance lock ─────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      mainWindow.show();
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

// ── URL allow-list for shell.openExternal ────────────────────────────
const ALLOWED_EXTERNAL_HOSTS = new Set([
  'github.com',
  'api.github.com',
  'objects.githubusercontent.com',
  'raw.githubusercontent.com',
]);

function isSafeExternalUrl(href) {
  try {
    const url = new URL(href);
    if (url.protocol !== 'https:') return false;
    return ALLOWED_EXTERNAL_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

// ── Create main window ──────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'CallerFlash — SIP Client',
    icon: path.join(__dirname, '../build/icon.ico'),
    frame: false, // custom title bar rendered by React
    backgroundColor: '#202020',
    show: false,
    webPreferences: {
      // ── HARDENED ──
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.cjs'),
      // Disable remote module entirely
      enableRemoteModule: false,
      // Prevent new window creation from renderer
      webviewTag: false,
      // Disable DevTools in production
      devTools: !app.isPackaged ? true : false,
    },
  });

  // Load the Vite-built renderer
  if (!app.isPackaged && process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  // Show when ready (prevents white flash)
  mainWindow.once('ready-to-show', () => {
    // Check if "start minimized" preference is saved
    // The renderer sends this via IPC after reading localStorage
    // Default: show normally
    mainWindow.show();
  });

  // ── Security: block navigation and new windows ────────────────────
  mainWindow.webContents.on('will-navigate', (event, url) => {
    // Only allow same-origin navigation (hot-reload in dev)
    if (app.isPackaged || !url.startsWith(process.env.VITE_DEV_SERVER_URL || '')) {
      event.preventDefault();
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // Open external links in the default browser, gated by allow-list
    if (isSafeExternalUrl(url)) {
      shell.openExternal(url);
    }
    return { action: 'deny' }; // Never open in Electron
  });

  // Minimize to tray instead of closing
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ── System tray ─────────────────────────────────────────────────────
function createTray() {
  const iconPath = path.join(__dirname, '../build/icon.png');
  tray = new Tray(nativeImage.createFromPath(iconPath));

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Open CallerFlash', click: () => mainWindow?.show() },
    { type: 'separator' },
    { label: 'Check for Updates', click: () => autoUpdater.checkForUpdates() },
    { type: 'separator' },
    { label: 'Quit', click: () => { isQuitting = true; app.quit(); } },
  ]);

  tray.setToolTip('CallerFlash — SIP Client');
  tray.setContextMenu(contextMenu);
  tray.on('click', () => mainWindow?.show());
}

// ── IPC handlers ────────────────────────────────────────────────────

// Secure credential storage (Windows DPAPI)
ipcMain.handle('safe-storage:encrypt', async (_event, plaintext) => {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('safeStorage encryption not available on this system');
  }
  return safeStorage.encryptString(plaintext).toString('base64');
});

ipcMain.handle('safe-storage:decrypt', async (_event, base64Cipher) => {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('safeStorage encryption not available on this system');
  }
  return safeStorage.decryptString(Buffer.from(base64Cipher, 'base64'));
});

// Window controls (custom title bar)
ipcMain.on('window:minimize', () => mainWindow?.minimize());
ipcMain.on('window:maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow?.maximize();
  }
});
ipcMain.on('window:close', () => mainWindow?.hide());
ipcMain.on('window:hide-to-tray', () => mainWindow?.hide());
ipcMain.on('window:show', () => mainWindow?.show());

// Open external URL (gated)
ipcMain.on('shell:open-external', (_event, url) => {
  if (isSafeExternalUrl(url)) {
    shell.openExternal(url);
  }
});

// Auto-updater IPC
ipcMain.handle('updater:check', async () => {
  try {
    return await autoUpdater.checkForUpdates();
  } catch (err) {
    return { error: err.message };
  }
});
ipcMain.handle('updater:download', async () => {
  try {
    await autoUpdater.downloadUpdate();
    return { success: true };
  } catch (err) {
    return { error: err.message };
  }
});
ipcMain.on('updater:install', () => {
  isQuitting = true;
  autoUpdater.quitAndInstall(false, true);
});
ipcMain.on('updater:set-channel', (_event, channel) => {
  autoUpdater.allowPrerelease = channel !== 'stable';
  autoUpdater.channel = channel;
});

// Forward updater events to renderer
autoUpdater.on('checking-for-update', () => {
  mainWindow?.webContents.send('updater:status', { type: 'checking' });
});
autoUpdater.on('update-available', (info) => {
  mainWindow?.webContents.send('updater:status', { type: 'available', info });
});
autoUpdater.on('update-not-available', () => {
  mainWindow?.webContents.send('updater:status', { type: 'not-available' });
});
autoUpdater.on('download-progress', (progress) => {
  mainWindow?.webContents.send('updater:status', { type: 'progress', progress });
});
autoUpdater.on('update-downloaded', (info) => {
  mainWindow?.webContents.send('updater:status', { type: 'downloaded', info });
});
autoUpdater.on('error', (err) => {
  mainWindow?.webContents.send('updater:status', { type: 'error', error: err.message });
});

// ── App lifecycle ───────────────────────────────────────────────────
app.on('ready', () => {
  createWindow();
  createTray();
});

app.on('window-all-closed', () => {
  // On Windows, keep running in tray
  if (process.platform !== 'darwin') {
    // Don't quit — tray keeps the app alive
  }
});

app.on('activate', () => {
  if (mainWindow === null) createWindow();
  else mainWindow.show();
});

app.on('before-quit', () => {
  isQuitting = true;
});
