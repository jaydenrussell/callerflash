const { app, BrowserWindow, nativeImage, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const { spawn } = require('child_process');
const { createHash } = require('crypto');

// ── Module-level state ─────────────────────────────────────────────────
let mainWindowRef = null;
let updaterWindow = null;
let updaterCanClose = false;
let activeDownload = null; // { cancel: fn }

// ── Helpers ─────────────────────────────────────────────────────────────
const log = (...args) => console.log('[updater]', ...args);
const logErr = (...args) => console.error('[updater]', ...args);

function downloadsDir() {
  const dir = path.join(app.getPath('temp'), 'callerflash-updates');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function exePathFor(version) {
  return path.join(downloadsDir(), `CallerFlash-${version}.exe`);
}

function loadAppIcon() {
  const resPath = process.resourcesPath || '';
  for (const iconPath of [
    path.join(resPath, 'cflogo.png'),
    path.join(resPath, 'cflogo.ico'),
    path.join(__dirname, '../buildResources/cflogo.png'),
    path.join(__dirname, '../buildResources/cflogo.ico'),
  ]) {
    try {
      const img = nativeImage.createFromPath(iconPath);
      if (!img.isEmpty()) return img;
    } catch { /* continue */ }
  }
  return nativeImage.createEmpty();
}

// ── Send to updater window ─────────────────────────────────────────────
function sendStatus(payload) {
  if (updaterWindow && !updaterWindow.isDestroyed()) {
    updaterWindow.webContents.send('updater:status', payload);
  }
  // Also send to main window if it exists
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    mainWindowRef.webContents.send('updater:status', payload);
  }
}

function sendProgress(payload) {
  if (updaterWindow && !updaterWindow.isDestroyed()) {
    updaterWindow.webContents.send('updater:progress', payload);
  }
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    mainWindowRef.webContents.send('updater:progress', payload);
  }
}

// ── Friendly version ───────────────────────────────────────────────────
function friendlyVersion(version) {
  if (!version) return 'Unknown';
  const v = version.replace(/^v/, '');
  const nightly = v.match(/nightly[.\-](\d{4})(\d{2})(\d{2})(?:[.\-](\d+))?/);
  if (nightly) {
    const [, y, m, d, n] = nightly;
    return `Nightly ${y}.${m}.${d}${n ? ' #' + n : ''}`;
  }
  if (/beta/i.test(v)) return `Beta ${v.replace(/[.\-]beta.*/, '')}`;
  return `Version ${v}`;
}

// ── Fetch JSON from URL ────────────────────────────────────────────────
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const transport = parsed.protocol === 'https:' ? https : http;
    const req = transport.get(url, {
      headers: { 'User-Agent': 'CallerFlash-Updater', Accept: 'application/json' },
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return fetchJson(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      let body = '';
      res.on('data', (c) => body += c);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error('Invalid JSON')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(new Error('Timeout')); });
  });
}

// ── Find release for channel ──────────────────────────────────────────
function findRelease(releases, channel) {
  if (!Array.isArray(releases) || !releases.length) return null;
  const sorted = [...releases].sort((a, b) =>
    new Date(b.published_at || 0) - new Date(a.published_at || 0));

  if (channel === 'stable') {
    return sorted.find((r) => !r.prerelease && !r.draft) || null;
  }
  if (channel === 'beta') {
    return sorted.find((r) => /beta/i.test(r.tag_name)) || null;
  }
  // nightly
  return sorted.find((r) => /nightly/i.test(r.tag_name)) || null;
}

function getExeUrl(release) {
  const exe = (release.assets || []).find((a) => /\.exe$/i.test(a.name));
  return exe ? exe.browser_download_url : null;
}

