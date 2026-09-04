/**
 * The App Store version preflight.
 *
 * The bug it exists to prevent, in full: `derive-store-version.mjs` strips the `R<n>` suffix
 * (iOS `CFBundleShortVersionString` takes at most three integers), so `0.15R1`, `0.15R2` and
 * `0.15R3` are all "0.15" to Apple. A 0.15R3 release therefore built for five minutes and then
 * died at the upload step with "The version number has been previously used", which no retry
 * could fix.
 *
 * Two properties matter and both are tested here: it must CATCH a duplicate, and it must FAIL
 * OPEN on anything else — a preflight that blocks a good release when Apple has a wobble is
 * worse than the failure it prevents.
 */
import { describe, it, expect } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import fs from 'node:fs';
import { judge, fetchExistingVersions } from '../deploy/assert-store-version-unused.mjs';
// `buildToken` and `readBundleId` moved to the shared client when the second preflight
// (assert-no-pending-submission) needed the same auth. The assertions below are unchanged.
import { buildToken, readBundleId } from '../deploy/ascClient.mjs';

describe('judge — the decision', () => {
  it('passes a version App Store Connect has never seen', () => {
    const v = judge('0.15.1', ['0.13', '0.14', '0.15']);
    expect(v.ok).toBe(true);
  });

  it('CATCHES the exact failure that shipped: 0.15R3 collapsing onto a used 0.15', () => {
    // `0.15R3` reaches this as the derived `0.15`.
    const v = judge('0.15', ['0.13', '0.14', '0.15']);
    expect(v.ok).toBe(false);
  });

  it('names the R-suffix trap and the fix, not just the failure', () => {
    // The whole point is that the message replaces a Ruby backtrace. If it stops saying what
    // to do, the check has lost most of its value even while still exiting non-zero.
    const v = judge('0.15', ['0.15']);
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.message).toContain('ALREADY BEEN USED');
    expect(v.message).toContain('R-suffix trap');
    expect(v.message).toContain('appVersion.ts');
    expect(v.message).toContain('0.15.1');
    // And it lists what IS taken, so the next version is obvious.
    expect(v.message).toContain('0.15');
  });

  it('matches exactly — a version that is a PREFIX of a used one is fine', () => {
    // `0.1` must not be blocked by `0.15` existing.
    expect(judge('0.1', ['0.15', '0.15.1']).ok).toBe(true);
    expect(judge('0.15.1', ['0.15']).ok).toBe(true);
  });

  it('passes when the app has no versions at all', () => {
    expect(judge('1.0', []).ok).toBe(true);
  });

  it('ignores nulls and blanks in the API response rather than throwing', () => {
    // A malformed entry must not crash a preflight whose whole posture is fail-open.
    const v = judge('0.16', [null, undefined, '', '0.15']);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.existing).toEqual(['0.15']);
  });

  it('still catches a duplicate when the response also holds junk', () => {
    expect(judge('0.15', [null, '0.15', '']).ok).toBe(false);
  });
});

describe('buildToken — the shape App Store Connect requires', () => {
  // A real EC P-256 key: ES256 is the only algorithm Apple accepts, and signing with the
  // wrong curve is a silent 401 rather than a readable error.
  const { privateKey } = generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });

  const decode = (part) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));

  it('signs with ES256 and carries the key id in the header', () => {
    const [h] = buildToken({ keyId: 'ABC123', issuerId: 'issuer-1', privateKey }).split('.');
    expect(decode(h)).toMatchObject({ alg: 'ES256', kid: 'ABC123', typ: 'JWT' });
  });

  it('uses the appstoreconnect-v1 audience', () => {
    // Any other `aud` is rejected outright.
    const [, p] = buildToken({ keyId: 'k', issuerId: 'issuer-1', privateKey }).split('.');
    expect(decode(p).aud).toBe('appstoreconnect-v1');
    expect(decode(p).iss).toBe('issuer-1');
  });

  it('expires within Apple’s 20-minute maximum', () => {
    // Apple rejects a token whose lifetime exceeds 20 minutes.
    const now = 1_700_000_000;
    const [, p] = buildToken({ keyId: 'k', issuerId: 'i', privateKey, now }).split('.');
    const { iat, exp } = decode(p);
    expect(iat).toBe(now);
    expect(exp - iat).toBeLessThanOrEqual(20 * 60);
    expect(exp - iat).toBeGreaterThan(0);
  });

  it('produces a three-part JWT with a raw (P1363) signature, not DER', () => {
    // `createSign` defaults to DER, which Apple rejects. The `dsaEncoding: 'ieee-p1363'`
    // option is what makes this a valid ES256 signature — a 64-byte r||s pair.
    const parts = buildToken({ keyId: 'k', issuerId: 'i', privateKey }).split('.');
    expect(parts).toHaveLength(3);
    expect(Buffer.from(parts[2], 'base64url')).toHaveLength(64);
  });
});

