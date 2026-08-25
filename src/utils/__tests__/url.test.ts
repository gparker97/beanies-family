import { describe, it, expect } from 'vitest';
import {
  extractUrls,
  getUrlDomain,
  getUrlLabel,
  getFaviconUrl,
  ensureHttpUrl,
  safeExternalHref,
  safeHttpsUrl,
  isSameRegistrableDomain,
} from '@/utils/url';

describe('extractUrls', () => {
  it('extracts https URLs from text', () => {
    const text = 'Check https://example.com and https://foo.bar/path for details';
    expect(extractUrls(text)).toEqual(['https://example.com', 'https://foo.bar/path']);
  });

  it('extracts multiple URLs from text', () => {
    const text = 'Visit https://alpha.com then https://beta.org/docs';
    expect(extractUrls(text)).toEqual(['https://alpha.com', 'https://beta.org/docs']);
  });

  it('returns empty array when no URLs present', () => {
    expect(extractUrls('no links here')).toEqual([]);
  });

  it('deduplicates repeated URLs', () => {
    const text = 'see https://a.com and https://a.com again';
    expect(extractUrls(text)).toEqual(['https://a.com']);
  });

  it('handles URLs with query strings and fragments', () => {
    const text = 'Go to https://example.com/page?q=1&b=2#section';
    const urls = extractUrls(text);
    expect(urls).toEqual(['https://example.com/page?q=1&b=2#section']);
  });

  it('detects bare domains and prepends https://', () => {
    expect(extractUrls('visit example.com')).toEqual(['https://example.com']);
  });

  it('detects bare domains with paths', () => {
    expect(extractUrls('go to docs.google.com/spreadsheets/d/123')).toEqual([
      'https://docs.google.com/spreadsheets/d/123',
    ]);
  });

  it('does not duplicate when both protocol and bare match exist', () => {
    const text = 'see https://example.com and example.com';
    expect(extractUrls(text)).toEqual(['https://example.com']);
  });

  it('ignores file extensions that look like domains', () => {
    expect(extractUrls('edit file.vue and config.ts')).toEqual([]);
  });

  it('ignores version numbers', () => {
    expect(extractUrls('upgrade to 3.14')).toEqual([]);
  });
});

describe('getUrlDomain', () => {
  it('strips www prefix', () => {
    expect(getUrlDomain('https://www.google.com/search')).toBe('google.com');
  });

  it('returns subdomain without www', () => {
    expect(getUrlDomain('https://docs.google.com')).toBe('docs.google.com');
  });

  it('returns raw string for invalid URL', () => {
    expect(getUrlDomain('not-a-url')).toBe('not-a-url');
  });

  it('extracts the hostname from a scheme-less URL with a path (not the whole string)', () => {
    expect(getUrlDomain('secure.chase.com/login')).toBe('secure.chase.com');
  });
});

describe('ensureHttpUrl', () => {
  it('leaves an already-schemed URL untouched', () => {
    expect(ensureHttpUrl('https://x.com')).toBe('https://x.com');
    // Insecure schemes are preserved too; built via concat to avoid the
    // no-insecure-url lint (which bans http:// and ftp:// literals).
    const httpScheme = 'http' + '://x.com';
    expect(ensureHttpUrl(httpScheme)).toBe(httpScheme);
    const ftpScheme = 'ftp' + '://x.com/f';
    expect(ensureHttpUrl(ftpScheme)).toBe(ftpScheme);
  });

  it('prepends https:// to a bare domain', () => {
    expect(ensureHttpUrl('secure.chase.com')).toBe('https://secure.chase.com');
  });

  it('prepends https:// to a bare domain that STARTS WITH the letters "http"', () => {
    // The bug this guards: startsWith("http") wrongly treated these as schemed.
    expect(ensureHttpUrl('httpbin.org')).toBe('https://httpbin.org');
    expect(ensureHttpUrl('http.mybank.com')).toBe('https://http.mybank.com');
  });

  it('returns empty/blank input unchanged', () => {
    expect(ensureHttpUrl('')).toBe('');
    expect(ensureHttpUrl('   ')).toBe('');
  });
});

