// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  generateInviteToken,
  createInvitePackage,
  redeemInviteToken,
  hashInviteToken,
  buildInviteLink,
  parseInviteLink,
  isInviteExpired,
} from '../inviteService';
import { generateFamilyKey, exportFamilyKey } from '../familyKeyService';

describe('inviteService', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Token generation ────────────────────────────────────────────

  describe('generateInviteToken', () => {
    it('returns a base64url string of ~43 chars', () => {
      const token = generateInviteToken();
      expect(typeof token).toBe('string');
      expect(token.length).toBe(43); // 32 bytes → 43 base64url chars (no padding)
    });

    it('produces URL-safe characters only', () => {
      const token = generateInviteToken();
      expect(token).not.toMatch(/[+/=]/);
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it('generates unique tokens', () => {
      const tokens = new Set(Array.from({ length: 20 }, () => generateInviteToken()));
      expect(tokens.size).toBe(20);
    });
  });

  // ── Create / redeem round-trip ──────────────────────────────────

  describe('createInvitePackage / redeemInviteToken', () => {
    it('round-trips the family key', async () => {
      const fk = await generateFamilyKey();
      const token = generateInviteToken();

      const pkg = await createInvitePackage(fk, token);
      expect(pkg.salt).toBeTruthy();
      expect(pkg.wrapped).toBeTruthy();
      expect(pkg.expiresAt).toBeTruthy();

      const recovered = await redeemInviteToken(pkg.wrapped, pkg.salt, token);
      const rawOriginal = await exportFamilyKey(fk);
      const rawRecovered = await exportFamilyKey(recovered);
      expect(rawRecovered).toEqual(rawOriginal);
    });

    it('rejects wrong token', async () => {
      const fk = await generateFamilyKey();
      const correctToken = generateInviteToken();
      const wrongToken = generateInviteToken();

      const pkg = await createInvitePackage(fk, correctToken);

      await expect(redeemInviteToken(pkg.wrapped, pkg.salt, wrongToken)).rejects.toThrow();
    });

    it('sets expiry 24h in the future', async () => {
      const fk = await generateFamilyKey();
      const token = generateInviteToken();

      const before = Date.now();
      const pkg = await createInvitePackage(fk, token);
      const after = Date.now();

      const expiryMs = new Date(pkg.expiresAt).getTime();
      const twentyFourHours = 24 * 60 * 60 * 1000;
      expect(expiryMs).toBeGreaterThanOrEqual(before + twentyFourHours);
      expect(expiryMs).toBeLessThanOrEqual(after + twentyFourHours);
    });
  });

  // ── Token hashing ──────────────────────────────────────────────

  describe('hashInviteToken', () => {
    it('produces deterministic output', async () => {
      const token = generateInviteToken();
      const hash1 = await hashInviteToken(token);
      const hash2 = await hashInviteToken(token);
      expect(hash1).toBe(hash2);
    });

    it('produces different hashes for different tokens', async () => {
      const hash1 = await hashInviteToken(generateInviteToken());
      const hash2 = await hashInviteToken(generateInviteToken());
      expect(hash1).not.toBe(hash2);
    });

    it('returns a base64url string', async () => {
      const hash = await hashInviteToken(generateInviteToken());
      expect(hash).toMatch(/^[A-Za-z0-9_-]+$/);
    });
  });

  // ── Link building / parsing ────────────────────────────────────

  describe('buildInviteLink', () => {
    it('includes token and familyId as query params', () => {
      const link = buildInviteLink({ token: 'my-token', familyId: 'family-123' });
      expect(link).toContain('t=my-token');
      expect(link).toContain('fam=family-123');
    });

    it('produces a non-hash-routed URL matching the production share format', () => {
      const link = buildInviteLink({ familyId: 'fam' });
      expect(link).toContain('/join?');
      expect(link).not.toContain('/#/');
    });

    it('omits absent optional params entirely', () => {
      const link = buildInviteLink({ familyId: 'fam' });
      expect(link).not.toContain('t=');
      expect(link).not.toContain('p=');
      expect(link).not.toContain('ref=');
      expect(link).not.toContain('fileId=');
      expect(link).not.toContain('hint=');
    });

    it('base64-encodes the invitee email into the hint param', () => {
      const link = buildInviteLink({ familyId: 'fam', inviteeEmail: 'wife@example.com' });
      const expected = btoa('wife@example.com'); // plain base64
      expect(link).toContain(`hint=${encodeURIComponent(expected)}`);
    });

    it('base64-encodes the file name into the ref param', () => {
      const link = buildInviteLink({ familyId: 'fam', fileName: 'family.beanpod' });
      const expected = btoa('family.beanpod');
      expect(link).toContain(`ref=${encodeURIComponent(expected)}`);
    });
  });

  describe('parseInviteLink', () => {
    it('round-trips every field through buildInviteLink → parseInviteLink', () => {
      const original = {
        token: 'tok-abc',
        familyId: 'family-123',
        provider: 'google_drive' as const,
        fileName: 'family.beanpod',
        fileId: '1AbCdEfGhIjK',
        inviteeEmail: 'wife@example.com',
      };
      const link = buildInviteLink(original);
      const parsed = parseInviteLink(link);
      expect(parsed).toEqual(original);
    });

    it('round-trips the minimum (familyId only)', () => {
      const link = buildInviteLink({ familyId: 'fam' });
      expect(parseInviteLink(link)).toEqual({ familyId: 'fam' });
    });

    it('returns null when the URL has no familyId', () => {
      expect(parseInviteLink('https://app.beanies.family/join?t=abc')).toBeNull();
    });

    it('returns null on malformed input', () => {
      expect(parseInviteLink('not a url')).toBeNull();
    });

    it('accepts legacy `f=` parameter (older invite format)', () => {
      const parsed = parseInviteLink('https://app.beanies.family/#/join?t=tok&f=family-legacy');
      expect(parsed).toEqual({ token: 'tok', familyId: 'family-legacy' });
    });

    it('accepts hash-routed URLs (older format)', () => {
      const parsed = parseInviteLink(
        'https://app.beanies.family/#/join?t=tok&fam=family-hash&p=google_drive'
      );
      expect(parsed?.familyId).toBe('family-hash');
      expect(parsed?.provider).toBe('google_drive');
    });

    it('returns inviteeEmail as undefined for legacy URLs without hint', () => {
      const parsed = parseInviteLink('https://app.beanies.family/join?fam=fam');
      expect(parsed?.inviteeEmail).toBeUndefined();
    });

    it('silently drops a malformed hint without throwing', () => {
      const parsed = parseInviteLink(
        'https://app.beanies.family/join?fam=fam&hint=!!!not-base64!!!'
      );
      expect(parsed).toEqual({ familyId: 'fam' });
    });

    it('silently drops a malformed ref without throwing', () => {
      const parsed = parseInviteLink(
        'https://app.beanies.family/join?fam=fam&ref=!!!not-base64!!!'
      );
      expect(parsed).toEqual({ familyId: 'fam' });
    });

    it('rejects an invalid provider value (treats as undefined)', () => {
      const parsed = parseInviteLink('https://app.beanies.family/join?fam=fam&p=other');
      expect(parsed?.provider).toBeUndefined();
    });
  });

  // ── Expiry check ───────────────────────────────────────────────

  describe('isInviteExpired', () => {
    it('returns false for future timestamp', () => {
      const future = new Date(Date.now() + 60_000).toISOString();
      expect(isInviteExpired(future)).toBe(false);
    });

    it('returns true for past timestamp', () => {
      const past = new Date(Date.now() - 60_000).toISOString();
      expect(isInviteExpired(past)).toBe(true);
    });

    it('returns true for exactly now', () => {
      vi.useFakeTimers();
      const now = new Date().toISOString();
      expect(isInviteExpired(now)).toBe(true);
      vi.useRealTimers();
    });
  });
});