describe('fetchExistingVersions — the two-hop lookup', () => {
  /** A fetch stub that answers by URL and records what it was asked. */
  const stub = (routes) => {
    const seen = [];
    const impl = async (url, init) => {
      seen.push({ url, auth: init?.headers?.Authorization });
      const hit = Object.entries(routes).find(([frag]) => url.includes(frag));
      if (!hit) throw new Error(`unstubbed url: ${url}`);
      return hit[1];
    };
    impl.seen = seen;
    return impl;
  };
  const json = (body) => ({ ok: true, json: async () => body });

  const APP = json({ data: [{ id: 'app-123' }] });
  const VERSIONS = json({
    data: [{ attributes: { versionString: '0.14' } }, { attributes: { versionString: '0.15' } }],
  });

  it('resolves the app id from the bundle id, then reads that app’s versions', async () => {
    const fetchImpl = stub({ '/v1/apps?': APP, '/appStoreVersions': VERSIONS });
    const out = await fetchExistingVersions({
      bundleId: 'family.beanies.app',
      token: 'tok',
      fetchImpl,
    });

    expect(out).toEqual(['0.14', '0.15']);
    // The versions call must be scoped to the resolved app — asking for the wrong app's
    // versions is the one way this returns a confident, wrong answer.
    expect(fetchImpl.seen[1].url).toContain('/v1/apps/app-123/appStoreVersions');
  });

  it('sends the bearer token on both hops', async () => {
    // A missing token on either hop is a 401, which fails OPEN and silently protects nothing.
    const fetchImpl = stub({ '/v1/apps?': APP, '/appStoreVersions': VERSIONS });
    await fetchExistingVersions({ bundleId: 'b', token: 'tok', fetchImpl });
    expect(fetchImpl.seen.map((c) => c.auth)).toEqual(['Bearer tok', 'Bearer tok']);
  });

  it('url-encodes the bundle id VALUE, leaving the filter[...] brackets literal', async () => {
    // ASC's own filter syntax uses literal brackets; only the value may be escaped.
    const fetchImpl = stub({ '/v1/apps?': APP, '/appStoreVersions': VERSIONS });
    await fetchExistingVersions({ bundleId: 'a b', token: 't', fetchImpl });
    expect(fetchImpl.seen[0].url).toContain('filter[bundleId]=a%20b');
  });

  it('throws (→ fail open) on a non-OK apps lookup', async () => {
    const fetchImpl = stub({ '/v1/apps?': { ok: false, status: 401 } });
    await expect(fetchExistingVersions({ bundleId: 'b', token: 't', fetchImpl })).rejects.toThrow(
      '401'
    );
  });

  it('throws (→ fail open) on a non-OK versions lookup', async () => {
    const fetchImpl = stub({ '/v1/apps?': APP, '/appStoreVersions': { ok: false, status: 500 } });
    await expect(fetchExistingVersions({ bundleId: 'b', token: 't', fetchImpl })).rejects.toThrow(
      '500'
    );
  });

  it('throws rather than guessing when no app matches the bundle id', async () => {
    // An empty `data` here means the bundle id is wrong. Returning [] would read as "no
    // versions used" and wave every duplicate straight through.
    const fetchImpl = stub({ '/v1/apps?': json({ data: [] }) });
    await expect(
      fetchExistingVersions({ bundleId: 'wrong.id', token: 't', fetchImpl })
    ).rejects.toThrow('wrong.id');
  });

  it('tolerates a version entry with no attributes', async () => {
    const fetchImpl = stub({
      '/v1/apps?': APP,
      '/appStoreVersions': json({
        data: [{}, { attributes: {} }, { attributes: { versionString: '0.15' } }],
      }),
    });
    expect(await fetchExistingVersions({ bundleId: 'b', token: 't', fetchImpl })).toEqual(['0.15']);
  });
});

describe('readBundleId — one source of truth for the bundle id', () => {
  it('reads the id the REAL capacitor.config.ts declares', () => {
    // Not a fixture: the whole point is that this tracks the live config, so a rename there
    // cannot leave a stale literal that makes the apps lookup silently find no app.
    // Repo-root relative: vitest rewrites `import.meta.url` to a non-file scheme, so the
    // `new URL(..., import.meta.url)` form the script itself uses cannot be used here.
    const source = fs.readFileSync('capacitor.config.ts', 'utf8');
    expect(readBundleId(source)).toBe('family.beanies.app');
  });

  it('handles either quote style', () => {
    expect(readBundleId(`{ appId: "com.example.app", appName: 'x' }`)).toBe('com.example.app');
  });

  it('throws rather than returning a wrong id when appId is gone', () => {
    // Throwing takes the fail-open path with a named reason in the log; returning undefined
    // would query for "undefined", find no app, and fail open with a confusing message.
    expect(() => readBundleId('export default { appName: "beanies" }')).toThrow('appId');
  });
});
