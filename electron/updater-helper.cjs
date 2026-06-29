// CallerFlash Updater Helper
// This is a standalone script that waits for the main app to exit,
// runs the NSIS installer, then relaunches the app.
//
// It's spawned by the main app during install. Because it's a separate
// process, NSIS can replace the main app's files without contention.
//
// Usage: node updater-helper.cjs --installer <path> --app <path> --dir <install-dir>

const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

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
  console.error('Usage: updater-helper --installer <path> --app <path> [--dir <install-dir>] [--pid <parent-pid>]');
  process.exit(1);
}

console.log('[updater-helper] installer:', installerPath);
console.log('[updater-helper] app:', appPath);
console.log('[updater-helper] installDir:', installDir || 'auto');

async function waitForProcessExit(pid, timeoutMs = 30000) {
  if (!pid) return true;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      // Check if process is still running (Windows)
      execSync(`tasklist /FI "PID eq ${pid}" /NH`, { stdio: 'pipe' });
      // If we get here, process exists — wait and retry
      await new Promise(r => setTimeout(r, 500));
    } catch {
      // Process not found — it exited
      return true;
    }
  }
  return false; // Timeout
}

async function main() {
  try {
    // Wait for parent process (main app) to exit
    if (parentPid) {
      console.log('[updater-helper] waiting for main app to exit (PID:', parentPid, ')');
      await waitForProcessExit(parseInt(parentPid, 10));
      // Extra delay to ensure file handles are released
      await new Promise(r => setTimeout(r, 2000));
    }

    // Verify installer exists
    if (!fs.existsSync(installerPath)) {
      console.error('[updater-helper] installer not found:', installerPath);
      process.exit(1);
    }

    // Determine install directory
    const targetDir = installDir || path.dirname(appPath);

    console.log('[updater-helper] running NSIS installer...');

    // Run NSIS installer silently
    const nsisArgs = ['/S'];
    if (targetDir && !targetDir.toLowerCase().includes('temp')) {
      nsisArgs.push('/D=' + targetDir);
    }

    const proc = spawn(installerPath, nsisArgs, {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    });
    proc.unref();

    // Wait for installer to finish (NSIS spawns a subprocess, so we poll)
    await new Promise(resolve => {
      const checkInterval = setInterval(() => {
        try {
          execSync(`tasklist /FI "IMAGENAME eq ${path.basename(installerPath)}" /NH`, { stdio: 'pipe' });
        } catch {
          // Installer process gone
          clearInterval(checkInterval);
          resolve();
        }
      }, 1000);

      // Timeout after 5 minutes
      setTimeout(() => {
        clearInterval(checkInterval);
        resolve();
      }, 300000);
    });

    console.log('[updater-helper] installer finished, relaunching app...');

    // Relaunch the app
    if (fs.existsSync(appPath)) {
      spawn(appPath, [], {
        detached: true,
        stdio: 'ignore',
      }).unref();
    }

    console.log('[updater-helper] done.');
    process.exit(0);
  } catch (err) {
    console.error('[updater-helper] error:', err.message);
    process.exit(1);
  }
}

main();
