/**
 * Extract URLs from plain text and provide display helpers.
 */

// Matches URLs with explicit protocol
const PROTOCOL_URL_REGEX = /https?:\/\/[^\s<>"'`,;)}\]]+/gi;

// Common file extensions and patterns that look like domains but aren't
const FALSE_POSITIVES = new Set([
  'vue',
  'ts',
  'tsx',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'css',
  'scss',
  'json',
  'md',
  'txt',
  'png',
  'jpg',
  'jpeg',
  'svg',
  'gif',
  'webp',
  'xml',
  'yaml',
  'yml',
  'toml',
  'env',
  'log',
  'sh',
  'bat',
  'html',
  'htm',
  'woff',
  'woff2',
  'ttf',
]);

/**
 * Check if a candidate bare domain string is a real domain (not a file extension
 * or version number).
 */
function isBareUrl(candidate: string): boolean {
  // Version numbers like "3.14"
  if (/^\d+\.\d+$/.test(candidate)) return false;
  // File extensions like "file.vue"
  const ext = candidate.split('.').pop()?.split('/')[0]?.toLowerCase();
  if (ext && FALSE_POSITIVES.has(ext)) return false;
  return true;
}

/** Extract all URLs found in a string. Returns fully-qualified https:// URLs. */
export function extractUrls(text: string): string[] {
  const results: string[] = [];

  // First pass: explicit protocol URLs
  const protocolMatches = text.match(PROTOCOL_URL_REGEX) ?? [];
  for (const m of protocolMatches) {
    results.push(m);
  }

  // Second pass: find bare domains by splitting on whitespace
  for (const word of text.split(/\s+/)) {
    // Strip leading/trailing punctuation that isn't part of a URL
    const cleaned = word.replace(/^[(<"']+|[)>"',;.!?]+$/g, '');
    if (!cleaned || cleaned.includes('://')) continue;
    // Must contain a dot and look like a domain (word.tld)
    if (!/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,6}/i.test(cleaned)) continue;
    if (!isBareUrl(cleaned)) continue;
    // Skip if already covered by a protocol match
    const full = `https://${cleaned}`;
    if (protocolMatches.some((p) => p.includes(cleaned))) continue;
    results.push(full);
  }

  // Deduplicate while preserving order
  return [...new Set(results)];
}

/** Get display-friendly domain from a URL (e.g. "docs.google.com"). */
/**
 * Normalize a user-entered URL into a safe absolute href. Prepends `https://`
 * unless the string ALREADY carries a scheme (`http://`, `https://`, `ftp://`,
 * …). Detecting the scheme by a proper `scheme://` test — not `startsWith('http')`
 * — so a bare domain that happens to begin with the letters "http"
 * (e.g. `httpbin.org`, `http.mybank.com`) is still given a scheme rather than
 * left as a relative path the browser resolves against the app origin.
 * Empty/blank input is returned unchanged (callers guard on presence).
 */
export function ensureHttpUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return trimmed;
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export function getUrlDomain(url: string): string {
  try {
    // Normalize first so a scheme-less input (e.g. "secure.chase.com/login")
    // parses and yields just the hostname instead of falling through to raw.
    const { hostname } = new URL(ensureHttpUrl(url));
    return hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** Get a display label: domain + path hint for context. */
export function getUrlLabel(url: string): string {
  try {
    const parsed = new URL(url);
    const domain = parsed.hostname.replace(/^www\./, '');
    const path = parsed.pathname;
    // Show path hint if it's meaningful (not just "/")
    if (path && path !== '/') {
      // Truncate long paths
      const short = path.length > 30 ? path.slice(0, 30) + '…' : path;
      return `${domain}${short}`;
    }
    return domain;
  } catch {
    return url;
  }
}

/**
 * Get a favicon URL for a domain using Google's public favicon service.
 * Returns a 16×16 .ico URL.
 */
export function getFaviconUrl(url: string): string {
  try {
    const { origin } = new URL(url);
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(origin)}&sz=32`;
  } catch {
    return '';
  }
}
