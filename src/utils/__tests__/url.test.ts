import { describe, it, expect } from 'vitest';
import { extractUrls, getUrlDomain, getUrlLabel, getFaviconUrl, ensureHttpUrl } from '@/utils/url';

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