// ── Check for updates ──────────────────────────────────────────────────
async function checkForUpdates(channel) {
  log('checking channel:', channel);

  const releases = await fetchJson('https://api.github.com/repos/jaydenrussell/CallerFlash/releases');
  if (!Array.isArray(releases)) return { error: 'Invalid GitHub response' };

  const release = findRelease(releases, channel);
  if (!release) {
    log('no release for channel:', channel);
    return { upToDate: true, version: app.getVersion() };
  }

  const version = release.tag_name.replace(/^v/, '');
  const currentVersion = app.getVersion();
  const releaseDate = new Date(release.published_at || release.created_at);

  log('found:', version, 'published:', releaseDate.toISOString(), 'current:', currentVersion);

  // Compare by release date for non-stable channels
  if (channel !== 'stable') {
    let buildTime = Date.now();
    try { buildTime = fs.statSync(process.execPath).mtimeMs; } catch {}

    if (releaseDate.getTime() <= buildTime) {
      log('release is same or older than current build → up to date');
      return { upToDate: true, version: currentVersion };
    }
  } else {
    // Stable: simple semver compare
    const remote = version.replace(/[-+].*/, '').split('.').map(Number);
    const local = currentVersion.replace(/[-+].*/, '').split('.').map(Number);
    let newer = false;
    for (let i = 0; i < 3; i++) {
      const r = remote[i] || 0, l = local[i] || 0;
      if (r > l) { newer = true; break; }
      if (r < l) break;
    }
    if (!newer) return { upToDate: true, version: currentVersion };
  }

  const downloadUrl = getExeUrl(release);
  return {
    version,
    friendlyName: friendlyVersion(version),
    downloadUrl,
    releaseDate: releaseDate.toISOString(),
  };
}

// ── Download update ────────────────────────────────────────────────────
async function downloadUpdate(channel, version, downloadUrl) {
  if (activeDownload) { log('download already in progress'); return { status: 'busy' }; }

  const destPath = exePathFor(version);

  // Already downloaded?
  if (fs.existsSync(destPath)) {
    log('already downloaded:', destPath);
    sendStatus({ status: 'ready' });
    return { status: 'ready', path: destPath };
  }

  if (!downloadUrl) {
    log('ERROR: no download URL provided');
    sendStatus({ status: 'error', message: 'No download URL' });
    return { status: 'error', error: 'No URL' };
  }

  // Clean old downloads
  try {
    for (const f of fs.readdirSync(downloadsDir())) {
      if (f.endsWith('.exe') && !f.includes(version)) {
        fs.unlinkSync(path.join(downloadsDir(), f));
      }
    }
  } catch {}

  log('downloading:', downloadUrl, '→', destPath);
  sendStatus({ status: 'downloading', message: 'Connecting…' });

  try {
    await new Promise((resolve, reject) => {
      const parsed = new URL(downloadUrl);
      const transport = parsed.protocol === 'https:' ? https : http;
      const file = fs.createWriteStream(destPath);

      const req = transport.get(downloadUrl, {
        headers: { 'User-Agent': 'CallerFlash-Updater' },
      }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          // Follow redirect
          downloadUpdate(channel, version, res.headers.location).then(resolve).catch(reject);
          return;
        }
        if (res.statusCode !== 200) {
          file.close();
          return reject(new Error(`HTTP ${res.statusCode}`));
        }

        const total = parseInt(res.headers['content-length'] || '0', 10);
        let received = 0;

        res.on('data', (chunk) => {
          received += chunk.length;
          const pct = total > 0 ? Math.round((received / total) * 100) : 0;
          sendProgress({ pct, received, total });
        });

        res.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve();
        });
      });

      req.on('error', reject);
      req.setTimeout(120000, () => { req.destroy(new Error('Download timeout')); });
    });

    activeDownload = null;
    log('download complete:', destPath);
    sendStatus({ status: 'ready' });
    return { status: 'ready', path: destPath };
  } catch (err) {
    activeDownload = null;
    logErr('download failed:', err.message);
    try { fs.unlinkSync(destPath); } catch {}
    sendStatus({ status: 'error', message: err.message });
    return { status: 'error', error: err.message };
  }
}

