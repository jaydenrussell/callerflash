import { useState, useEffect, useMemo } from 'react';
import {
  Download, RefreshCw,
  Shield, GitBranch,
  ExternalLink, GitCommit, ChevronDown,
  Check, X as XIcon, ShieldCheck, FileLock, Key, AlertCircle
} from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import {
  verifyUpdateArtifact,
  parseGithubRelease,
  type VerificationResult,
} from '../security/updateVerifier';

interface GithubRelease {
  tag_name: string;
  name: string;
  published_at: string;
  prerelease: boolean;
  body: string;
  html_url: string;
  assets: Array<{ name: string; browser_download_url: string }>;
}

function GithubIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
    </svg>
  );
}

/**
 * Pull the bullet-point changelog out of a GitHub release body. GitHub
 * uses simple markdown — lines starting with `-` or `*` are bullets.
 * We keep the first N non-empty bullets and skip any duplicate header
 * lines so each entry in the UI shows real per-version changes.
 */
function parseChangelog(body: string, max = 6): string[] {
  if (!body) return [];
  const out: string[] = [];
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const bullet = line.match(/^[-*]\s+(.*)/);
    if (!bullet) continue;
    const text = bullet[1].replace(/^\*\*(.+?)\*\*:?/, '$1').replace(/`([^`]+)`/g, '$1').trim();
    if (!text) continue;
    if (out.includes(text)) continue;
    out.push(text);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Compare two semver strings. Returns 1 if a > b, -1 if a < b, 0 if equal.
 * Handles prerelease suffixes like "1.5.0-beta.3" or "1.4.2-nightly.abc1234".
 * A version with a prerelease suffix is considered HIGHER than the same base
 * version without one (e.g. 1.5.0-nightly.xxx > 1.5.0).
 */
function compareVersions(a: string, b: string): number {
  const parseA = a.replace(/^v/, '').split(/-(.+)/);
  const parseB = b.replace(/^v/, '').split(/-(.+)/);
  const baseA = parseA[0].split('.').map(Number);
  const baseB = parseB[0].split('.').map(Number);
  // Compare base versions first (X.Y.Z).
  for (let i = 0; i < Math.max(baseA.length, baseB.length); i++) {
    const na = baseA[i] ?? 0;
    const nb = baseB[i] ?? 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  // Same base — a prerelease suffix makes it higher (1.5.0-beta > 1.5.0).
  const preA = parseA[1] || '';
  const preB = parseB[1] || '';
  if (preA && !preB) return 1;  // a has prerelease, b doesn't → a is newer
  if (!preA && preB) return -1; // b has prerelease, a doesn't → b is newer
  if (preA === preB) return 0;
  return preA > preB ? 1 : -1; // lexicographic comparison of prerelease
}

function formatReleaseDate(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Returns true if a GitHub release matches the given channel.
 * Tags follow the convention `<version>[-<channel>.<sha|seq>]` set by
 * the release workflow (e.g. v1.5.0 / v1.5.0-beta.3 / v1.5.0-nightly.abc1234).
 */
function matchesChannel(
  release: GithubRelease,
  channel: 'stable' | 'beta' | 'nightly'
): boolean {
  if (channel === 'stable') return !release.prerelease;
  const tag = release.tag_name;
  if (channel === 'beta') return /-beta(\.|$)/.test(tag);
  if (channel === 'nightly') return /-nightly(\.|$)/.test(tag);
  return false;
}

type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'downloading'
  | 'installing';
type CheckOutcome =
  | { kind: 'no-update'; message: string }
  | { kind: 'missing-assets'; message: string; release: GithubRelease }
  | { kind: 'verification-failed'; message: string; release: GithubRelease }
  | null;

type UpdateFrequency = 'off' | 'daily' | 'weekly' | 'monthly';

const FREQUENCY_INTERVAL_DAYS: Record<UpdateFrequency, number | null> = {
  off: null,
  daily: 1,
  weekly: 7,
  monthly: 30,
};

function shouldAutoCheck(
  lastChecked: Date | null,
  frequency: UpdateFrequency
): boolean {
  const interval = FREQUENCY_INTERVAL_DAYS[frequency];
  if (interval === null) return false; // off
  if (!lastChecked) return true;       // first run
  const ageDays = (Date.now() - lastChecked.getTime()) / 86_400_000;
  return ageDays >= interval;
}

function formatRelativeLastCheck(lastChecked: Date | null): string {
  if (!lastChecked) return 'Never';
  const diffMs = Date.now() - lastChecked.getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
  return lastChecked.toLocaleDateString();
}

export function AutoUpdate() {
  const { updateInfo, setUpdateInfo, addDiagnosticLog } = useAppStore();
  const [verification, setVerification] = useState<VerificationResult | null>(null);
  const [showReleaseNotes, setShowReleaseNotes] = useState(false);
  // Full unfiltered release list, fetched from GitHub.
  const [releases, setReleases] = useState<GithubRelease[]>([]);
  const [phase, setPhase] = useState<UpdatePhase>('idle');
  // Captures the failure reason so the user sees WHY nothing happened,
  // not just a silent diagnostic log. Cleared on every new check.
  const [outcome, setOutcome] = useState<CheckOutcome>(null);
  // Persist the verified artifact's download URL + the downloaded blob
  // URL so the install step can trigger a real file download.
  const [artifactUrl, setArtifactUrl] = useState<string | null>(null);
  const [downloadedBlobUrl, setDownloadedBlobUrl] = useState<string | null>(null);
  const [downloadedFileName, setDownloadedFileName] = useState<string>('');

  // The displayed list — strictly filtered by the active channel,
  // sorted by version descending (highest first).
  const channelReleases = useMemo(
    () => releases
      .filter((r) => matchesChannel(r, updateInfo.updateChannel))
      .sort((a, b) => compareVersions(
        b.tag_name.replace(/^v/, ''),
        a.tag_name.replace(/^v/, ''),
      )),
    [releases, updateInfo.updateChannel],
  );

  // Refetch on mount and whenever the channel toggles — each channel
  // has its own release set.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const repoPath = updateInfo.githubRepo.replace(/^https?:\/\/github\.com\//, '');
        const apiUrl = `https://api.github.com/repos/${repoPath}/releases?per_page=20`;
        const response = await fetch(apiUrl, {
          headers: { Accept: 'application/vnd.github+json' },
        });
        if (!response.ok) return;
        const list: GithubRelease[] = await response.json();
        if (!cancelled) setReleases(list);
      } catch {
        // Network failure — leave releases empty.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [updateInfo.githubRepo, updateInfo.updateChannel]);

  // Notify the Electron tray when update availability changes.
  useEffect(() => {
    if (window.callerflash?.tray?.setUpdateAvailable) {
      window.callerflash.tray.setUpdateAvailable(
        updateInfo.updateAvailable ? updateInfo.latestVersion : null
      );
    }
  }, [updateInfo.updateAvailable, updateInfo.latestVersion]);

  // Auto-check on tab mount — ALWAYS run on first load regardless of
  // last-checked time, so the user sees updates immediately when they
  // open the app. After the first check, subsequent checks respect
  // the frequency interval (daily/weekly/monthly).
  const hasCheckedRef = useState({ current: false })[0];
  useEffect(() => {
    if (phase !== 'idle') return;
    if (hasCheckedRef.current) {
      // Subsequent channel/frequency changes: respect the interval.
      if (!shouldAutoCheck(updateInfo.lastChecked, updateInfo.updateCheckFrequency)) return;
    }
    hasCheckedRef.current = true;
    handleCheckAndDownload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [updateInfo.updateCheckFrequency, updateInfo.updateChannel]);

  /**
   * One-click flow: fetch metadata, run the verification pipeline, and
   * if approved, automatically download the binary. The user does NOT
   * need a separate "Download" step — when ready, they get an "Install"
   * button. Matches Discord/Slack-style UX: never silently install.
   */
  const handleCheckAndDownload = async () => {
    setPhase('checking');
    setVerification(null);
    setOutcome(null);
    addDiagnosticLog({
      level: 'info',
      category: 'UPDATE',
      message: 'Checking GitHub releases for updates…',
      details: `Repository: ${updateInfo.githubRepo}\nChannel: ${updateInfo.updateChannel}`,
    });

    try {
      // 1. Fetch latest matching release from GitHub.
      const repoPath = updateInfo.githubRepo.replace(/^https?:\/\/github\.com\//, '');
      const apiUrl = `https://api.github.com/repos/${repoPath}/releases?per_page=20`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10_000);

      let fetched: GithubRelease[];
      try {
        const response = await fetch(apiUrl, {
          headers: { Accept: 'application/vnd.github+json' },
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`GitHub API responded ${response.status}`);
        fetched = await response.json();
      } finally {
        clearTimeout(timeoutId);
      }

      setReleases(fetched);

      // 2. Pick the HIGHEST version on the active channel.
      const channel = updateInfo.updateChannel;
      const channelFiltered = fetched
        .filter((r) => matchesChannel(r, channel))
        .sort((a, b) => compareVersions(
          b.tag_name.replace(/^v/, ''),
          a.tag_name.replace(/^v/, ''),
        ));
      const candidate = channelFiltered[0] ?? null;

      if (!candidate) {
        const msg = `No releases on the ${channel} channel yet.`;
        addDiagnosticLog({ level: 'info', category: 'UPDATE', message: msg });
        setUpdateInfo({
          updateAvailable: false,
          lastChecked: new Date(),
          latestVersion: updateInfo.currentVersion,
        });
        setPhase('idle');
        setOutcome({ kind: 'no-update', message: msg });
        return;
      }

      const candidateVersion = candidate.tag_name.replace(/^v/, '');
      const isHigher = compareVersions(candidateVersion, updateInfo.currentVersion) > 0;

      // Track the release page for the "Open on GitHub" fallback button.
      setUpdateInfo({ releasePageUrl: candidate.html_url });

      // If the highest release on this channel is NOT higher than
      // current, the user is already up to date.
      if (!isHigher) {
        addDiagnosticLog({
          level: 'success',
          category: 'UPDATE',
          message: `Already on the latest ${channel} version (v${updateInfo.currentVersion}).`,
        });
        setUpdateInfo({
          updateAvailable: false,
          lastChecked: new Date(),
          latestVersion: updateInfo.currentVersion,
        });
        setPhase('idle');
        setOutcome({
          kind: 'no-update',
          message: `You're running v${updateInfo.currentVersion}, which is the latest on the ${channel} channel.`,
        });
        return;
      }

      const artifact = await parseGithubRelease(candidate);
      if (!artifact) {
        // Release exists on GitHub but doesn't carry the in-app-update
        // assets (signed .exe, SHA256SUMS, .sig). This is the expected
        // case for releases uploaded manually — fall back gracefully:
        // surface the version so the user knows they're behind, and
        // provide a one-click "Open on GitHub" to download manually.
        const tagVer = candidate.tag_name.replace(/^v/, '');
        addDiagnosticLog({
          level: 'info',
          category: 'UPDATE',
          message: `v${tagVer} on ${updateInfo.updateChannel} channel — manual download only (no signed assets in this release)`,
        });
        setUpdateInfo({
          updateAvailable: true,
          latestVersion: tagVer,
          lastChecked: new Date(),
          releasePageUrl: candidate.html_url,
        });
        setPhase('idle');
        setOutcome({
          kind: 'missing-assets',
          message: `v${tagVer} is available on the ${updateInfo.updateChannel} channel. Open it on GitHub to download — this release isn't published by the automated workflow so it doesn't carry signed in-app-update assets.`,
          release: candidate,
        });
        return;
      }

      // 3. Run the full verification pipeline.
      addDiagnosticLog({
        level: 'info',
        category: 'UPDATE',
        message: `Verifying release v${artifact.version} against pinned public key…`,
      });
      const result = await verifyUpdateArtifact(artifact, channel, updateInfo.currentVersion);
      setVerification(result);
      for (const step of result.steps) {
        addDiagnosticLog({
          level: step.passed ? 'success' : 'error',
          category: 'UPDATE',
          message: `Verification: ${step.name} — ${step.passed ? 'PASS' : 'FAIL'}`,
          details: step.detail,
        });
      }

      if (!result.approved) {
        const msg = `Update v${artifact.version} REJECTED by verification — refusing to install. See the verification panel below for the failing step.`;
        addDiagnosticLog({ level: 'error', category: 'UPDATE', message: msg });
        setUpdateInfo({
          updateAvailable: false,
          lastChecked: new Date(),
          latestVersion: updateInfo.currentVersion,
        });
        setPhase('idle');
        setOutcome({ kind: 'verification-failed', message: msg, release: candidate });
        return;
      }

      addDiagnosticLog({
        level: 'success',
        category: 'UPDATE',
        message: `Update v${artifact.version} verified — ${updateInfo.autoDownload ? 'auto-downloading' : 'waiting for user to click Download'}`,
      });

      // Update store state so the UI reflects the verified version.
      setUpdateInfo({
        latestVersion: artifact.version,
        updateAvailable: true,
        lastChecked: new Date(),
        releaseNotes: artifact.notes || 'See GitHub for release notes.',
      });

      // If auto-download is enabled, download immediately so the
      // update is ready to install. Either way, the Install button
      // is always visible in the update banner.
      if (updateInfo.autoDownload) {
        await runDownload({ version: artifact.version, downloadUrl: artifact.downloadUrl });
      } else {
        setPhase('idle');
      }

      // Notify via system tray / OS notification (Electron-only; no-op in web demo).
      try {
        await window.callerflash?.notify?.show?.(
          `v${artifact.version} available`,
          'Click the Updates tab to download and install.'
        );
      } catch {
        // Ignore — web demo has no notification backend.
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown';
      addDiagnosticLog({ level: 'error', category: 'UPDATE', message: `Update check failed: ${message}` });
      setPhase('idle');
    }
  };

  /**
   * Real download with streaming progress. Fetches the verified binary
   * from GitHub's CDN, tracks progress via ReadableStream, and stores
   * the blob so the install step can trigger a file save.
   */
  const runDownload = async (artifact: { version: string; downloadUrl: string }) => {
    setPhase('downloading');
    setUpdateInfo({ isDownloading: true, downloadProgress: 0 });
    setArtifactUrl(artifact.downloadUrl);

    // Clean up any previous blob URL.
    if (downloadedBlobUrl) {
      try { URL.revokeObjectURL(downloadedBlobUrl); } catch { /* noop */ }
      setDownloadedBlobUrl(null);
    }

    setDownloadedFileName('CallerFlash-Update.exe');

    try {
      const response = await fetch(artifact.downloadUrl);
      if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`);

      const contentLength = Number(response.headers.get('content-length') || '0');
      const reader = response.body?.getReader();
      if (!reader) throw new Error('ReadableStream not supported');

      const chunks: Uint8Array[] = [];
      let received = 0;

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        if (contentLength > 0) {
          setUpdateInfo({ downloadProgress: (received / contentLength) * 100 });
        }
      }

      const blob = new Blob(chunks as BlobPart[]);
      const url = URL.createObjectURL(blob);
      setDownloadedBlobUrl(url);
      setUpdateInfo({ isDownloading: false, downloadProgress: 100 });
      setPhase('idle');
      addDiagnosticLog({
        level: 'success',
        category: 'UPDATE',
        message: `Update v${artifact.version} downloaded (${(received / 1048576).toFixed(1)} MB) — ready to install`,
      });
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Download failed';
      addDiagnosticLog({ level: 'error', category: 'UPDATE', message: msg });
      setUpdateInfo({ isDownloading: false, downloadProgress: 0 });
      setPhase('idle');
      return false;
    }
  };

  /**
   * One-click install: downloads if needed, then runs the installer.
   *   • Electron → download in renderer, pass URL to main process which
   *     downloads + spawns the .exe + quits
   *   • Web      → download in renderer, save .exe via blob anchor
   */
  const handleInstall = async () => {
    if (phase === 'installing' || phase === 'downloading') return;
    setPhase('installing');
    setUpdateInfo({ isInstalling: true });
    addDiagnosticLog({
      level: 'info',
      category: 'UPDATE',
      message: `Installing update v${updateInfo.latestVersion}…`,
    });

    // Electron: pass the download URL to main process — it downloads,
    // saves, spawns the installer, and quits the app.
    if (window.callerflash?.updater?.install) {
      const url = artifactUrl || `${updateInfo.releasePageUrl}`;
      window.callerflash.updater.install(url);
      return;
    }

    // Web: ensure we have the file downloaded, then save it.
    if (!downloadedBlobUrl && artifactUrl) {
      addDiagnosticLog({ level: 'info', category: 'UPDATE', message: 'Downloading before install…' });
      const ok = await runDownload({ version: updateInfo.latestVersion, downloadUrl: artifactUrl });
      if (!ok) {
        setPhase('idle');
        setUpdateInfo({ isInstalling: false });
        return;
      }
    }

    // Trigger a file save of the downloaded .exe.
    if (downloadedBlobUrl) {
      const a = document.createElement('a');
      a.href = downloadedBlobUrl;
      a.download = downloadedFileName || `CallerFlash-${updateInfo.latestVersion}.exe`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } else if (artifactUrl) {
      window.open(artifactUrl, '_blank');
    }

    setTimeout(() => {
      setUpdateInfo({
        isInstalling: false,
        currentVersion: updateInfo.latestVersion,
        updateAvailable: false,
        downloadProgress: 0,
      });
      setPhase('idle');
      addDiagnosticLog({
        level: 'success',
        category: 'UPDATE',
        message: `Update v${updateInfo.latestVersion} installer saved — run it to complete the update.`,
      });
    }, 1000);
  };

  const openUrl = (url: string) => {
    if (window.callerflash?.shell?.openExternal) {
      window.callerflash.shell.openExternal(url);
    } else {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  const openReleasePage = (release?: GithubRelease) => {
    const url = release?.html_url
      ?? updateInfo.releasePageUrl
      ?? `${updateInfo.githubRepo}/releases`;
    openUrl(url);
  };

  const isBusy = phase === 'checking' || phase === 'downloading' || phase === 'installing';

  return (
    <div className="flex flex-col h-full gap-3 animate-fade-in">
      {/* Compact header — title left, Check + Releases right */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xl font-bold text-win-text">Updates</h2>
          <p className="text-xs text-win-text-secondary mt-0.5">
            v{updateInfo.currentVersion} · <span className="capitalize">{updateInfo.updateChannel}</span> channel
            {updateInfo.updateAvailable && phase !== 'installing' && (
              <> · v{updateInfo.latestVersion} available</>
            )}
            {phase === 'installing' && (
              <> · installing…</>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => openReleasePage()}
            className="flex items-center gap-2 px-3 py-1.5 bg-win-surface hover:bg-win-surface-hover text-win-text-secondary rounded-lg text-sm transition-colors border border-win-border"
            title="Open the GitHub Releases page"
          >
            <GithubIcon className="w-3.5 h-3.5" />
            Releases
            <ExternalLink className="w-3 h-3" />
          </button>
          <button
            onClick={handleCheckAndDownload}
            disabled={isBusy}
            className="flex items-center gap-2 px-3.5 py-1.5 bg-win-accent hover:bg-win-accent-hover text-black rounded-lg text-sm font-semibold transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${phase === 'checking' ? 'animate-spin' : ''}`} />
            {phase === 'checking' ? 'Checking…' : 'Check for Updates'}
          </button>
        </div>
      </div>

      {/* Outcome banner — only the serious cases surface here:
          verification-failed gets a warning. Missing-assets is
          expected for manual uploads and is shown as a soft info
          hint inline with the existing Updates header so the user
          knows there's a newer release + where to get it. */}
      {outcome?.kind === 'verification-failed' && phase === 'idle' && (
        <div className="flex items-start gap-3 px-3 py-2.5 rounded-xl bg-win-warning/10 border border-win-warning/30">
          <AlertCircle className="w-4 h-4 text-win-warning flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-win-warning">Update blocked by verification</p>
            <p className="text-xs text-win-text-secondary leading-snug mt-0.5">{outcome.message}</p>
            {outcome.release && (
              <button
                onClick={() => openReleasePage(outcome.release as GithubRelease)}
                className="mt-1.5 inline-flex items-center gap-1.5 text-xs font-medium text-win-accent hover:text-win-accent-hover transition-colors"
              >
                <ExternalLink className="w-3 h-3" />
                Open {outcome.release.tag_name} on GitHub
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Prominent update-available banner ─────────────────────── */}
      {updateInfo.updateAvailable && phase !== 'checking' && (
        <div className="flex items-center gap-4 px-4 py-3 rounded-xl bg-gradient-to-r from-amber-500/15 to-yellow-500/10 border border-amber-400/40">
          <div className="flex-shrink-0 w-10 h-10 rounded-full bg-amber-400/20 flex items-center justify-center">
            <Download className="w-5 h-5 text-amber-400" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-win-text">
              Update available: v{updateInfo.latestVersion}
            </p>
            <p className="text-[11px] text-win-text-secondary mt-0.5">
              {downloadedBlobUrl
                ? 'Downloaded and verified — click Install to update.'
                : `Newer than your current v${updateInfo.currentVersion} on the ${updateInfo.updateChannel} channel.`}
            </p>
          </div>
          <div className="flex-shrink-0">
            <button
              onClick={handleInstall}
              disabled={isBusy}
              className="flex items-center gap-2 px-4 py-2 bg-win-success hover:bg-win-success/85 text-black rounded-lg text-sm font-semibold transition-colors disabled:opacity-50"
            >
              <Download className={`w-4 h-4 ${phase === 'downloading' || phase === 'installing' ? 'animate-spin' : ''}`} />
              {phase === 'downloading' ? 'Downloading…'
                : phase === 'installing' ? 'Installing…'
                : 'Install Update'}
            </button>
          </div>
        </div>
      )}



      {/* Verification Audit Panel */}
      {verification && (
        <div className="bg-win-surface rounded-xl border border-win-border p-3 flex-shrink-0">
          <div className="flex items-center gap-2 mb-2">
            {verification.approved ? (
              <ShieldCheck className="w-4 h-4 text-win-success" />
            ) : (
              <XIcon className="w-4 h-4 text-win-error" />
            )}
            <h3 className="text-sm font-semibold text-win-text">
              Verification {verification.approved ? 'Passed' : 'Failed'}
            </h3>
          </div>
          <div className="space-y-1">
            {verification.steps.map((step, i) => (
              <div key={i} className="flex items-start gap-2 px-2.5 py-1.5 rounded-lg bg-win-card border border-win-border/50">
                {step.passed ? (
                  <Check className="w-3 h-3 text-win-success flex-shrink-0 mt-0.5" />
                ) : (
                  <XIcon className="w-3 h-3 text-win-error flex-shrink-0 mt-0.5" />
                )}
                <div className="min-w-0">
                  <p className="text-xs font-medium text-win-text">{step.name}</p>
                  <p className="text-[11px] text-win-text-tertiary">{step.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Download Progress */}
      {phase === 'downloading' && (
        <div className="bg-win-surface rounded-xl border border-win-border p-3 flex-shrink-0">
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-xs font-medium text-win-text">
              {phase === 'downloading' ? 'Downloading update…' : 'Preparing…'}
            </p>
            <span className="text-xs font-bold text-win-accent">
              {Math.round(updateInfo.downloadProgress)}%
            </span>
          </div>
          <div className="h-1.5 bg-win-card rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-win-accent to-blue-500 rounded-full transition-all duration-300"
              style={{ width: `${updateInfo.downloadProgress}%` }}
            />
          </div>
        </div>
      )}

      {/* Release Notes (collapsed) */}
      {updateInfo.updateAvailable && updateInfo.releaseNotes && phase !== 'downloading' && phase !== 'installing' && (
        <div className="bg-win-surface rounded-xl border border-win-border p-3 flex-shrink-0">
          <button
            onClick={() => setShowReleaseNotes(!showReleaseNotes)}
            className="flex items-center gap-2 text-xs font-medium text-win-text-secondary hover:text-win-text transition-colors w-full text-left"
          >
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showReleaseNotes ? 'rotate-180' : ''}`} />
            Release notes for v{updateInfo.latestVersion}
          </button>
          {showReleaseNotes && (
            <pre className="mt-2 text-[11px] text-win-text-secondary bg-win-card rounded-lg p-2.5 border border-win-border/50 whitespace-pre-wrap">
              {updateInfo.releaseNotes}
            </pre>
          )}
        </div>
      )}

      {/* Settings + Security side by side, release history at the bottom.
          No internal scrollbars on Settings/Security — all content fits
          its natural height. Only the Release History list scrolls. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="bg-win-surface rounded-xl border border-win-border p-3">
          <h3 className="text-sm font-semibold text-win-text mb-2 flex items-center gap-2">
            <Shield className="w-4 h-4 text-win-accent" />
            Settings
          </h3>

          {/* Update Channel */}
          <div className="p-2.5 rounded-lg bg-win-card border border-win-border/50 mb-2">
            <p className="text-[11px] font-medium text-win-text-secondary mb-1.5">Update Channel</p>
            <div className="flex gap-1.5">
              {(['stable', 'beta', 'nightly'] as const).map((channelOpt) => (
                <button
                  key={channelOpt}
                  onClick={() => setUpdateInfo({ updateChannel: channelOpt })}
                  className={`flex-1 px-2 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    updateInfo.updateChannel === channelOpt
                      ? 'bg-win-accent/20 text-win-accent border border-win-accent/30'
                      : 'bg-win-surface text-win-text-secondary hover:bg-win-surface-hover border border-win-border'
                  }`}
                >
                  <GitBranch className="w-3 h-3 mx-auto mb-0.5" />
                  {channelOpt.charAt(0).toUpperCase() + channelOpt.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {/* Auto-check frequency */}
          <div className="p-2.5 rounded-lg bg-win-card border border-win-border/50 mb-2">
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-[11px] font-medium text-win-text-secondary">Auto-check frequency</p>
              <p className="text-[10px] text-win-text-tertiary">
                Last: {formatRelativeLastCheck(updateInfo.lastChecked)}
              </p>
            </div>
            <div className="flex gap-1.5">
              {(['off', 'daily', 'weekly', 'monthly'] as const).map((freq) => (
                <button
                  key={freq}
                  onClick={() => setUpdateInfo({ updateCheckFrequency: freq })}
                  className={`flex-1 px-2 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    updateInfo.updateCheckFrequency === freq
                      ? 'bg-win-accent/20 text-win-accent border border-win-accent/30'
                      : 'bg-win-surface text-win-text-secondary hover:bg-win-surface-hover border border-win-border'
                  }`}
                >
                  {freq === 'off' ? 'Off' : freq.charAt(0).toUpperCase() + freq.slice(1)}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-win-text-tertiary mt-1.5 leading-snug">
              {updateInfo.updateCheckFrequency === 'off'
                ? 'Auto-check disabled. Use the Check button to look manually.'
                : `Auto-checks on tab open if the last check is older than ${FREQUENCY_INTERVAL_DAYS[updateInfo.updateCheckFrequency]} day${FREQUENCY_INTERVAL_DAYS[updateInfo.updateCheckFrequency] === 1 ? '' : 's'}.`}
            </p>
          </div>

          {/* Auto-download toggle */}
          <div
            className="flex items-center justify-between p-2.5 rounded-lg bg-win-card border border-win-border/50 hover:border-win-border cursor-pointer transition-colors mb-2"
            onClick={() => setUpdateInfo({ autoDownload: !updateInfo.autoDownload })}
          >
            <div className="min-w-0 pr-2">
              <p className="text-sm font-medium text-win-text">Auto-download updates</p>
              <p className="text-[11px] text-win-text-tertiary">
                {updateInfo.autoDownload
                  ? `Verified ${updateInfo.updateChannel} updates download in the background. You'll be prompted to install.`
                  : 'Updates are shown but not downloaded. Click Download to get them manually.'}
              </p>
            </div>
            <div className={`w-9 h-[20px] rounded-full transition-colors relative flex-shrink-0 ${
              updateInfo.autoDownload ? 'bg-win-accent' : 'bg-win-border'
            }`}>
              <div className={`absolute top-[2px] w-4 h-4 rounded-full bg-white shadow transition-transform ${
                updateInfo.autoDownload ? 'translate-x-[19px]' : 'translate-x-[2px]'
              }`} />
            </div>
          </div>


        </div>

        <div className="bg-win-surface rounded-xl border border-win-border p-3">
          <h3 className="text-sm font-semibold text-win-text mb-2 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-win-success" />
            Security
          </h3>
          <div className="space-y-1.5">
            <SecurityRow
              icon={<FileLock className="w-3.5 h-3.5 text-win-accent" />}
              title="Authenticode Code Signing"
            />
            <SecurityRow
              icon={<ShieldCheck className="w-3.5 h-3.5 text-win-success" />}
              title="SHA-256 Checksum"
            />
            <SecurityRow
              icon={<Key className="w-3.5 h-3.5 text-win-warning" />}
              title="Ed25519 Detached Signature"
            />
            <SecurityRow
              icon={<Shield className="w-3.5 h-3.5 text-win-accent" />}
              title="HTTPS + Host Allow-list"
            />
            <SecurityRow
              icon={<Shield className="w-3.5 h-3.5 text-win-accent" />}
              title="Version Monotonicity"
            />
            <details className="text-[11px] text-win-text-tertiary group mt-1">
              <summary className="cursor-pointer hover:text-win-text-secondary select-none">
                How to verify a release manually
              </summary>
              <pre className="mt-1.5 p-2.5 bg-win-card rounded-lg border border-win-border/50 overflow-x-auto leading-relaxed text-[10px]">{`# 1. Download the .sig and SHA256SUMS from the GitHub release
curl -LO https://github.com/.../CallerFlash-Setup-1.5.0.exe.sig
curl -LO https://github.com/.../SHA256SUMS

# 2. Verify the detached signature against the pinned key
openssl pkeyutl -verify -rawin -pubin \\
  -inkey <(echo $CALLERFLASH_RELEASE_PUB | base64 -d) \\
  -in SHA256SUMS \\
  -sigfile CallerFlash-Setup-1.5.0.exe.sig

# 3. Verify the SHA-256 matches what you downloaded
sha256sum -c SHA256SUMS --ignore-missing`}</pre>
            </details>
          </div>
        </div>

        {/* Release History — strictly filtered to the active channel */}
        <div className="bg-win-surface rounded-xl border border-win-border p-3 lg:col-span-2 flex flex-col min-h-0">
          <div className="flex items-center justify-between mb-2 flex-shrink-0">
            <h3 className="text-sm font-semibold text-win-text flex items-center gap-2">
              <GitCommit className="w-4 h-4 text-win-accent" />
              {updateInfo.updateChannel.charAt(0).toUpperCase() + updateInfo.updateChannel.slice(1)} Releases
            </h3>
            {channelReleases.length > 0 && (
              <span className="text-[10px] text-win-text-tertiary">
                {channelReleases.length} release{channelReleases.length === 1 ? '' : 's'}
              </span>
            )}
          </div>

          {channelReleases.length === 0 ? (
            <div className="text-center py-4">
              <p className="text-xs text-win-text-tertiary">
                {releases.length === 0
                  ? 'Loading…'
                  : `No ${updateInfo.updateChannel} releases found yet.`}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-win-border/40 overflow-y-auto pr-1">
              {channelReleases.map((release) => {
                const isCurrent = release.tag_name.replace(/^v/, '') === updateInfo.currentVersion;
                const notes = parseChangelog(release.body);
                return (
                  <div key={release.tag_name} className="py-2 first:pt-0 last:pb-0">
                    <div className="flex items-baseline justify-between gap-3 mb-1">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-xs font-bold text-win-text truncate">
                          {release.tag_name}
                        </span>
                        {isCurrent && (
                          <span className="px-1.5 py-0.5 bg-win-accent/15 text-win-accent rounded text-[10px] font-semibold flex-shrink-0">
                            CURRENT
                          </span>
                        )}
                        {release.prerelease && !isCurrent && (
                          <span className="px-1.5 py-0.5 bg-win-warning/15 text-win-warning rounded text-[10px] font-semibold flex-shrink-0">
                            PRE-RELEASE
                          </span>
                        )}
                      </div>
                      <span className="text-[11px] text-win-text-tertiary tabular-nums flex-shrink-0">
                        {formatReleaseDate(release.published_at)}
                      </span>
                    </div>
                    {notes.length > 0 && (
                      <ul className="space-y-0.5">
                        {notes.map((note, i) => (
                          <li
                            key={i}
                            className="text-[11px] text-win-text-secondary leading-snug pl-3 relative before:content-['–'] before:absolute before:left-0 before:text-win-text-tertiary"
                          >
                            {note}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SecurityRow({
  icon,
  title,
}: {
  icon: React.ReactNode;
  title: string;
}) {
  return (
    <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-win-card border border-win-border/50">
      <span className="flex-shrink-0">{icon}</span>
      <p className="text-xs font-medium text-win-text">{title}</p>
    </div>
  );
}
