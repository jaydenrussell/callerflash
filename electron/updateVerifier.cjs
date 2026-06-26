const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { webcrypto, createHash } = require('crypto');

const RELEASE_SIGNING_PUBLIC_KEY_B64 = '/JxOdXdU5qZLF7xHZDLD/fnXJV814KqTB3DVx7WWiKg=';
const ALLOWED_UPDATE_HOSTS = new Set([
  'github.com',
  'api.github.com',
  'objects.githubusercontent.com',
  'raw.githubusercontent.com',
]);

function isAllowedUrl(input) {
  try {
    const url = new URL(input);
    return url.protocol === 'https:' && ALLOWED_UPDATE_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

function bytesFromBase64(base64) {
  return Buffer.from(base64, 'base64');
}

async function verifyManifestSignature(manifestText, signatureB64) {
  const subtle = webcrypto?.subtle;
  if (!subtle) throw new Error('WebCrypto Ed25519 support is unavailable');

  const publicKey = await subtle.importKey(
    'raw',
    bytesFromBase64(RELEASE_SIGNING_PUBLIC_KEY_B64),
    { name: 'Ed25519' },
    false,
    ['verify'],
  );
  return subtle.verify(
    { name: 'Ed25519' },
    publicKey,
    bytesFromBase64(signatureB64),
    Buffer.from(manifestText, 'utf8'),
  );
}

function downloadToFile(url, filePath, onProgress, redirectDepth = 0) {
  return new Promise((resolve, reject) => {
    if (!isAllowedUrl(url)) {
      reject(new Error(`Refusing untrusted update URL: ${url}`));
      return;
    }

    const parsed = new URL(url);
    const transport = parsed.protocol === 'https:' ? https : http;
    const request = transport.get(url, {
      headers: { 'User-Agent': 'CallerFlash-Updater' },
    }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        if (redirectDepth > 5) {
          reject(new Error('Too many redirects while downloading update'));
          return;
        }
        const redirected = new URL(response.headers.location, url).toString();
        response.resume();
        downloadToFile(redirected, filePath, onProgress, redirectDepth + 1).then(resolve).catch(reject);
        return;
      }

      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode}`));
        return;
      }

      const totalBytes = Number.parseInt(response.headers['content-length'] || '0', 10);
      let received = 0;
      const hash = createHash('sha256');
      const stream = fs.createWriteStream(filePath, { flags: 'wx' });

      response.on('data', (chunk) => {
        received += chunk.length;
        hash.update(chunk);
        if (totalBytes > 0 && typeof onProgress === 'function') {
          onProgress(Math.round((received / totalBytes) * 100));
        }
      });

      response.pipe(stream);

      stream.on('finish', () => {
        stream.close(() => {
          resolve({
            sha256: hash.digest('hex'),
            bytesReceived: received,
            filePath,
          });
        });
      });

      stream.on('error', (err) => {
        fs.unlink(filePath, () => {});
        reject(err);
      });
    });

    request.on('error', reject);
    request.setTimeout(300_000, () => {
      request.destroy(new Error('Download timeout'));
    });
  });
}

async function downloadAndVerifyUpdateArtifact(artifact, filePath, onProgress) {
  if (!artifact || typeof artifact !== 'object') {
    throw new Error('Missing update artifact');
  }
  if (typeof artifact.downloadUrl !== 'string' || typeof artifact.sha256 !== 'string' || typeof artifact.sha256Manifest !== 'string' || typeof artifact.signatureB64 !== 'string') {
    throw new Error('Incomplete update artifact metadata');
  }

  const result = await downloadToFile(artifact.downloadUrl, filePath, onProgress);
  if (result.sha256.toLowerCase() !== artifact.sha256.toLowerCase()) {
    fs.unlink(filePath, () => {});
    throw new Error('Checksum mismatch for downloaded installer');
  }

  const sigOk = await verifyManifestSignature(artifact.sha256Manifest, artifact.signatureB64);
  if (!sigOk) {
    fs.unlink(filePath, () => {});
    throw new Error('Detached signature verification failed');
  }

  const basename = path.basename(new URL(artifact.downloadUrl).pathname);
  const manifestToken = new RegExp(`(^|[^A-Za-z0-9._-])${basename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^A-Za-z0-9._-]|$)`);
  if (artifact.sha256Manifest && !manifestToken.test(artifact.sha256Manifest)) {
    fs.unlink(filePath, () => {});
    throw new Error('Checksum manifest does not reference the downloaded installer');
  }

  return filePath;
}

module.exports = {
  ALLOWED_UPDATE_HOSTS,
  RELEASE_SIGNING_PUBLIC_KEY_B64,
  downloadAndVerifyUpdateArtifact,
};