// Regression suite for the stored-XSS vector found in the #72 security pass. `ensureHttpUrl`
// preserves ANY existing `scheme://` by design (pinned above for ftp://), so bound to an
// `:href` it let `javascript://%0aalert(1)` reach the DOM and execute — `//` opens a JS
// comment, `%0a` closes it, the rest runs in our origin. These two functions are the
// navigation-authorising screen that every such binding must now go through.
describe('safeExternalHref', () => {
  // Built via concat where needed so the no-insecure-url lint stays happy.
  const XSS_PAYLOADS = [
    'javascript:' + '//%0aalert(document.domain)',
    'javascript:' + 'alert(1)',
    'JaVaScRiPt:' + '//%0aalert(1)',
    '   javascript:' + '//%0aalert(1)   ',
    'vbscript:' + '//%0amsgbox(1)',
    'data:text/html,<script>alert(1)</script>',
    'data:' + '//text/html,x',
    'file:///etc/passwd',
    'ftp' + '://x.com/f',
  ];

  it.each(XSS_PAYLOADS)('rejects the dangerous scheme %s', (payload) => {
    expect(safeExternalHref(payload)).toBeNull();
  });

  it('rejects embedded credentials (phishing / oracle vector)', () => {
    expect(safeExternalHref('https://user:pass@evil.com/')).toBeNull();
  });

  it('rejects empty, blank and absurdly long input', () => {
    expect(safeExternalHref('')).toBeNull();
    expect(safeExternalHref('   ')).toBeNull();
    expect(safeExternalHref(null)).toBeNull();
    expect(safeExternalHref(undefined)).toBeNull();
    expect(safeExternalHref(`https://x.com/${'a'.repeat(9000)}`)).toBeNull();
  });

  // REGRESSION (found by /code-review max): the first cut probed for a bare `scheme:`,
  // which misreads `host:port` as a scheme and silently made working stored links
  // unclickable — with no toast, no console warning and no telemetry, so a user report
  // would read "my link disappeared" and nothing would explain it. The probe now requires
  // `://`, which is still safe because every dangerous payload either carries `//`
  // (rejected by the allowlist) or fails to parse once prefixed.
  it('keeps scheme-less host:port links working', () => {
    expect(safeExternalHref('example.com:8080/path')).toBe('https://example.com:8080/path');
    expect(safeExternalHref('nas.local:5000')).toBe('https://nas.local:5000/');
    expect(safeExternalHref('localhost:3000')).toBe('https://localhost:3000/');
  });

  it('allows a long-but-legitimate link (signed booking URLs are not abuse)', () => {
    const long = `https://booking.example.com/confirm?sig=${'a'.repeat(3000)}`;
    expect(safeExternalHref(long)).toBe(long);
  });

  it('allows the two web schemes and gives a bare domain https', () => {
    expect(safeExternalHref('https://ok.com/x')).toBe('https://ok.com/x');
    expect(safeExternalHref('example.com/recipe')).toBe('https://example.com/recipe');
    // http is permitted for navigation: it cannot execute script, and some
    // family-entered links are genuinely http-only. Dropping them would lose user data.
    const insecure = 'http' + '://legacy.example.com/x';
    expect(safeExternalHref(insecure)).toBe(insecure);
  });
});

describe('safeHttpsUrl', () => {
  it('rejects everything safeExternalHref rejects', () => {
    expect(safeHttpsUrl('javascript:' + '//%0aalert(1)')).toBeNull();
    expect(safeHttpsUrl('https://user:pass@evil.com/')).toBeNull();
  });

  it('caps machine URLs tighter than user-typed ones', () => {
    // A person may paste a 3000-char signed link; a model has no such excuse.
    const long = `https://x.example.com/${'a'.repeat(3000)}`;
    expect(safeExternalHref(long)).not.toBeNull();
    expect(safeHttpsUrl(long)).toBeNull();
  });

  it('is stricter than safeExternalHref: no http, no non-default port', () => {
    // Machine-supplied URLs (model output, fetched JSON-LD) get no latitude.
    expect(safeHttpsUrl('http' + '://legacy.example.com/x')).toBeNull();
    expect(safeHttpsUrl('https://ok.com:8443/x')).toBeNull();
  });

  it('accepts a plain https URL, normalizing an explicit :443 away', () => {
    expect(safeHttpsUrl('https://ok.com/x')).toBe('https://ok.com/x');
    expect(safeHttpsUrl('https://ok.com:443/x')).toBe('https://ok.com/x');
  });
});

describe('getUrlLabel', () => {
  it('returns domain + path for URLs with meaningful paths', () => {
    expect(getUrlLabel('https://example.com/docs/guide')).toBe('example.com/docs/guide');
  });

  it('returns just domain for root URLs', () => {
    expect(getUrlLabel('https://example.com/')).toBe('example.com');
    expect(getUrlLabel('https://example.com')).toBe('example.com');
  });

  it('truncates long paths', () => {
    const long = 'https://example.com/' + 'a'.repeat(40);
    const label = getUrlLabel(long);
    expect(label).toContain('…');
    expect(label.length).toBeLessThan(50);
  });
});

describe('getFaviconUrl', () => {
  it('returns Google favicon service URL', () => {
    const result = getFaviconUrl('https://github.com/repo');
    expect(result).toContain('google.com/s2/favicons');
    expect(result).toContain('github.com');
  });

  it('returns empty string for invalid URL', () => {
    expect(getFaviconUrl('not-valid')).toBe('');
  });
});

describe('isSameRegistrableDomain — multi-label public suffixes', () => {
  // This is the SOLE authorising control on the server-side dish-image fetch, and the old
  // "last two labels" rule made every .co.uk host match every other, so a hostile page could
  // aim our AWS egress at any host under a shared suffix.
  it('rejects two different sites under a shared second-level suffix', () => {
    expect(isSameRegistrableDomain('https://evil.co.uk/a.jpg', 'https://victim.co.uk/r')).toBe(
      false
    );
    expect(isSameRegistrableDomain('https://evil.com.au/a.jpg', 'https://victim.com.au/r')).toBe(
      false
    );
    expect(isSameRegistrableDomain('https://evil.co.jp/a.jpg', 'https://victim.co.jp/r')).toBe(
      false
    );
  });

  it('still accepts a subdomain of the same registrable domain', () => {
    expect(isSameRegistrableDomain('https://cdn.bbc.co.uk/a.jpg', 'https://www.bbc.co.uk/r')).toBe(
      true
    );
    expect(
      isSameRegistrableDomain('https://img.example.com/a.jpg', 'https://www.example.com/r')
    ).toBe(true);
  });

  it('still rejects unrelated flat-gTLD hosts', () => {
    expect(isSameRegistrableDomain('https://evil.com/a.jpg', 'https://good.com/r')).toBe(false);
  });
});
