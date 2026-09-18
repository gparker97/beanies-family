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

  /**
   * ⚠️ UPDATED 2026-09-18 (#98), DELIBERATELY. This used to assert that `v: 2` was rejected, back
   * when 1 was the only accepted version. Picker states are now encoded at 2 as a capability gate
   * (see the picker describe block below), so 2 is accepted by design and 3 is the first unknown.
   * The gate itself is unchanged: an unrecognised version still decodes to `null` rather than
   * being best-effort parsed.
   */
  it('rejects an unknown / future version (accept-set gate)', () => {
    const future = btoa(JSON.stringify({ returnPath: '/x', mode: 'create', v: 3 }))
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

/**
 * ⚠️ THE `v: 2` GATE IS A CAPABILITY GATE, NOT A SCHEMA VERSION, and these tests are what stop it
 * being "simplified" back to one version.
 *
 * `v` is an exact-match check in code that has ALREADY SHIPPED. Encoding picker states at 2 is the
 * only lever we have over a stale service-worker-cached build: it decodes an unknown version as
 * `null` and routes to the reported "state lost" path, instead of defaulting the unrecognised
 * grant to `'drive'` and handing a `drive.file`-only code to the path that commits it over the
 * app's main Drive token, silently stripping `userinfo.email`.
 */
describe('redirectState — the picker grant and the version gate', () => {
  const b64 = (o: unknown): string =>
    btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const raw = (encoded: string): Record<string, unknown> =>
    JSON.parse(atob(encoded.replace(/-/g, '+').replace(/_/g, '/'))) as Record<string, unknown>;

  it("round-trips grant: 'picker', and encodes it at v: 2", () => {
    const encoded = encodeRedirectState({
      returnPath: '/join?fam=1',
      mode: 'join',
      grant: 'picker',
    });
    expect(raw(encoded)).toMatchObject({ grant: 'picker', v: 2 });
    expect(decodeRedirectState(encoded)).toEqual({
      returnPath: '/join?fam=1',
      mode: 'join',
      grant: 'picker',
      v: 2,
    });
  });

  /**
   * ⚠️ `decode` used to return a HARDCODED `REDIRECT_STATE_VERSION`. Under an accept-set that
   * reports v1 for a v2 payload: a lie waiting for the first caller that trusts it.
   */
  it('reports the version it actually read, not the constant', () => {
    const picker = encodeRedirectState({ returnPath: '/x', mode: 'join', grant: 'picker' });
    const drive = encodeRedirectState({ returnPath: '/x', mode: 'join' });
    expect(decodeRedirectState(picker)?.v).toBe(2);
    expect(decodeRedirectState(drive)?.v).toBe(1);
  });

  /** The existing contract: a Drive state must stay byte-identical, so in-flight auths survive. */
  it('leaves drive and calendar states at v: 1, with drive omitting the grant entirely', () => {
    const drive = raw(encodeRedirectState({ returnPath: '/x', mode: 'create' }));
    expect(drive).toEqual({ returnPath: '/x', mode: 'create', v: 1 });
    expect(drive).not.toHaveProperty('grant');

    const calendar = raw(
      encodeRedirectState({ returnPath: '/x', mode: 'reconnect', grant: 'calendar' })
    );
    expect(calendar).toMatchObject({ grant: 'calendar', v: 1 });
  });

  /**
   * The forward-compat contract, from the module's own header: an unknown version decodes to
   * `null` rather than being best-effort parsed. This is the half that protects an OLD build, and
   * it is asserted here from the perspective of a build that only accepts {1}.
   */
  it('a build that does not know v: 2 refuses the payload instead of misreading the grant', () => {
    const v2 = b64({ returnPath: '/x', mode: 'join', grant: 'picker', v: 2 });
    // Simulate the shipped v1-only decoder: exact-match on 1.
    const v1OnlyDecode = (s: string): unknown => {
      const obj = JSON.parse(atob(s.replace(/-/g, '+').replace(/_/g, '/'))) as { v: number };
      return obj.v !== 1 ? null : obj;
    };
    expect(v1OnlyDecode(v2)).toBeNull();
    // And a future v: 3 is refused by THIS build, for the same reason.
    expect(decodeRedirectState(b64({ returnPath: '/x', mode: 'join', v: 3 }))).toBeNull();
  });

  it("still defaults an unrecognised grant to 'drive' at v: 1", () => {
    expect(
      decodeRedirectState(b64({ returnPath: '/x', mode: 'join', grant: 'onedrive', v: 1 }))?.grant
    ).toBe('drive');
  });
});
