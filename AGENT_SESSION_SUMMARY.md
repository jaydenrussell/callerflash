# CallerFlash — Agent Session Summary
> Generated: 2026-06-25 (America/Toronto)
> Repo: https://github.com/jaydenrussell/callerflash
> Branch: `main`

---

## Session Overview

Extended session covering CI/CD pipeline, UI/UX, toast notifications, system tray, updater tool, dependency updates, and versioning overhaul.

---

## Interval 1 — Initial CI Fix: Artifact Name Mismatch (06:28 UTC)

**Error:** `Artifact not found: callerflash-signed-1.4.19-windows`
**Fix:** Removed `-windows` suffix from signed artifact download in `release.yml`
**Commits:** `c5e52ed` + cherry-picked to stable/beta/nightly

## Interval 2 — CI Fix: Linux .deb Glob Pattern (06:50 UTC)

**Error:** `Pattern 'release-linux/*.deb' does not match any files`
**Fix:** Merged Linux .deb into `release/` via `merge-multiple: true`
**Commits:** `861f2c8` + cherry-picked

## Interval 3 — CI Fix: Electron Builder Config (06:56 UTC)

**Error:** `ENOENT: appimage-12.0.1` — AppImage/snap built despite deb-only config
**Fix:** Added `linux.target: [deb]` to `package.json` build field (electron-builder reads from package.json, not electron-builder.yml)
**Commits:** `2503706` + cherry-picked

## Interval 4 — Toast Notification System (07:14-19:02 UTC)

**Problem:** Toast notifications silent in Electron, only showed in-app.
**Fix iterations:**
1. Always `addToast(record)` + IPC bridge
2. Toast ONLY in separate window (never in-app)
3. `showSeparateToast()` — Electron uses IPC to dedicated BrowserWindow, web uses `window.open()` popup
4. BGRA color format fix for nativeImage, 20% opaque status background
5. Traffic light dot on tray icon instead of full background tint
**Key file:** `src/utils/simulateIncomingCall.ts`

## Interval 5 — Update Settings Redesign (07:14-16:56 UTC)

- Added `autoDownload` toggle (separate from notification)
- Channel selector moved to top of settings
- Built-in updater with real `fetch` + `ReadableStream` download engine
- One-click Install button: downloads if needed, then runs installer
- Electron: main process downloads .exe, spawns installer, quits app, installer auto-restarts app (`runAfterFinish: true`)
- Web: blob URL file save
**Key files:** `src/components/AutoUpdate.tsx`, `electron/main.cjs`, `electron/preload.cjs`

## Interval 6 — System Tray Icon (07:26-20:35 UTC)

- Added `extraResources` to electron-builder config
- `loadTrayIcon()` checks `process.resourcesPath` first (packaged), falls back to `../build/` (dev)
- Main window `icon: loadTrayIcon()` for taskbar visibility
- User provided `cflogo.ico` — renamed from `cglogo.ico`
- SIP status dot: green/yellow/red circle in top-right corner of icon
- Update indicator in tray: tooltip + context menu item
**Key file:** `electron/main.cjs`

## Interval 7 — Title Bar & Sidebar UI (16:41 UTC)

- Replaced text SIP status with traffic-light dot (green/yellow/red)
- Added amber "Update" badge on title bar (clicks → Updates tab)
- Added amber dot badge on sidebar Updates item
**Key files:** `src/App.tsx`, `src/components/Sidebar.tsx`

## Interval 8 — Dependency Updates (16:06 UTC)

All packages updated to latest: vite 8.1.0, typescript 6.0.3, electron 42.5.0, react 19.2.7, tailwindcss 4.3.1, etc.
- 0 vulnerabilities (was 2)
- GitHub Actions: upload/download-artifact v5 → v6
- TypeScript 6: `ignoreDeprecations: "6.0"`, `src/vite-env.d.ts`

## Interval 9 — CI/CD Versioning Overhaul (19:10-20:54 UTC)

### Release naming:
| Channel | Tag | Release Name |
|---------|-----|-------------|
| Nightly | `nightly-20260625` (no `v`) | `CallerFlash — Nightly 20260625` |
| Beta | `v1.5.0-beta.28` | `CallerFlash v1.5.0-28.beta` |
| Stable | `v1.5.0` | `CallerFlash v1.5.0` |

### Asset filenames:
| Channel | Filename |
|---------|---------|
| Nightly | `CallerFlash-nightly-20260625.exe` |
| Beta | `CallerFlash-1.5.0-beta.28.exe` |
| Stable | `CallerFlash-1.5.0.exe` |

