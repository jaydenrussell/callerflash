# CallerFlash — Agent Session Summary
> Generated: 2026-06-26 (America/Toronto)
> Repo: https://github.com/jaydenrussell/callerflash
> Branch: `main`

---

## Session Overview

Extended session covering CI/CD pipeline fixes, UI/UX compaction, SIP backend networking integration, persistent UI window states, and background seamless installations.

---

## Interval 1 — Initial CI & Asset Fixes
- **Artifact Mismatch & Glob Patterns:** Fixed `-windows` suffix mismatches and merged `.deb` assets in GitHub actions.
- **Electron Builder Config:** Updated `package.json` to properly build specific `.deb` outputs and target the proper `buildResources` folder to avoid GitHub's aggressive CI `build/` exclusion rules.

## Interval 2 — UI/UX Compaction
- **Dashboard:** Simplified the view, moving Connect/Disconnect entirely into SIP settings. Replaced generic icons with genuine CallerFlash logos in the sidebar.
- **SIP Settings:** Stripped unnecessary Audio/Codec sections. Moved STUN into the server section. Added active "Registering..." / "Registered" visual spinner badges to show real-time networking state.
- **Toast Notifications:** Redesigned into a tightly packed grid to fit inside an 800x600 window constraints.

## Interval 3 — Real SIP Networking Backend
- **Replaced Mock UI with Real Engine:** Installed Node `sip` package into production dependencies. 
- **Electron Background IPC:** Wired `electron/sipClient.cjs` to actually bind UDP/TCP sockets to port `5060`. 
- **Digest Auth:** The backend now accurately reads the HTTP `401 Unauthorized` `www-authenticate` headers and correctly strips quotes to parse the `realm` for proper MD5 authentication hashes against providers like VoIP.ms.
- **Keep-Alives:** The backend automatically pings `REGISTER` refreshes dynamically before expiry.
- **Inbound Tracking:** Rejects real-world inbound `INVITE`s with a `486 Busy Here`, captures the payload, and fires it over the IPC bridge to render the actual Toast Window + trigger the clipboard copy. Includes `User-Agent: CallerFlash` headers.
- **Log Piping:** Raw `sip` library inbound/outbound packets are streamed directly to the Diagnostics console in the UI.

## Interval 4 — Persistent Storage & Security
- **Credential Storage:** `useAppStore.ts` now securely intercepts the SIP password, pushes it through Electron's `safeStorage` DPAPI, encrypts it, and writes it to localStorage. It auto-decrypts seamlessly on application launch.
- **Auto-Connect:** If valid SIP settings are present on boot, the app skips the UI and auto-connects to the telecom network instantly in the background.
- **Window State Retention:** Resizing or moving the main app window saves the exact `x`, `y`, `width`, and `height` coordinates to `main-window-state.json`. Restoring from the system tray snaps it perfectly back to the exact monitor location.

## Interval 5 — Seamless Installers & Auto-Updater Engine
- **Versioning Utilities:** Added `formatVersion()` utility to scrub all UI elements of `v` and `0.0.0-` internal strings.
- **Same-Day Nightly Support:** The auto-incrementer now dynamically counts tags and generates `-1`, `-2` suffixes. The update engine cross-references `__APP_BUILD_TIMESTAMP__` against the GitHub API's `published_at` timestamp to flawlessly update even when the version names match exactly on same-day pushes.
- **Silent Background Installation:** Downloads the file from GitHub CDN. Uses NSIS `/S` and `/D=` arguments to quietly overwrite the active install directory without triggering wizard popups.
- **HTML Application (HTA) Progress UI:** While the Electron app closes to release file locks, a custom borderless HTA window is spawned natively through Windows. It mimics the app's `#202020` theme, embeds the CallerFlash logo, and displays an animated progress bar.
- **First-Run UX:** Skips the "Start Minimized" preference explicitly on the *first run after an update* or install, forcefully showing the UI so the user clearly sees the update was successful.
- **Bulletproof `artifactUrl`:** The installer safely re-scans the GitHub CDN asset endpoints if the UI memory drops the active URL pointer before the "Install" button is clicked.

---

## Current State

| Item | Status |
|------|--------|
| CI pipeline | ✅ All fixes applied, nightly/beta/stable build correctly |
| Dependencies | ✅ SIP networking package successfully bundled into asar |
| GitHub Actions | ✅ `build` renamed to `buildResources` to bypass exclusion |
| Toast notifications | ✅ Triggers off real network UDP/TCP payloads with Native OS fallback |
| Window State | ✅ `x/y/w/h` persists across reboots perfectly |
| Updater Engine | ✅ Seamless `/S` installations with custom HTA visual progress |
| Versioning | ✅ `-N` auto-incrementing suffixes built, UI format stripping enabled |
| SIP Backend | ✅ Digest auth, realms, auto-reconnect, and diagnostics logs wired |
| First-Boot UX | ✅ Starts visibly after updates; auto-connects to SIP server |

---

## Architecture Notes

- **Release workflows** trigger on channel branches, NOT main
- **Toast system**: Electron = IPC to dedicated BrowserWindow; Web = `window.open()` popup
- **Update flow**: GitHub API → filter by channel → sort by version → verify (Ed25519) → download (fetch + streaming) → install (Electron IPC: MSHTA progress spawn + .exe `/S` + quit + auto-restart)
- **PAT_TOKEN** required for sync workflow (GITHUB_TOKEN pushes don't trigger workflows)
- **Nightly version**: `0.0.0-nightly-20260624-2` in package.json, `CallerFlash-nightly-20260624-2.exe` filename