// ── Install update ─────────────────────────────────────────────────────
function installUpdate(version) {
  const exePath = exePathFor(version);
  if (!fs.existsSync(exePath)) {
    sendStatus({ status: 'error', message: 'File not found. Download again.' });
    return { status: 'error' };
  }

  sendStatus({ status: 'installing', message: 'Starting installer…' });

  // Spawn helper process that waits for us to exit, then runs NSIS
  const helperPath = path.join(__dirname, 'updater-helper.cjs');
  const appExe = process.execPath;
  const installDir = path.dirname(appExe);

  log('spawning helper:', helperPath);
  log('  installer:', exePath);
  log('  app:', appExe);
  log('  dir:', installDir);
  log('  pid:', process.pid);

  try {
    const helper = spawn(process.execPath, [
      helperPath,
      '--installer', exePath,
      '--app', appExe,
      '--dir', installDir,
      '--pid', String(process.pid),
    ], { detached: true, stdio: 'ignore', windowsHide: true });
    helper.unref();
  } catch (err) {
    logErr('failed to spawn helper:', err.message);
    sendStatus({ status: 'error', message: 'Failed to start installer' });
    return { status: 'error' };
  }

  // Quit after a delay
  setTimeout(() => {
    updaterCanClose = true;
    app.quit();
  }, 1500);

  return { status: 'installing' };
}

// ── Updater progress window ────────────────────────────────────────────
function showUpdaterWindow() {
  if (updaterWindow && !updaterWindow.isDestroyed()) {
    updaterWindow.show();
    updaterWindow.focus();
    return;
  }

  let x, y;
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    const [wx, wy] = mainWindowRef.getPosition();
    const [ww, wh] = mainWindowRef.getSize();
    x = Math.round(wx + ww / 2 - 170);
    y = Math.round(wy + wh * 0.2 - 160);
  }

  updaterWindow = new BrowserWindow({
    width: 340, height: 420,
    frame: false, resizable: false, maximizable: false, minimizable: false,
    show: false, alwaysOnTop: true, skipTaskbar: true,
    backgroundColor: '#0d0d0d', icon: loadAppIcon(),
    x, y,
    webPreferences: {
      nodeIntegration: false, contextIsolation: true, sandbox: true,
      preload: path.join(__dirname, 'updaterPreload.cjs'),
    },
  });

  updaterWindow.on('close', (e) => { if (!updaterCanClose) e.preventDefault(); });
  updaterWindow.loadURL(`data:text/html;base64,${getUpdaterHtml()}`);
  updaterWindow.once('ready-to-show', () => { updaterWindow.show(); updaterWindow.focus(); });
}

