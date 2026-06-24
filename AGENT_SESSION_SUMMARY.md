# CallerFlash — Agent Session Summary
> Generated: 2026-06-24 (America/Toronto)
> Repo: https://github.com/jaydenrussell/callerflash
> Branch: `main`

---

## Session Overview

Extended session covering CI/CD pipeline fixes, UI/UX improvements, toast notification system, system tray icon, dependency updates, and a built-in updater tool.

---

## Interval 1 — Initial Assessment (06:27 UTC)

- Cloned repo, identified CI failure on release workflow
- Repo: Electron desktop app, Vite + React + TypeScript + Tailwind
- Version at session start: v1.4.19

## Interval 2 — CI Fix #1: Artifact Name Mismatch (06:28 UTC)

**Error:** `Artifact not found: callerflash-signed-1.4.19-windows`
**Fix:** Removed `-windows` suffix from signed artifact download in `release.yml`
**Commits:** `c5e52ed` (main), cherry-picked to stable/beta/nightly

## Interval 3 — CI Fix #2: Linux .deb Glob Pattern (06:50 UTC)

**Error:** `Pattern 'release-linux/*.deb' does not match any files`
**Fix:** Merged Linux .deb into `release/` via `merge-multiple: true`
**Commits:** `861f2c8`, cherry-picked to all branches

## Interval 4 — CI Fix #3: Electron Builder Config (06:56 UTC)

**Error:** `ENOENT: appimage-12.0.1` cache extraction failure (snap + AppImage built despite deb-only config)
**Fix:** Added `linux.target: [deb]` to `package.json` build field (electron-builder reads from package.json, not electron-builder.yml)
**Commits:** `2503706`, cherry-picked to all branches

## Interval 5 — Toast Notification System (07:14 UTC)

**Problem:** Toast notifications silent — `simulateIncomingCall` only sent via IPC in Electron, never populated the in-app store.
**Fix:** Multiple iterations:
1. Always call `addToast(record)` + IPC bridge
2. Then: toast ONLY in separate window (never in-app)
3. Final: `showSeparateToast()` function — Electron uses IPC to dedicated BrowserWindow, web uses `window.open()` popup
**Commits:** `b646702`, `4168150`

## Interval 6 — Update Settings Redesign (07:14 UTC)

- Added `autoDownload` toggle (separate from notification)
- Channel selector moved to top of settings
- Manual Download/Install buttons inline in settings panel
- Persisted in localStorage
**Commits:** `b646702`

## Interval 7 — System Tray Icon (07:26-15:57 UTC)

**Problem:** No tray icon visible, app always hidden with no way to restore.
**Fixes:**
- Added `extraResources` to electron-builder config (both yml and package.json)
- `loadTrayIcon()` checks `process.resourcesPath` first (packaged), falls back to `../build/` (dev)
- Main window `icon: loadTrayIcon()` for taskbar visibility
- Padded Untitled.png to 512x512 square, regenerated tray icons
- User provided `cflogo.ico` — renamed from `cglogo.ico`, updated all references
**Commits:** `04e016f`, `89812df`, `d8daba0`

## Interval 8 — Version Comparison & Update Banner (07:59 UTC)

- Added `compareVersions()` for correct semver comparison
- Always picks HIGHEST version on selected channel
- Prominent amber/gold gradient banner when update available
- "Already on latest" message when current >= latest
**Commits:** `28bbc21`

## Interval 9 — Update Banner Color (15:52 UTC)

- Changed from blue to amber/gold (`from-amber-500/15 to-yellow-500/10`)
**Commits:** `21d9577`

## Interval 10 — Dependency Updates (16:06 UTC)

All packages updated to latest:
- vite 7.3.2 → 8.1.0, typescript 5.9.3 → 6.0.3, electron 41.7.1 → 42.5.0
- react 19.2.6 → 19.2.7, tailwindcss 4.1.17 → 4.3.1, etc.
- 0 vulnerabilities (was 2)
- GitHub Actions: upload-artifact/download-artifact v5 → v6 (Node.js 20 deprecation)
- TypeScript 6: added `ignoreDeprecations: "6.0"`, `src/vite-env.d.ts`
**Commits:** `a69d837`

## Interval 11 — Built-in Updater Tool (current)

**Problem:** Update system only linked to GitHub releases page — no actual download/install.
**Fix:** Replaced simulated download with real fetch-based downloader:
- `runDownload()` uses `fetch` + `ReadableStream` for real progress tracking
- Downloads the .exe binary from GitHub CDN with live progress bar
- Stores blob URL for install step
- `handleInstall()` triggers actual file save (web) or Electron IPC `updater:install`
- Auto-download: when ON, downloads immediately after verification
- Manual download: when OFF, shows Download button → user clicks → downloads → shows Install
- Removed GitHub link button from update banner
**Commits:** (this commit)

---

## Current State (all branches)

| Item | Status |
|------|--------|
| CI pipeline | ✅ All 3 fixes applied, builds passing |
| Dependencies | ✅ All latest, 0 vulnerabilities |
| GitHub Actions | ✅ upload/download-artifact v6, no Node 20 warnings |
| Toast notifications | ✅ Separate window (Electron IPC / web popup) |
| System tray icon | ✅ cflogo.ico via extraResources |
| Taskbar icon | ✅ Main window icon set |
| Update system | ✅ Real download with progress, built-in install |
| Update banner | ✅ Amber/gold, prominent |
| Version comparison | ✅ Correct semver, picks highest |

---

## Key Files

| File | Purpose |
|------|---------|
| `.github/workflows/release.yml` | CI/CD release engine (400+ lines) |
| `electron/main.cjs` | Main process — window, tray, toast, IPC |
| `electron/preload.cjs` | IPC bridge (contextBridge) |
| `src/components/AutoUpdate.tsx` | Update UI + download engine |
| `src/components/ToastWindow.tsx` | Separate toast window renderer |
| `src/components/ToastSettings.tsx` | Toast configuration UI |
| `src/utils/simulateIncomingCall.ts` | Call simulation + toast display |
| `src/store/useAppStore.ts` | Zustand store (all app state) |
| `src/security/updateVerifier.ts` | Ed25519 verification pipeline |
| `package.json` | Dependencies + electron-builder config |
| `electron-builder.yml` | Electron builder config (mirror) |
| `build/cflogo.ico` | System tray icon (7 resolutions) |

---

## Architecture Notes

- **Release workflows** trigger on pushes to `stable`/`beta`/`nightly` branches, NOT `main`
- **electron-builder** reads config from `package.json` `build` field, not `electron-builder.yml`
- **Toast system**: Electron = IPC to dedicated BrowserWindow; Web = `window.open()` popup
- **Update flow**: GitHub API → filter by channel → sort by version → verify (Ed25519) → download (fetch + streaming) → install (Electron IPC or file save)
- **extraResources** copies tray icon files into `process.resourcesPath` for packaged builds
