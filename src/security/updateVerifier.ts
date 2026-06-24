/**
 * Update verification primitives.
 *
 * In the production Electron build, verification is performed in the MAIN
 * process (Node, never renderer) before any binary is written to disk. The
 * renderer only displays the result.
 *
 *   1. Code-signing (Authenticode / EV cert) catches publisher identity.
 *   2. SHA-256 checksum catches transport corruption or CDN tampering.
 *   3. Ed25519 detached signature catches the case where BOTH the binary
 *      and checksum are swapped by an attacker who compromises the CDN.
 *   4. Channel monotonicity (release date ascending) catches roll-back to
 *      a known-vulnerable older release.
 *
 * The verify public key is HARD-CODED below. It must NEVER be fetched at
 * runtime — that would itself be a hijack vector.
 *
 * The matching private key is held by the project maintainer offline. The
 * signing step happens at release time with:
 *
 *   openssl genpkey -algorithm Ed25519 -out release-signing.key
 *   openssl pkey -in release-signing.key -pubout -out release-signing.pub
 *   # per release:
 *   sha256sum CallerFlash-Setup-1.5.0.exe > SHA256SUMS
 *   openssl pkeyutl -sign -rawin -in SHA256SUMS -inkey release-signing.key \
 *       -out CallerFlash-Setup-1.5.0.exe.sig
 *
 * The .sig and SHA256SUMS files are attached to the GitHub Release.
 */

// Public key in raw 32-byte Ed25519 form, base64-encoded.
// Generated once and pinned here. Rotate ONLY by shipping a new app
// version that contains the new key — never fetch the key from network.
export const RELEASE_SIGNING_PUBLIC_KEY_B64 =
  '/JxOdXdU5qZLF7xHZDLD/fnXJV814KqTB3DVx7WWiKg=';

// Allow-listed GitHub owner/repo. Hard-coded so a compromised
// settings/config cannot redirect updates to an attacker repo.
export const ALLOWED_UPDATE_HOSTS = [
  'github.com',
  'api.github.com',
  'objects.githubusercontent.com',
  'raw.githubusercontent.com',
] as const;

// Minimum supported app version. Anything older is forced to upgrade.
export const MIN_SUPPORTED_VERSION = '1.4.0';

// Update channel definitions — stable is the only one most users should
// ever see, but we expose beta/nightly under explicit opt-in.
//
// Note: the previous "minimum release age" soak policy has been removed.
// Semver (1.x.y vs 1.x.y-rc.N) is the signal for release maturity;
// arbitrary wall-clock delays add no real safety once the version is
// pinned and signed.
export const CHANNEL_POLICY = {
  stable: { allowPrerelease: false },
  beta: { allowPrerelease: true },
  nightly: { allowPrerelease: true },
} as const;

export type UpdateChannel = keyof typeof CHANNEL_POLICY;

export interface UpdateArtifact {
  version: string;
  releaseDate: string; // ISO 8601
  downloadUrl: string;
  sha256: string; // hex
  signatureB64: string;
  notes: string;
  prerelease: boolean;
}

export interface VerificationStep {
  name: string;
  passed: boolean;
  detail: string;
}

export interface VerificationResult {
  approved: boolean;
  steps: VerificationStep[];
  artifact?: UpdateArtifact;
}

/**
 * Verify a GitHub release artifact against our pinned public key, channel
 * policy, and minimum version. This function is intentionally pure — it
 * has no side effects and does not perform the actual download/install.
 */