// ── Inline HTML for updater window ─────────────────────────────────────
function getUpdaterHtml() {
  // Get app icon as data URL for embedding
  let iconDataUrl = '';
  try {
    const fs = require('fs');
    const resPath = process.resourcesPath || '';
    for (const p of [
      path.join(resPath, 'cflogo.png'),
      path.join(__dirname, '../buildResources/cflogo.png'),
    ]) {
      if (fs.existsSync(p)) {
        iconDataUrl = 'data:image/png;base64,' + fs.readFileSync(p).toString('base64');
        break;
      }
    }
  } catch {}

  return Buffer.from('<!DOCTYPE html><html><head><meta charset="UTF-8"><style>' +
    '*{margin:0;padding:0;box-sizing:border-box}' +
    'html,body{width:100vw;height:100vh;background:#0d0d0d;font-family:\'Segoe UI\',system-ui,sans-serif;color:#f0f0f0;overflow:hidden}' +
    '.title-bar{height:36px;display:flex;align-items:center;justify-content:center;position:relative;-webkit-app-region:drag;flex-shrink:0}' +
    '.title-bar .title{font-size:11px;color:rgba(255,255,255,0.45);font-weight:500}' +
    '.title-bar .close{position:absolute;right:12px;top:50%;transform:translateY(-50%);width:28px;height:28px;border-radius:8px;border:none;background:transparent;color:rgba(255,255,255,0.45);cursor:pointer;-webkit-app-region:no-drag}' +
    '.title-bar .close:hover{background:#ff6b6b;color:#fff}' +
    '.frame{width:340px;height:384px;background:#181818;border-radius:0 0 48px 48px;border:1px solid rgba(255,255,255,0.06);border-top:none;padding:24px 32px;display:flex;flex-direction:column;align-items:center;position:absolute;top:36px;left:50%;transform:translateX(-50%)}' +
    '.logo{width:56px;height:56px;border-radius:16px;padding:8px;background:rgba(96,205,255,0.1);border:1px solid rgba(96,205,255,0.18);display:grid;place-items:center;margin-bottom:16px}' +
    '.logo img{width:100%;height:100%;object-fit:contain}' +
    '.ring{position:relative;width:80px;height:80px;margin-bottom:12px}' +
    '.ring svg{width:100%;height:100%;transform:rotate(-90deg)}' +
    '.ring .track{fill:none;stroke:rgba(255,255,255,0.06);stroke-width:4}' +
    '.ring .fill{fill:none;stroke:#60cdff;stroke-width:4;stroke-linecap:round;stroke-dasharray:226.19;stroke-dashoffset:226.19;transition:stroke-dashoffset .4s ease}' +
    '.ring .fill.indeterminate{animation:spin 1.4s linear infinite;stroke-dashoffset:57}' +
    '@keyframes spin{0%{transform:rotate(0)}100%{transform:rotate(360deg)}}' +
    '.ring .center{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);text-align:center}' +
    '.ring .pct{font-size:16px;font-weight:700}' +
    '.ring .lbl{font-size:8px;color:rgba(255,255,255,0.45);text-transform:uppercase}' +
    '</style></head><body>' +
    '<div class="title-bar"><span class="title">CallerFlash Update</span><button class="close" id="close">&#10005;</button></div>' +
    '<div class="frame">' +
    '<div class="logo"><img src="' + iconDataUrl + '" alt="CallerFlash"/></div>' +
    '<div class="ring"><svg viewBox="0 0 80 80"><circle class="track" cx="40" cy="40" r="36"/><circle class="fill indeterminate" id="fill" cx="40" cy="40" r="36" style="transform-origin:center"/></svg><div class="center"><div class="pct" id="pct">--</div><div class="lbl" id="lbl">Waiting</div></div></div>' +
    '</div>' +
    '<script>' +
    'var fill=document.getElementById("fill"),pct=document.getElementById("pct"),lbl=document.getElementById("lbl");' +
    'var CIRC=2*Math.PI*36;' +
    'function setProgress(p){fill.classList.remove("indeterminate");fill.style.transform="none";fill.style.strokeDashoffset=CIRC*(1-p/100);pct.textContent=Math.round(p)+"%";lbl.textContent="Downloading"}' +
    'function setSpin(){fill.classList.add("indeterminate");pct.textContent="--";lbl.textContent="Working"}' +
    'document.getElementById("close").addEventListener("click",function(){window.close()});' +
    'if(window.callerflashUpdater){' +
    'window.callerflashUpdater.onProgress(function(d){if(d.pct>0)setProgress(d.pct)});' +
    'window.callerflashUpdater.onStatus(function(d){' +
    'if(d.status==="downloading"){setSpin()}' +
    'else if(d.status==="ready"){lbl.textContent="Done";fill.classList.remove("indeterminate");fill.style.strokeDashoffset=0;pct.textContent="100%"}' +
    '});}' +
    '</script></body></html>').toString('base64');
}

// ── IPC handlers ───────────────────────────────────────────────────────
function initUpdaterIPC(mainWindow) {
  mainWindowRef = mainWindow;

  ipcMain.handle('updater:check', async (_e, channel) => {
    const result = await checkForUpdates(channel || 'stable');
    return result || { upToDate: true };
  });

  ipcMain.on('updater:download', async (_e, { channel, version, downloadUrl }) => {
    log('download requested:', channel, version, downloadUrl?.substring(0, 60));
    showUpdaterWindow();
    await downloadUpdate(channel, version, downloadUrl);
  });

  ipcMain.on('updater:install', (_e, { version }) => {
    log('install requested:', version);
    installUpdate(version);
  });

  ipcMain.on('updater:show', () => showUpdaterWindow());
}

module.exports = { initUpdaterIPC };