### Version handling:
- Nightly uses `0.0.0-nightly.20260624` internally (valid semver for electron-builder) with custom `artifactName` to strip `0.0.0-` prefix
- Beta uses `1.5.0-beta.28` (valid semver)
- Stable uses `1.5.0` (valid semver)
- `npm version` skipped for non-semver nightly versions

### CI workflow structure:
- `nightly.yml` — triggers on push to `nightly` branch + daily schedule + manual
- `beta.yml` — manual dispatch only
- `stable.yml` — manual dispatch only
- `sync-main-to-nightly.yml` — pushes main to nightly using `PAT_TOKEN` secret (required because GITHUB_TOKEN pushes don't trigger other workflows)
- **PAT_TOKEN secret must be added** in repo Settings → Secrets → Actions

### Version comparison:
- `compareVersions()` handles nightly date codes (always newer than semver)
- `matchesChannel()` matches `nightly-YYYYMMDD` tags
- `parseGithubRelease()` accepts both semver and nightly tag formats

## Interval 10 — Installer File Extension Fix (18:19-19:44 UTC)

**Problem:** Windows saw `.33` extension instead of `.exe` for multi-dot filenames like `CallerFlash.Setup.1.5.0-nightly.bfb419d.exe`
**Fix:** Always save installer as `CallerFlash-Update.exe` (clean fixed filename). Verify file exists and >1MB before launching.

---

## Current State

| Item | Status |
|------|--------|
| CI pipeline | ✅ All fixes applied, nightly/beta/stable build correctly |
| Dependencies | ✅ All latest, 0 vulnerabilities |
| GitHub Actions | ✅ v6 actions, no Node 20 warnings |
| Toast notifications | ✅ Separate window (Electron IPC / web popup) |
| System tray | ✅ cflogo.ico + SIP status dot + update indicator |
| Taskbar | ✅ Icon visible |
| Title bar | ✅ Traffic-light SIP + update badge |
| Sidebar | ✅ Update badge on Updates item |
| Updater | ✅ Real download + one-click install + auto-restart |
| Versioning | ✅ Date codes for nightly, clean naming for all |
| PAT_TOKEN | ⚠️ Needs to be added as repo secret for sync workflow |

---

## Key Files

| File | Purpose |
|------|---------|
| `.github/workflows/release.yml` | CI/CD release engine |
| `.github/workflows/nightly.yml` | Nightly trigger |
| `.github/workflows/beta.yml` | Beta trigger (manual) |
| `.github/workflows/stable.yml` | Stable trigger (manual) |
| `.github/workflows/sync-main-to-nightly.yml` | Main → nightly sync (uses PAT_TOKEN) |
| `electron/main.cjs` | Main process — window, tray, toast, updater IPC |
| `electron/preload.cjs` | IPC bridge (contextBridge) |
| `src/components/AutoUpdate.tsx` | Update UI + download engine |
| `src/components/ToastWindow.tsx` | Separate toast window renderer |
| `src/components/Sidebar.tsx` | Sidebar with update badge |
| `src/App.tsx` | Title bar with traffic-light + update badge |
| `src/utils/simulateIncomingCall.ts` | Call simulation + toast display |
| `src/store/useAppStore.ts` | Zustand store (all app state) |
| `src/security/updateVerifier.ts` | Ed25519 verification pipeline |
| `scripts/next-version.cjs` | Version computation per channel |
| `scripts/generate-release-notes.cjs` | Release notes from commits |
| `package.json` | Dependencies + electron-builder config |
| `electron-builder.yml` | Electron builder config (mirror) |
| `build/cflogo.ico` | System tray icon (7 resolutions) |

---

## Architecture Notes

- **Release workflows** trigger on channel branches, NOT main
- **electron-builder** reads config from `package.json` `build` field
- **Toast system**: Electron = IPC to dedicated BrowserWindow; Web = `window.open()` popup
- **Update flow**: GitHub API → filter by channel → sort by version → verify (Ed25519) → download (fetch + streaming) → install (Electron IPC: download + spawn .exe + quit + auto-restart)
- **extraResources** copies tray icon files into `process.resourcesPath`
- **PAT_TOKEN** required for sync workflow (GITHUB_TOKEN pushes don't trigger workflows)
- **Nightly version**: `0.0.0-nightly.20260624` in package.json, `CallerFlash-nightly-20260624.exe` filename
- **Tray icon**: base cflogo + solid colored dot in top-right corner (BGRA format)
