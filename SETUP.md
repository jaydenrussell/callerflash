# How to set up this project on GitHub (Web Only)

Since you can only use GitHub's web interface, follow these exact steps.

---

## Step 1: Create the repository

1. Go to [github.com/new](https://github.com/new)
2. **Repository name:** `callerflash-sip-client`
3. **Description:** `SIP-compliant client with toast notifications for any standard SIP provider`
4. **Public**
5. Do NOT check anything — leave README, .gitignore, license all UNCHECKED
6. Click **Create repository**

## Step 2: Upload the source code

On your new empty repository page:

1. Scroll down to the section that says **"…or push an existing repository from the command line"**
2. Click the link that says **"uploading an existing file"** (under the code block)
3. **Drag and drop** ALL of these files from the extracted ZIP folder into the upload area:

> **Critical: Upload ALL of these files (not the folders — just the files):**

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

4. Add a commit message: `Initial commit`
5. Select **"Commit directly to the main branch"**
6. Click **Commit changes**

## Step 3: Create the hidden `.github` folder (Critical)

The workflow file won't work unless it's inside a folder called `.github/workflows/`. Here's how to create it:

1. On your repository page, click the **Add file** dropdown button (top-right)
2. Select **"Create new file"**
3. In the **"Name your file…"** field, type exactly:
   ```
   .github/workflows/release.yml
   ```
   *(GitHub will auto-create the .github and workflows folders)*
4. Go back to this project, open the file called **`.github-workflow.yml`** in the file list above
5. Right-click it, click **"Open link in new tab"** or **"View raw"**
6. **Copy the ENTIRE content** of that file
7. Go back to GitHub, **paste** all of it into the editor
8. Add a commit message: `Add CI/CD workflow`
9. Click **Commit new file**

## Step 4: Rename gitignore to .gitignore

1. Click the **Add file** dropdown → **Create new file**
2. Name it exactly: `.gitignore`
3. Open the `gitignore.txt` file you uploaded earlier, copy its content
4. Paste it into the new file
5. Commit with message: `Add gitignore`
6. Now **delete** the old `gitignore.txt`:
   - Go to your file list
   - Click on `gitignore.txt`
   - Click the **trash icon** (Delete this file)
   - Commit

## Step 5: Create the release branches

1. Click the **branch selector** dropdown at the top-left (it currently says **"main"**)
2. Type: `nightly` and click **"Create branch: nightly from main"**
3. Click the branch dropdown again, type: `beta`, click **"Create branch: beta from main"**
4. Click the branch dropdown again, type: `stable`, click **"Create branch: stable from main"**
5. Click the branch dropdown and switch back to **main**

## Step 6: Trigger your first build

1. Go to the **Actions** tab at the top of your repository
2. On the left sidebar, click **"Build and Release"**
3. Click the **"Run workflow"** dropdown button (right side)
4. In the **Branch** dropdown, select `nightly`
5. Click **"Run workflow"**

The build will start. After about 2-3 minutes, go to your **Releases** tab to find the first `.exe` installer.

---

## How to release updates

Once everything is set up:

| To release | Do this on GitHub |
|------------|------------------|
| **Nightly** | Push code to `nightly` branch (auto-builds) |
| **Beta** | Push code to `beta` branch (auto-builds) |
| **Stable** | Push code to `stable` branch, OR create a tag like `v1.4.2` |

To push updates to a branch via web:

1. Go to the branch (e.g., `nightly`)
2. Click **Add file → Upload files**
3. Upload the updated files
4. Commit
