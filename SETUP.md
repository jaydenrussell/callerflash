# CallerFlash — GitHub Setup (Web Only)

## Branch Strategy

```
main (you edit here)
  ↓ auto-sync
nightly (auto-builds .exe pre-release)
  ↓ one-click promote
beta (pre-release for testing)
  ↓ one-click promote
stable (full release with .exe)
```

| Branch | What it does | How code gets there |
|--------|-------------|-------------------|
| **main** | Development — all edits go here | You push changes |
| **nightly** | Auto-built every time main changes | Auto-synced from main |
| **beta** | Pre-release for testing | Click "Promote → Beta" workflow |
| **stable** | Production release with `.exe` installer | Click "Promote → Stable" workflow |

## How to set up (first time)

### 1. Create workflow files on each branch

Each branch needs its own copy of the workflow files inside `.github/workflows/`.

**On the `main` branch:**

Create **three** files by clicking **Add file → Create new file**:

**File 1:** `.github/workflows/release.yml`
- Copy content from `.github-workflow.yml`

**File 2:** `.github/workflows/promote-beta.yml`
- Copy content from `.github-promote-beta.yml`

**File 3:** `.github/workflows/promote-stable.yml`
- Copy content from `.github-promote-stable.yml`

**Then sync to other branches:**

Once all three files are on `main`, the auto-sync will copy them to `nightly` on the next push.

For `beta` and `stable`, you can run the promote workflows to pull everything in, OR manually create the same three files on those branches.

### 2. Create the .gitignore

1. Click **Add file → Create new file**
2. Name it: `.gitignore`
3. Copy content from `gitignore.txt`
4. Commit, then delete `gitignore.txt`

### 3. Create branches (if not already done)

1. Click branch dropdown → type `nightly` → Create branch
2. Repeat for `beta` and `stable`
3. Switch back to `main`

## Daily workflow

### Making changes
1. Go to the `main` branch
2. Edit files, commit
3. CI runs automatically
4. Code auto-syncs to `nightly` → nightly `.exe` is built

### Promoting to beta
1. Go to **Actions** tab
2. Click **"Promote → Beta"** on the left
3. Click **"Run workflow"**
4. A beta `.exe` pre-release is created automatically

### Releasing to stable
1. Go to **Actions** tab
2. Click **"Promote → Stable"** on the left
3. Click **"Run workflow"**
4. A stable `.exe` full release is created automatically

### Summary of what's automated

| You do | What happens |
|--------|-------------|
| Push to `main` | CI check → auto-sync to nightly → nightly `.exe` built |
| Click "Promote → Beta" | nightly → beta → beta `.exe` built |
| Click "Promote → Stable" | beta → stable → stable `.exe` built |
| Nothing else needed | Tags, releases, uploads all automatic |
