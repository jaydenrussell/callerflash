const { app, BrowserWindow } = require('electron');
const path = require('path');

// Disable hardware acceleration for better compatibility in background apps
app.disableHardwareAcceleration();

function createWindow () {
  const mainWindow = new BrowserWindow({
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
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      // In production, preload.js would go here to expose safe IPC bridges
      // preload: path.join(__dirname, 'preload.js')
    }
  });

  // Load the single-file output from Vite
  mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  
  // Open external links in default browser instead of the Electron app
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:')) {
      require('electron').shell.openExternal(url);
    }
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
