const { app, BrowserWindow, ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater');

// ── State ─────────────────────────────────────────────────────────────
let mainWindowRef = null;
let activeDownload = false;

const downloadState = {
  version: null, path: null, status: 'idle', error: null,
};

const log = (...a) => console.log('[updater]', ...a);
const logErr = (...a) => console.error('[updater]', ...a);

// ── Send to renderer ──────────────────────────────────────────────────
function sendStatus(payload) {
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    mainWindowRef.webContents.send('updater:status', payload);
  }
}

function sendProgress(payload) {
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    mainWindowRef.webContents.send('updater:progress', payload);
  }
}

// ── electron-updater event bridge ──────────────────────────────────────
autoUpdater.on('checking-for-update', () => {
  sendStatus({ status: 'checking' });
});

autoUpdater.on('update-not-available', (info) => {
  sendStatus({ status: 'up-to-date', version: info?.version });
});

autoUpdater.on('update-available', (info) => {
  sendStatus({ status: 'update-available', version: info?.version });
});

autoUpdater.on('download-progress', (info) => {
  const percent = typeof info.percent === 'number' ? info.percent : Math.round((info.transferred / info.total) * 100);
  downloadState.status = 'downloading';
  sendProgress({ percent, bytesPerSecond: info.bytesPerSecond || 0, total: info.total || 0, transferred: info.transferred || 0 });
});

autoUpdater.on('update-downloaded', (info) => {
  downloadState.status = 'ready';
  downloadState.version = info?.version || downloadState.version;
  downloadState.path = info?.files?.[0]?.path || info?.path || downloadState.path;
  sendStatus({ status: 'ready', version: downloadState.version });
});

autoUpdater.on('error', (err) => {
  downloadState.status = 'error';
  downloadState.error = err?.message || String(err);
  sendStatus({ status: 'error', message: downloadState.error });
  activeDownload = false;
});

autoUpdater.on('install-on-quit', () => {
  sendStatus({ status: 'installing' });
});

// ── Update lifecycle ──────────────────────────────────────────────────
async function checkForUpdates(channel) {
  const currentVersion = app.getVersion();

  if (!app.isPackaged) {
    log('dev mode: skipping update check');
    return { upToDate: true, version: currentVersion, currentVersion };
  }

  log('checking channel=' + channel + ' current=' + currentVersion);

  return await new Promise((resolve) => {
    const original = autoUpdater.autoDownload;
    autoUpdater.autoDownload = false;
    autoUpdater.checkForUpdates();

    const done = (payload) => {
      autoUpdater.autoDownload = original;
      autoUpdater.removeListener('update-available', onAvailable);
      autoUpdater.removeListener('update-not-available', onNotAvailable);
      autoUpdater.removeListener('error', onError);
      resolve(payload);
    };

    const onAvailable = (info) => done({
      upToDate: false,
      currentVersion,
      version: info?.version || currentVersion,
      friendlyName: info?.version || currentVersion,
      releaseDate: info?.releaseDate || null,
    });

    const onNotAvailable = () => done({ upToDate: true, currentVersion, version: currentVersion });
    const onError = (err) => done({ error: err?.message || String(err), currentVersion, version: currentVersion });

    autoUpdater.once('update-available', onAvailable);
    autoUpdater.once('update-not-available', onNotAvailable);
    autoUpdater.once('error', onError);
  });
}

async function downloadUpdate(channel, version) {
  if (activeDownload) return { status: 'busy' };
  activeDownload = true;
  downloadState.status = 'downloading';
  downloadState.version = version;
  sendStatus({ status: 'downloading', version });

  return await new Promise((resolve) => {
    autoUpdater.autoDownload = true;
    autoUpdater.downloadUpdate();

    const done = (payload) => {
      autoUpdater.removeListener('download-progress', onProgress);
      autoUpdater.removeListener('update-downloaded', onComplete);
      autoUpdater.removeListener('error', onError);
      activeDownload = false;
      resolve(payload);
    };

    const onProgress = (info) => {
      const percent = typeof info.percent === 'number' ? info.percent : Math.round((info.transferred / info.total) * 100);
      downloadState.status = 'downloading';
      sendProgress({ percent, bytesPerSecond: info.bytesPerSecond || 0, total: info.total || 0, transferred: info.transferred || 0 });
    };

    const onComplete = (info) => {
      downloadState.status = 'ready';
      downloadState.version = info?.version || downloadState.version;
      downloadState.path = info?.files?.[0]?.path || info?.path || downloadState.path;
      sendStatus({ status: 'ready', version: downloadState.version });
      done({ status: 'ready', path: downloadState.path });
    };

    const onError = (err) => {
      downloadState.status = 'error';
      downloadState.error = err?.message || String(err);
      sendStatus({ status: 'error', message: downloadState.error });
      done({ status: 'error', error: downloadState.error });
    };

    autoUpdater.on('download-progress', onProgress);
    autoUpdater.once('update-downloaded', onComplete);
    autoUpdater.once('error', onError);
  });
}

function installUpdate(version) {
  downloadState.status = 'installing';
  sendStatus({ status: 'installing', version });
  autoUpdater.quitAndInstall(true, true);
  return { status: 'installing' };
}

// ── IPC handlers ──────────────────────────────────────────────────────
function initUpdaterIPC(mainWindow) {
  mainWindowRef = mainWindow && !mainWindow.isDestroyed() ? mainWindow : mainWindowRef;

  ipcMain.handle('updater:check', async (_e, channel) => {
    return await checkForUpdates(channel || 'stable') || { upToDate: true };
  });

  ipcMain.on('updater:download', async (_e, _opts) => {
    const state = getDownloadState();
    await downloadUpdate('stable', state.version || app.getVersion());
  });

  ipcMain.on('updater:install', (_e, _opts) => {
    const state = getDownloadState();
    installUpdate(state.version || app.getVersion());
  });

  ipcMain.handle('updater:getDownloadState', () => getDownloadState());
}

function getDownloadState() {
  return { ...downloadState };
}

module.exports = { initUpdaterIPC, checkForUpdates, downloadUpdate, installUpdate, getDownloadState };
