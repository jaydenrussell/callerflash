#!/usr/bin/env bash
# CallerFlash — Generate Ed25519 signing keypair for release verification.
#
# Run this ONCE. Store the private key in GitHub Secrets as
# RELEASE_SIGNING_PRIVATE_KEY (base64-encoded).
# Copy the base64 public key into src/security/updateVerifier.ts as
# RELEASE_SIGNING_PUBLIC_KEY_B64.

set -euo pipefail

OUTDIR="$(dirname "$0")/../.signing-keys"
mkdir -p "$OUTDIR"

echo "==> Generating Ed25519 keypair…"
openssl genpkey -algorithm Ed25519 -out "$OUTDIR/release-signing.key"
openssl pkey -in "$OUTDIR/release-signing.key" -pubout -out "$OUTDIR/release-signing.pub"

# Extract raw 32-byte public key and base64 it
PUB_B64=$(openssl pkey -in "$OUTDIR/release-signing.key" -pubout -outform DER 2>/dev/null | tail -c 32 | base64)

echo ""
echo "==> Private key: $OUTDIR/release-signing.key"
echo "    ⚠ Keep offline. Never commit this file."
echo ""
echo "==> Public key (PEM): $OUTDIR/release-signing.pub"
echo ""
echo "==> Public key (base64, for updateVerifier.ts):"
echo "    $PUB_B64"
echo ""
echo "==> Base64 of full private key (for GitHub Secret):"
base64 -w0 < "$OUTDIR/release-signing.key"
echo ""
echo ""
echo "==> Next steps:"
echo "    1. Add this to GitHub repo → Settings → Secrets → Actions:"
echo "       Name:  RELEASE_SIGNING_PRIVATE_KEY"
echo "       Value: (the base64 string above)"
echo ""
echo "    2. Replace RELEASE_SIGNING_PUBLIC_KEY_B64 in"
echo "       src/security/updateVerifier.ts with:"
echo "       '$PUB_B64'"
echo ""
echo "    3. Delete $OUTDIR/release-signing.key from this machine"
echo "       after uploading to GitHub Secrets."
echo ""
echo "    4. Keep $OUTDIR/release-signing.pub for manual verification."