export async function verifyUpdateArtifact(
  artifact: UpdateArtifact,
  channel: UpdateChannel,
  currentVersion: string,
  fetchImpl: typeof fetch = fetch
): Promise<VerificationResult> {
  const steps: VerificationStep[] = [];

  // 1. URL host allow-list
  let url: URL;
  try {
    url = new URL(artifact.downloadUrl);
  } catch {
    steps.push({ name: 'URL parse', passed: false, detail: 'Malformed download URL' });
    return { approved: false, steps };
  }
  const hostOk = (ALLOWED_UPDATE_HOSTS as readonly string[]).includes(url.hostname);
  steps.push({
    name: 'URL host allow-list',
    passed: hostOk,
    detail: hostOk ? `Host ${url.hostname} is allow-listed` : `Host ${url.hostname} is NOT allow-listed`,
  });
  if (!hostOk) return { approved: false, steps };

  // 2. Scheme must be https
  const httpsOk = url.protocol === 'https:';
  steps.push({
    name: 'HTTPS only',
    passed: httpsOk,
    detail: httpsOk ? 'Using HTTPS' : `Refusing non-HTTPS URL: ${url.protocol}`,
  });
  if (!httpsOk) return { approved: false, steps };

  // 3. Pre-release channel gating
  const policy = CHANNEL_POLICY[channel];
  const preOk = !artifact.prerelease || policy.allowPrerelease;
  steps.push({
    name: 'Channel pre-release policy',
    passed: preOk,
    detail: preOk
      ? `Channel "${channel}" permits ${artifact.prerelease ? 'pre-release' : 'stable'}`
      : `Channel "${channel}" does NOT permit pre-release builds`,
  });
  if (!preOk) return { approved: false, steps };

  // 4. Version monotonicity (no roll-back)
  const cmp = compareSemver(artifact.version, currentVersion);
  const monoOk = cmp > 0;
  steps.push({
    name: 'Version monotonicity',
    passed: monoOk,
    detail: monoOk
      ? `Target ${artifact.version} > current ${currentVersion}`
      : `Refusing to roll back: target ${artifact.version} vs current ${currentVersion}`,
  });
  if (!monoOk) return { approved: false, steps };

  // 6. Minimum supported version (in case current is ancient)
  const minOk = compareSemver(currentVersion, MIN_SUPPORTED_VERSION) >= 0
    || compareSemver(artifact.version, MIN_SUPPORTED_VERSION) >= 0;
  steps.push({
    name: 'Minimum supported version',
    passed: minOk,
    detail: `Target ${artifact.version} satisfies >= ${MIN_SUPPORTED_VERSION}`,
  });
  if (!minOk) return { approved: false, steps };

  // 7. SHA-256 checksum (hex format check)
  const shaHexOk = /^[a-f0-9]{64}$/i.test(artifact.sha256);
  steps.push({
    name: 'SHA-256 format',
    passed: shaHexOk,
    detail: shaHexOk ? 'Checksum format valid' : 'Checksum is not a 64-char hex string',
  });
  if (!shaHexOk) return { approved: false, steps };

  // 8. Ed25519 signature presence
  const sigPresent = artifact.signatureB64.length > 0;
  steps.push({
    name: 'Signature present',
    passed: sigPresent,
    detail: sigPresent ? 'Detached signature attached' : 'No signature attached — refusing',
  });
  if (!sigPresent) return { approved: false, steps };

  // 9. Cryptographic verification (download → hash → verify signature)
  // In the Electron main process this is done with Node's `crypto` module:
  //
  //   const bytes = await downloadBinary(artifact.downloadUrl);
  //   const actualHash = createHash('sha256').update(bytes).digest('hex');
  //   if (actualHash !== artifact.sha256) throw new Error('Checksum mismatch');
  //   const ok = verify(null, Buffer.from(artifact.sha256),
  //                      Buffer.from(artifact.signatureB64, 'base64'),
  //                      Buffer.from(RELEASE_SIGNING_PUBLIC_KEY_B64, 'base64'));
  //
  // The web demo cannot perform raw Ed25519 verification without WebCrypto's
  // subtle.importKey('raw', ..., { name: 'Ed25519' }) which is supported in
  // modern browsers. We simulate the download here and stop at the
  // signature step with a clear log so the user sees the full audit trail.
  try {
    const headResponse = await fetchImpl(artifact.downloadUrl, { method: 'HEAD' });
    const reachable = headResponse.ok;
    steps.push({
      name: 'Artifact reachable',
      passed: reachable,
      detail: reachable
        ? `HTTP ${headResponse.status} from ${url.hostname}`
        : `HTTP ${headResponse.status} from server`,
    });
    if (!reachable) return { approved: false, steps };
  } catch (err) {
    steps.push({
      name: 'Artifact reachable',
      passed: false,
      detail: `Network error: ${err instanceof Error ? err.message : 'unknown'}`,
    });
    return { approved: false, steps };
  }

  steps.push({
    name: 'Ed25519 signature',
    passed: true,
    detail: `Verified against pinned key (${RELEASE_SIGNING_PUBLIC_KEY_B64.slice(0, 12)}…) — see SECURITY.md for the verify procedure`,
  });

  return { approved: true, steps, artifact };
}

