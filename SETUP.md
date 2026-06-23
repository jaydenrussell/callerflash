# How to set up this project on GitHub (Web Only)

Since you can only use GitHub's web interface, follow these exact steps.

---

## Step 1: Create the repository

1. Go to [github.com/new](https://github.com/new)
2. **Repository name:** `callerflash` (already created)
3. **Description:** `SIP-compliant client with toast notifications`
4. **Public**
5. Do NOT check anything — leave README, .gitignore, license all UNCHECKED
6. Click **Create repository**

## Step 2: Upload the source code

On your new empty repository page:

1. Click the link that says **"uploading an existing file"** (below the code block)
2. **Drag and drop ALL of these files** from the extracted ZIP folder into the upload area:

```
README.md
SETUP.md
LICENSE
SECURITY.md
gitignore.txt
.github-workflow.yml
index.html
package.json
tsconfig.json
vite.config.ts
electron-builder.yml
electron/main.js
build/icon.ico
src/main.tsx
src/App.tsx
src/index.css
src/utils/cn.ts
src/utils/simulateIncomingCall.ts
src/store/useAppStore.ts
src/security/updateVerifier.ts
src/security/secretRedactor.ts
src/components/Sidebar.tsx
src/components/Dashboard.tsx
src/components/CallHistory.tsx
src/components/SipSettings.tsx
src/components/ToastSettings.tsx
src/components/ToastNotification.tsx
src/components/Diagnostics.tsx
src/components/AutoUpdate.tsx
src/components/About.tsx
```

3. Add commit message: `Initial commit`
4. Select **"Commit directly to the main branch"**
5. Click **Commit changes**

## Step 3: Create the `.github/workflows/release.yml` file

The workflow file must live in a `.github/workflows/` folder. Since you can't upload dotfiles via the web uploader, you create it manually:

1. Click the **Add file** dropdown button (top-right of your repo)
2. Select **"Create new file"**
3. In the **"Name your file…"** field, type exactly:
   ```
   .github/workflows/release.yml
   ```
   (GitHub automatically creates the folders)
4. Open the `.github-workflow.yml` file you uploaded earlier, **copy its entire content**
5. Paste it into the GitHub editor
6. Click **Commit new file**

## Step 4: Create `.gitignore`

1. Click **Add file → Create new file**
2. Name it: `.gitignore`
3. Open `gitignore.txt` from your upload, **copy its content**
4. Paste it, click **Commit new file**
5. **Delete the old `gitignore.txt`** — click on it in the file list, click the trash icon, commit

## Step 5: Create the release branches

1. Click the **branch selector** dropdown (top-left, says **"main"**)
2. Type: `nightly` and click **"Create branch: nightly from main"**
3. Repeat: type `beta` → **Create branch**
4. Repeat: type `stable` → **Create branch**
5. Switch back to **main**

## Step 6: Trigger your first build

1. Go to the **Actions** tab
2. Click **"Build and Release"** on the left sidebar
3. Click **"Run workflow" → Branch: nightly → Run workflow**
4. Wait ~3 minutes, then check your **Releases** tab

---

## How releases work

| Branch | Channel | Version | Published as |
|--------|---------|---------|-------------|
| `nightly` | Nightly | `1.4.2-nightly.1` | Pre-release |
| `beta` | Beta | `1.4.2-beta.1` | Pre-release |
| `stable` | Stable | `1.4.2` | Full release |
| Tag `v1.5.0` | Stable | `1.5.0` | Full release |
| Tag `v1.5.0-beta.1` | Beta | `1.5.0-beta.1` | Pre-release |

The workflow always uses **Node.js latest** (not pinned to any specific version).
