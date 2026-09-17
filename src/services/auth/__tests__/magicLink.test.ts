/**
 * Proofs 1, 3 and the ordered refusal checks for "your beanies magic link".
 *
 * These are not ordinary coverage. Revocation is the one behaviour in this feature that
 * can fail and still look fine — the entry is written, the UI says "done", and the old
 * link keeps working — so the plan made it a set of numbered proofs. Proof 2 (merge
 * propagation) lives in `envelopeMerge.test.ts` because it is a merge property; the
 * rest live here.
 */
import { describe, it, expect } from 'vitest';
import { generateFamilyKey, exportFamilyKey } from '@/services/crypto/familyKeyService';
import {
  mintMagicLinkPackage,
  refuseMagicLink,
  revokedMagicLinkPackage,
  unwrapMagicLink,
  buildMagicLinkUrl,
} from '@/services/auth/magicLink';
import { parseInviteLink } from '@/services/crypto/inviteService';

const KEY_ID = 'k1';

describe('mint → redeem round trip', () => {
  it('recovers the SAME family key', async () => {
    const fk = await generateFamilyKey();
    const { token, pkg } = await mintMagicLinkPackage(fk, KEY_ID);

    expect(await refuseMagicLink(pkg, token, KEY_ID)).toBeNull();
    const recovered = await unwrapMagicLink(pkg, token);
    expect(await exportFamilyKey(recovered)).toEqual(await exportFamilyKey(fk));
  });

  it('carries a 7-day expiry, not the invite default of 24h', async () => {
    const fk = await generateFamilyKey();
    const { pkg } = await mintMagicLinkPackage(fk, KEY_ID);
    const days = (Date.parse(pkg.expiresAt) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThan(7.1);
  });
});

describe('Proof 1 — minting again revokes the previous link', () => {
  it('the OLD token is refused with exactly link-revoked, and the new one works', async () => {
    const fk = await generateFamilyKey();
    const first = await mintMagicLinkPackage(fk, KEY_ID);
    const second = await mintMagicLinkPackage(fk, KEY_ID, first.pkg.createdAt);

    // Deterministic, not "one of two codes": with `tokenHash` the refusal is knowable
    // before any unwrap is attempted. An `or` in this assertion would be a test that
    // cannot fail for the right reason.
    expect(await refuseMagicLink(second.pkg, first.token, KEY_ID)).toBe('link-revoked');
    expect(await refuseMagicLink(second.pkg, second.token, KEY_ID)).toBeNull();
  });

  it('an explicit revoke leaves an entry nothing can unwrap', async () => {
    const fk = await generateFamilyKey();
    const { token, pkg } = await mintMagicLinkPackage(fk, KEY_ID);
    const dead = revokedMagicLinkPackage(KEY_ID, pkg.createdAt);

    expect(await refuseMagicLink(dead, token, KEY_ID)).toBe('link-revoked');
    // Replaced, never deleted: a deletion cannot propagate through the union merge, so
    // a peer would resurrect the live wrap on its next sync.
    expect(dead.wrapped).toBe('');
    expect(Date.parse(dead.createdAt)).toBeGreaterThan(Date.parse(pkg.createdAt));
  });
});

describe('Proof 3 — createdAt is monotonic', () => {
  it('a replacement beats an entry stamped an hour in the FUTURE', async () => {
    const fk = await generateFamilyKey();
    const future = new Date(Date.now() + 3_600_000).toISOString();
    const { pkg } = await mintMagicLinkPackage(fk, KEY_ID, future);

    // Without this, a device with a fast clock stamps a link that a later, legitimate
    // rotation on a correct clock LOSES to — a revoked link alive indefinitely.
    expect(Date.parse(pkg.createdAt)).toBeGreaterThan(Date.parse(future));
  });

  it('two mints in the same millisecond still order strictly', async () => {
    const fk = await generateFamilyKey();
    const a = await mintMagicLinkPackage(fk, KEY_ID);
    const b = await mintMagicLinkPackage(fk, KEY_ID, a.pkg.createdAt);
    expect(Date.parse(b.pkg.createdAt)).toBeGreaterThan(Date.parse(a.pkg.createdAt));
  });

  it('expiresAt is NOT dragged forward by a bumped createdAt', async () => {
    const fk = await generateFamilyKey();
    const future = new Date(Date.now() + 3_600_000).toISOString();
    const { pkg } = await mintMagicLinkPackage(fk, KEY_ID, future);
    // 7 days from the real clock, not from the inflated stamp.
    expect(Date.parse(pkg.expiresAt) - Date.now()).toBeLessThan(7.1 * 86_400_000);
  });
});

describe('the four refusal checks fire in order', () => {
  it('no entry → no-entry', async () => {
    expect(await refuseMagicLink(undefined, 'anything', KEY_ID)).toBe('no-entry');
  });

  it('expired → token-expired', async () => {
    const fk = await generateFamilyKey();
    const { token, pkg } = await mintMagicLinkPackage(fk, KEY_ID);
    const stale = { ...pkg, expiresAt: new Date(Date.now() - 1000).toISOString() };
    expect(await refuseMagicLink(stale, token, KEY_ID)).toBe('token-expired');
  });

  it('rotated key → key-rotated, distinct from expiry', async () => {
    const fk = await generateFamilyKey();
    const { token, pkg } = await mintMagicLinkPackage(fk, KEY_ID);
    expect(await refuseMagicLink(pkg, token, 'k2-rotated')).toBe('key-rotated');
  });

  it('BOTH revoked and expired reports link-revoked', async () => {
    // The ordering is a deliberate UX decision — "you created a newer link" is the true
    // and actionable cause; "it lapsed" is neither. A revoked package is also stamped
    // expired, so getting this backwards would mis-report every revocation.
    const fk = await generateFamilyKey();
    const { token, pkg } = await mintMagicLinkPackage(fk, KEY_ID);
    expect(
      await refuseMagicLink(revokedMagicLinkPackage(KEY_ID, pkg.createdAt), token, KEY_ID)
    ).toBe('link-revoked');
  });
});

describe('the URL', () => {
  it('round-trips ml=1 and the memberId, and carries the file locator', () => {
    const url = buildMagicLinkUrl({
      familyId: 'fam-1',
      memberId: 'mem-7',
      provider: 'google_drive',
      fileName: 'ours.beanpod',
      fileId: 'drive-9',
      token: 'tok',
    });
    const parsed = parseInviteLink(url);
    expect(parsed?.magicLink).toBe(true);
    expect(parsed?.memberId).toBe('mem-7');
    // The locator matters: a recovery kit gets you a key but not the FILE. One scan has
    // to do the whole journey.
    expect(parsed?.fileId).toBe('drive-9');
    expect(parsed?.fileName).toBe('ours.beanpod');
  });

  it('ml=1 with no m= parses as a magic link with NO memberId, so the caller can refuse it', () => {
    // Chat apps truncate long URLs, so a partially-copied link is expected input. It
    // must be distinguishable from a classic invite rather than silently falling through.
    const parsed = parseInviteLink('https://app.beanies.family/join?fam=f1&t=tok&ml=1');
    expect(parsed?.magicLink).toBe(true);
    expect(parsed?.memberId).toBeUndefined();
  });
});