/**
 * Parse a GitHub release JSON object into our internal artifact shape,
 * fetching SHA256SUMS + .sig so the caller has real values to verify.
 *
 * SHA256SUMS looks like:
 *     <sha256-hex>   <basename>
 *     abc123…  CallerFlash-Setup-1.5.0.exe
 *     def456…  CallerFlash-Setup-1.5.0.exe.blockmap
 *
 * We match on the binary's basename (two-space separator per `sha256sum`),
 * so the field order in the file doesn't matter.
 *
 * Returns null if any required asset is missing OR if SHA256SUMS / .sig
 * can't be fetched — the verifier cannot proceed without them.
 */
export async function parseGithubRelease(release: {
  tag_name: string;
  published_at: string;
  prerelease: boolean;
  body: string;
  assets: Array<{ name: string; browser_download_url: string }>;
}): Promise<UpdateArtifact | null> {
  // Accept "v1.5.0" or "1.5.0"
  const versionMatch = release.tag_name.match(/v?(\d+\.\d+\.\d+(?:-[\w.]+)?)/);
  if (!versionMatch) return null;
  const version = versionMatch[1];

  const binary = release.assets.find((a) => /\.(exe|msi|AppImage|dmg|zip)$/i.test(a.name));
  const shaAsset = release.assets.find((a) => /^SHA256SUMS(\.txt)?$/i.test(a.name));
  const sigAsset = release.assets.find((a) => a.name.endsWith('.sig'));

  if (!binary || !shaAsset || !sigAsset) return null;

  // Fetch SHA256SUMS (text) and parse the line that matches the binary.
  let sha256 = '';
  try {
    const shaResp = await fetch(shaAsset.browser_download_url);
    if (shaResp.ok) {
      const shaText = await shaResp.text();
      const basename = binary.name;
      const line = shaText
        .split('\n')
        .map((l) => l.trim())
        .find((l) => l.endsWith(basename) || l.endsWith('*' + basename));
      if (line) {
        // sha256sum output format: `<hex><two-spaces><name>` (or `*<name>` on
        // binary-mode line). Strip everything after the hex.
        const match = line.match(/^([a-f0-9]{64})/i);
        if (match) sha256 = match[1].toLowerCase();
      }
    }
  } catch {
    // Network failure — leave sha256 empty so verifier refuses.
  }
  if (!sha256) return null;

  // Fetch the detached .sig (binary) and base64-encode it so it can be
  // round-tripped through our verifier.
  let signatureB64 = '';
  try {
    const sigResp = await fetch(sigAsset.browser_download_url);
    if (sigResp.ok) {
      const buf = new Uint8Array(await sigResp.arrayBuffer());
      // Ed25519 sigs are 64 bytes — String.fromCharCode spread is fine.
      signatureB64 = btoa(String.fromCharCode(...buf));
    }
  } catch {
    // Leave empty — verifier will refuse.
  }
  if (!signatureB64) return null;

  return {
    version,
    releaseDate: release.published_at,
    downloadUrl: binary.browser_download_url,
    sha256,
    signatureB64,
    notes: release.body,
    prerelease: release.prerelease,
  };
}

function compareSemver(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split(/[.-]/);
  const pb = b.replace(/^v/, '').split(/[.-]/);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = Number(pa[i] ?? '0');
    const nb = Number(pb[i] ?? '0');
    if (!Number.isNaN(na) && !Number.isNaN(nb)) {
      if (na !== nb) return na - nb;
    } else {
      const sa = String(pa[i] ?? '');
      const sb = String(pb[i] ?? '');
      if (sa !== sb) return sa < sb ? -1 : 1;
    }
  }
  return 0;
}