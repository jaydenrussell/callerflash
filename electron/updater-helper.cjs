// CallerFlash Updater Helper
// ===========================
// This script is spawned by the main app during install.
// It waits for the main app to exit, runs the NSIS installer,
// then relaunches the app.
//
// Because it's a separate process (spawned via process.execPath),
// NSIS can replace the main app's files without contention.
//
// Usage: node updater-helper.cjs --installer <path> --app <path> --dir <install-dir> --pid <parent-pid>

const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
function getArg(name) {
  const idx = args.indexOf(name);
  return idx >= 0 ? args[idx + 1] : null;
}

const installerPath = getArg('--installer');
const appPath = getArg('--app');
const installDir = getArg('--dir');
const parentPid = getArg('--pid');

if (!installerPath || !appPath) {
  console.error('Usage: updater-helper --installer <path> --app <path> [--dir <dir>] [--pid <pid>]');
  process.exit(1);
}

console.log('[updater-helper] Starting...');
console.log('[updater-helper] Installer:', installerPath);
console.log('[updater-helper] App:', appPath);
console.log('[updater-helper] Install dir:', installDir || path.dirname(appPath));
console.log('[updater-helper] Parent PID:', parentPid);

function isProcessRunning(pid) {
  try {
    execSync(`tasklist /FI "PID eq ${pid}" /NH 2>nul`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

async function waitForExit(pid, timeoutMs = 30000) {
  if (!pid) return;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!isProcessRunning(parseInt(pid, 10))) {
      console.log('[updater-helper] Parent process exited');
      return;
    }
    await new Promise(r => setTimeout(r, 500));
  }
  console.log('[updater-helper] Timeout waiting for parent exit, proceeding anyway');
}

async function runInstaller() {
  const targetDir = installDir || path.dirname(appPath);
  const nsisArgs = ['/S'];
  if (targetDir && !targetDir.toLowerCase().includes('temp')) {
    nsisArgs.push('/D=' + targetDir);
  }

  console.log('[updater-helper] Running NSIS installer with args:', nsisArgs.join(' '));

  return new Promise((resolve, reject) => {
    const proc = spawn(installerPath, nsisArgs, {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    });
    proc.on('error', reject);
    proc.on('exit', (code) => {
      console.log('[updater-helper] Installer exited with code:', code);
      resolve(code);
    });
    // Don't wait for exit — NSIS spawns a subprocess
    setTimeout(resolve, 5000);
  });
}

async function relaunchApp() {
  // Wait a bit for installer to finish
  await new Promise(r => setTimeout(r, 3000));

  if (fs.existsSync(appPath)) {
    console.log('[updater-helper] Relaunching app...');
    spawn(appPath, [], { detached: true, stdio: 'ignore' }).unref();
  } else {
    console.error('[updater-helper] App not found at:', appPath);
  }
}

async function main() {
  try {
    // Wait for parent to exit
    if (parentPid) {
      console.log('[updater-helper] Waiting for main app to exit...');
      await waitForExit(parentPid);
      // Extra delay for file handles to release
      await new Promise(r => setTimeout(r, 2000));
    }

    // Run installer
    await runInstaller();

    // Relaunch
    await relaunchApp();

    console.log('[updater-helper] Done.');
    process.exit(0);
  } catch (err) {
    console.error('[updater-helper] Error:', err.message);
    process.exit(1);
  }
}

main();
