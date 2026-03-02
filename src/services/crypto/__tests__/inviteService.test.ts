// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  generateInviteToken,
  createInvitePackage,
  redeemInviteToken,
  hashInviteToken,
  buildInviteLink,
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

  // ── Link building ──────────────────────────────────────────────

  describe('buildInviteLink', () => {
    it('includes token and familyId as query params', () => {
      const link = buildInviteLink('my-token', 'family-123');
      expect(link).toContain('t=my-token');
      expect(link).toContain('f=family-123');
    });

    it('uses hash-based routing', () => {
      const link = buildInviteLink('tok', 'fam');
      expect(link).toContain('#/join');
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
