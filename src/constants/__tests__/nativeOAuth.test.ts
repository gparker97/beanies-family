import { describe, it, expect } from 'vitest';
import {
  NATIVE_REDIRECT_URI,
  NATIVE_BRIDGE_URI,
  OAUTH_RESULT_PARAMS,
  nativeOAuthTransport,
  nativeOAuthParams,
  nativeBridgeUrl,
  hasOAuthResult,
} from '../nativeOAuth';

describe('nativeOAuthTransport', () => {
  it('classifies the bare https Universal Link', () => {
    expect(nativeOAuthTransport(NATIVE_REDIRECT_URI)).toBe('universal');
  });

  it('classifies the bare custom-scheme bridge URL', () => {
    expect(nativeOAuthTransport(NATIVE_BRIDGE_URI)).toBe('custom_scheme');
  });

  it('accepts either transport with a query string', () => {
    expect(nativeOAuthTransport(`${NATIVE_REDIRECT_URI}?code=abc&state=xyz`)).toBe('universal');
    expect(nativeOAuthTransport(`${NATIVE_BRIDGE_URI}?code=abc&state=xyz`)).toBe('custom_scheme');
  });

  it('accepts either transport with a fragment', () => {
    expect(nativeOAuthTransport(`${NATIVE_REDIRECT_URI}#frag`)).toBe('universal');
    expect(nativeOAuthTransport(`${NATIVE_BRIDGE_URI}#frag`)).toBe('custom_scheme');
  });

  // This is the hole the old `url.startsWith(NATIVE_REDIRECT_URI)` guard had.
  it('rejects look-alike paths that merely share the prefix', () => {
    expect(nativeOAuthTransport(`${NATIVE_REDIRECT_URI}xyz`)).toBeNull();
    expect(nativeOAuthTransport(`${NATIVE_BRIDGE_URI}xyz`)).toBeNull();
    expect(nativeOAuthTransport(`${NATIVE_REDIRECT_URI}/extra`)).toBeNull();
  });

  it('rejects a look-alike host', () => {
    expect(nativeOAuthTransport('https://evil.com/oauth/native?code=abc')).toBeNull();
    expect(nativeOAuthTransport('https://beanies.family.evil.com/oauth/native')).toBeNull();
  });

  it('rejects unrelated deep links and junk', () => {
    expect(nativeOAuthTransport('https://beanies.family/blog/foo')).toBeNull();
    expect(nativeOAuthTransport('family.beanies.app://something-else')).toBeNull();
    expect(nativeOAuthTransport('')).toBeNull();
    expect(nativeOAuthTransport('not a url at all')).toBeNull();
  });
});

describe('nativeOAuthParams', () => {
  // The whole point of the helper: `new URL()` gives host='oauth',
  // pathname='/native' for the custom scheme, so params must not depend on them.
  it('extracts identical params from both transports', () => {
    const https = nativeOAuthParams(`${NATIVE_REDIRECT_URI}?code=abc&state=xyz`);
    const custom = nativeOAuthParams(`${NATIVE_BRIDGE_URI}?code=abc&state=xyz`);
    expect(https.get('code')).toBe('abc');
    expect(https.get('state')).toBe('xyz');
    expect(custom.get('code')).toBe('abc');
    expect(custom.get('state')).toBe('xyz');
  });

  it('returns empty params when there is no query string', () => {
    expect([...nativeOAuthParams(NATIVE_BRIDGE_URI).keys()]).toEqual([]);
    expect([...nativeOAuthParams(NATIVE_REDIRECT_URI).keys()]).toEqual([]);
  });

  it('ignores a fragment after the query', () => {
    expect(nativeOAuthParams(`${NATIVE_BRIDGE_URI}?code=abc#frag`).get('code')).toBe('abc');
  });

  it('ignores a query-looking substring inside a fragment', () => {
    expect(nativeOAuthParams(`${NATIVE_BRIDGE_URI}#frag?code=evil`).get('code')).toBeNull();
  });

  it('decodes percent-encoded values', () => {
    expect(nativeOAuthParams(`${NATIVE_BRIDGE_URI}?error=access%20denied`).get('error')).toBe(
      'access denied'
    );
  });

  it('never throws on malformed input', () => {
    expect(() => nativeOAuthParams('')).not.toThrow();
    expect(() => nativeOAuthParams('???')).not.toThrow();
  });
});

describe('nativeBridgeUrl', () => {
  it('passes the query through byte-for-byte', () => {
    expect(nativeBridgeUrl('?code=abc&state=xyz')).toBe(`${NATIVE_BRIDGE_URI}?code=abc&state=xyz`);
  });

  it('accepts a search string with or without the leading ?', () => {
    expect(nativeBridgeUrl('code=abc')).toBe(`${NATIVE_BRIDGE_URI}?code=abc`);
    expect(nativeBridgeUrl('?code=abc')).toBe(`${NATIVE_BRIDGE_URI}?code=abc`);
  });

  it('does not append a stray ? for an empty search', () => {
    expect(nativeBridgeUrl('')).toBe(NATIVE_BRIDGE_URI);
    expect(nativeBridgeUrl('?')).toBe(NATIVE_BRIDGE_URI);
  });

  it('does not re-encode already-encoded values', () => {
    const search = '?code=a%2Fb%2Bc&state=x%3Dy';
    expect(nativeBridgeUrl(search)).toBe(`${NATIVE_BRIDGE_URI}${search}`);
  });

  it('round-trips through nativeOAuthParams', () => {
    const params = nativeOAuthParams(nativeBridgeUrl('?code=a/b&state=x=y'));
    expect(params.get('code')).toBe('a/b');
    expect(params.get('state')).toBe('x=y');
  });
});

describe('hasOAuthResult', () => {
  it('is true when a code or an error is present', () => {
    expect(hasOAuthResult('?code=abc')).toBe(true);
    expect(hasOAuthResult('?error=access_denied')).toBe(true);
    expect(hasOAuthResult('code=abc')).toBe(true);
  });

  // A bare visit must not hop — it would reach the app with no `state` and fire
  // a spurious native-oauth-state-mismatch report.
  it('is false for a bare visit or an unrelated query', () => {
    expect(hasOAuthResult('')).toBe(false);
    expect(hasOAuthResult('?')).toBe(false);
    expect(hasOAuthResult('?foo=1')).toBe(false);
    expect(hasOAuthResult('?state=xyz')).toBe(false);
  });

  it('covers exactly the documented result params', () => {
    expect([...OAUTH_RESULT_PARAMS]).toEqual(['code', 'error']);
  });
});
