# Security Policy

## Reporting a Vulnerability

**Please do not open a public GitHub issue for security bugs.** Email
`security@callerflash.app` (PGP key on request) or use GitHub's
[private vulnerability reporting](../../security/advisories/new).

We aim to acknowledge within 48 hours and provide a fix or mitigation
within 14 days for high-severity issues.

---

## Threat Model

CallerFlash is a Windows desktop application that maintains a persistent
SIP registration with a third-party VoIP provider. Its threat surface is:

| Asset | Threat | Mitigation |
|-------|--------|-----------|
| Update channel | Supply-chain compromise via CDN or GitHub account takeover | Authenticode signature, SHA-256, Ed25519 detached sig, pinned public key |
| SIP credentials | Theft from disk or memory | `safeStorage` (Windows DPAPI), never written to logs |
| Caller ID data | Display-name injection (CRLF, control bytes) | Sanitization at parser exit |
| Clipboard contents | Cross-app injection via auto-copy | Strict digit-only sanitizer |
| Renderer process | XSS / RCE | Strict CSP, sandboxed `BrowserWindow`, `nodeIntegration: false`, `contextIsolation: true` |
| External links | Accidental RCE via `javascript:` URIs | URL allow-list + `shell.openExternal` only |
| Registration spam | Attacker-controlled SIP server | Version monotonicity + pinned Ed25519 key |

---

## Update Security

Every release is signed using **three independent layers**. All three
must pass for the update to install.

### 1. Authenticode Code Signing (Windows)

The signed `.exe`/`.msi` carries a publisher identity tied to a
certificate held by the project maintainer. EV (Extended Validation)
certificates are strongly preferred because they immediately clear
SmartScreen without a reputation-building period.

### 2. SHA-256 Checksum

A `SHA256SUMS` file is attached to every GitHub release. The Electron
main process downloads this file alongside the binary and verifies
`hash(actualBinary) === expectedHash`.

### 3. Ed25519 Detached Signature

The `SHA256SUMS` file is signed with an Ed25519 private key held
**offline** by the maintainer. The detached `.sig` file is attached to
the release.

The Electron main process verifies the signature against a **public
key hard-coded in the app binary** (`RELEASE_SIGNING_PUBLIC_KEY_B64` in
`src/security/updateVerifier.ts`). The key is never fetched from the
network — that would itself be a hijack vector.

```
# Generate the keypair (once, offline)
openssl genpkey -algorithm Ed25519 -out release-signing.key
openssl pkey -in release-signing.key -pubout -out release-signing.pub

# Sign a release
sha256sum CallerFlash-Setup-X.Y.Z.exe > SHA256SUMS
openssl pkeyutl -sign -rawin -in SHA256SUMS -inkey release-signing.key \
    -out CallerFlash-Setup-X.Y.Z.exe.sig

# Users verify with:
openssl pkeyutl -verify -rawin -pubin \
    -inkey release-signing.pub \
    -in SHA256SUMS \
    -sigfile CallerFlash-Setup-X.Y.Z.exe.sig
```

### Additional Gates

* **HTTPS only** + **host allow-list** (`github.com`,
  `api.github.com`, `objects.githubusercontent.com`,
  `raw.githubusercontent.com`).
* **Version monotonicity** — never installs a release older than the
  currently running version. Defeats roll-back attacks.
* **Minimum supported version** — ancient versions cannot skip updates.
* **No redirects** — the GitHub API host is pinned in code, and the
  download URL is validated against the host allow-list before fetch.

---

## Cryptographic Storage (Production)

In the Electron build, SIP credentials are encrypted at rest using
**Electron's `safeStorage`** API, which delegates to **Windows DPAPI**
on Windows and the Keychain on macOS. The encryption key is bound to
the user's login session — even an attacker with raw disk access
cannot decrypt the secrets without also compromising the user account.

The web demo cannot use DPAPI. In the demo, credentials live in
React state and are never persisted to `localStorage`.

---

## Renderer Hardening

The `BrowserWindow` is configured as follows in the Electron build:

```ts
new BrowserWindow({
  webPreferences: {
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
    preload: path.join(__dirname, 'preload.cjs'),
  },
});
```

The renderer runs under a strict CSP defined in `index.html`:

```
default-src 'self';
script-src 'self' 'wasm-unsafe-eval';
style-src 'self' https://fonts.googleapis.com 'unsafe-inline';
font-src 'self' https://fonts.gstatic.com data:;
img-src 'self' data:;
connect-src 'self' https://api.github.com
                 https://github.com
                 https://objects.githubusercontent.com;
form-action 'none';
object-src 'none';
base-uri 'self';
frame-ancestors 'none';
upgrade-insecure-requests;
```

All `window.open` and `<a target="_blank">` calls go through
`shell.openExternal` in the main process, which is gated by a URL
allow-list to prevent accidental `javascript:` execution.

---

## Secret Handling

`src/security/secretRedactor.ts` is the single chokepoint for log
content. It:

* Replaces any value bound to a sensitive key (password, token,
  authorization, etc.) with `***REDACTED***`.
* Strips JWTs, bearer tokens, SIP auth digests, and long hex blobs
  from free-form log messages.
* Sanitizes caller names at the SIP parser exit, stripping any byte
  outside printable ASCII.
* Sanitizes the clipboard payload to digits-only (plus a leading `+`)
  so a malicious caller-name field cannot piggyback into the clipboard.

The diagnostic export button writes the **already-redacted** log
buffer to disk — there is no path from SIP password to exported file.

---

## Dependency Hygiene

* `npm audit --omit=dev` is run on every CI build. Failures block merge.
* All dependencies are pinned to exact versions in `package-lock.json`.
* Renovate Bot (or equivalent) opens PRs for security updates within
  24 hours of disclosure.
* The build pipeline runs `npm ci --ignore-scripts` to prevent
  postinstall scripts from executing on developer or CI machines.
* The release workflow uses GitHub Actions with
  `permissions: read-all` and explicit `permissions:` blocks per job.
  No workflow has `write` access to the repository by default.

---

## Reporting Compromised Releases

If you discover a release with a tampered binary, a missing signature,
or an unverified checksum, **do not run the binary**. Email
`security@callerflash.app` with the release tag and SHA-256. We will:

1. Yank the release immediately.
2. Invalidate any cached installer URLs.
3. Publish a `security-advisory` GitHub Security Advisory.
4. Force-push a corrected release signed with a fresh key (if the
   signing key is suspected of compromise).

---

## Acknowledgements

We thank the security researchers who have helped harden CallerFlash.
Past disclosures are listed in the
[Security Advisories](../../security/advisories) tab.