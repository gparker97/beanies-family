import { describe, it, expect } from 'vitest';
import {
  encodeRedirectState,
  decodeRedirectState,
  REDIRECT_STATE_VERSION,
  type RedirectMode,
} from './redirectState';

describe('redirectState codec', () => {
  it('round-trips routing for every mode (grant defaults to drive)', () => {
    for (const mode of ['create', 'join', 'reconnect'] as RedirectMode[]) {
      const encoded = encodeRedirectState({ returnPath: '/welcome?resume=setup', mode });
      const decoded = decodeRedirectState(encoded);
      expect(decoded).toEqual({
        returnPath: '/welcome?resume=setup',
        mode,
        grant: 'drive',
        v: REDIRECT_STATE_VERSION,
      });
    }
  });

  it('produces a URL-safe string (no +, /, or = padding)', () => {
    const encoded = encodeRedirectState({ returnPath: '/a/b?c=d&e=f', mode: 'create' });
    expect(encoded).not.toMatch(/[+/=]/);
  });

  it('stays well under the practical state size limit', () => {
    const encoded = encodeRedirectState({ returnPath: '/welcome?resume=setup', mode: 'create' });
    expect(encoded.length).toBeLessThan(256);
  });

  it('returns null (never throws) for empty / null / garbage input', () => {
    expect(decodeRedirectState(null)).toBeNull();
    expect(decodeRedirectState(undefined)).toBeNull();
    expect(decodeRedirectState('')).toBeNull();
    expect(decodeRedirectState('not-base64-!!!')).toBeNull();
    expect(decodeRedirectState(btoa('not json'))).toBeNull();
  });

  it('rejects an unknown / future version (exact-match gate)', () => {
    const future = btoa(JSON.stringify({ returnPath: '/x', mode: 'create', v: 2 }))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    expect(decodeRedirectState(future)).toBeNull();
  });

  it('rejects an unknown mode', () => {
    const bad = btoa(
      JSON.stringify({ returnPath: '/x', mode: 'delete', v: REDIRECT_STATE_VERSION })
    )
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    expect(decodeRedirectState(bad)).toBeNull();
  });

  it('rejects a non-same-origin returnPath (open-redirect guard)', () => {
    for (const evil of ['//evil.com', 'https://evil.com', 'welcome', '']) {
      const bad = btoa(
        JSON.stringify({ returnPath: evil, mode: 'create', v: REDIRECT_STATE_VERSION })
      )
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
      expect(decodeRedirectState(bad)).toBeNull();
    }
  });

  it('rejects every spelling that the prefix check let through', () => {
    /**
     * ⚠️ THE PREFIX CHECK WAS NOT ENOUGH, and `//` was only the spelling it happened to name.
     * The WHATWG parser reads a BACKSLASH as a slash in the authority position for special
     * schemes, and it STRIPS tabs, newlines and carriage returns before parsing — so four more
     * shapes below start with a single '/', are not '//', and still resolve clean off-origin.
     * Verified in node against the same parser the browser uses:
     *
     *     new URL('/\\evil.com',  'https://app.beanies.family').href === 'https://evil.com/'
     *     new URL('/\n/evil.com', 'https://app.beanies.family').href === 'https://evil.com/'
     *
     * `state` is unsigned, non-secret base64 JSON, so anyone can craft one and the join flow is
     * where people are already expected to tap unfamiliar links. Enumerating spellings is how
     * this was got wrong once; the guard now resolves and compares ORIGINS, and these cases
     * exist to prove that covers the class rather than to define it.
     */
    const escapes = [
      '/\\evil.com', // backslash read as a slash in the authority position
      '/\\/evil.com',
      '/\\\t\\evil.com', // tab stripped, leaving a protocol-relative URL
      '/\n/evil.com', // newline stripped
      '/\r\\evil.com', // carriage return stripped
    ];
    for (const evil of escapes) {
      const bad = btoa(
        JSON.stringify({ returnPath: evil, mode: 'create', v: REDIRECT_STATE_VERSION })
      )
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
      expect(decodeRedirectState(bad), `must reject ${JSON.stringify(evil)}`).toBeNull();
    }
  });

  it('still accepts odd-looking paths that stay on our own origin', () => {
    // The guard must not become a second prefix test. These normalise to a PATH on our origin,
    // so rejecting them would break real return journeys for no security gain.
    for (const fine of ['/\tevil.com', '/..//evil.com', '/join?fam=a#frag']) {
      const ok = encodeRedirectState({ returnPath: fine, mode: 'join' });
      expect(decodeRedirectState(ok)?.returnPath, `must accept ${JSON.stringify(fine)}`).toBe(fine);
    }
  });

  it('accepts a normal same-origin relative returnPath', () => {
    const ok = encodeRedirectState({ returnPath: '/welcome?resume=setup', mode: 'create' });
    expect(decodeRedirectState(ok)?.returnPath).toBe('/welcome?resume=setup');
  });
});

describe('redirectState grant (P2)', () => {
  it('round-trips a calendar grant', () => {
    const encoded = encodeRedirectState({
      returnPath: '/settings',
      mode: 'reconnect',
      grant: 'calendar',
    });
    expect(decodeRedirectState(encoded)?.grant).toBe('calendar');
  });

  it("Drive is byte-identical whether grant is omitted or explicitly 'drive'", () => {
    const omitted = encodeRedirectState({ returnPath: '/welcome', mode: 'create' });
    const explicit = encodeRedirectState({
      returnPath: '/welcome',
      mode: 'create',
      grant: 'drive',
    });
    expect(explicit).toBe(omitted); // grant:'drive' is NOT written to the wire
  });

  it("a pre-P2 state (no grant field) decodes as 'drive'", () => {
    // Exactly what the pre-P2 build emitted: no `grant` key.
    const preP2 = btoa(
      JSON.stringify({ returnPath: '/welcome', mode: 'create', v: REDIRECT_STATE_VERSION })
    )
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    expect(decodeRedirectState(preP2)?.grant).toBe('drive');
  });

  it("an unknown/malformed grant value decodes as 'drive' (never throws)", () => {
    const weird = btoa(
      JSON.stringify({
        returnPath: '/x',
        mode: 'create',
        grant: 'dropbox',
        v: REDIRECT_STATE_VERSION,
      })
    )
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    expect(decodeRedirectState(weird)?.grant).toBe('drive');
  });
});
