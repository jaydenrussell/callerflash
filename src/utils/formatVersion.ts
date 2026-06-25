export function formatVersion(version: string): string {
  if (!version) return version;
  
  // Strip the 'v' prefix if it exists
  let cleaned = version.replace(/^v/, '');
  
  // Strip the '0.0.0-' prefix used for nightly builds
  cleaned = cleaned.replace(/^0\.0\.0-/, '');
  
  return cleaned;
}
