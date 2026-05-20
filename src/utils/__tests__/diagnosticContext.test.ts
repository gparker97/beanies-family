import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Stores are mocked so `enrichAndRedact`'s top-level store imports resolve.
// Each store read is independently try/caught, so missing/throwing stores
// just produce a less-rich (but still valid) context.
vi.mock('@/stores/familyStore', () => ({
  useFamilyStore: vi.fn(() => ({ members: [] })),
}));
vi.mock('@/stores/familyContextStore', () => ({
  useFamilyContextStore: vi.fn(() => ({ activeFamilyId: null, activeFamilyName: null })),
}));
vi.mock('@/stores/syncStore', () => ({
  useSyncStore: vi.fn(() => ({
    storageProviderType: null,
    saveFailureLevel: 'none',
    driveFileNotFound: false,
  })),
}));

import { redactContext, normalizeMessage, enrichAndRedact } from '../diagnosticContext';

describe('diagnosticContext', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubEnv('VITE_BUILD_SHA', 'test-sha');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  describe('redactContext — privacy contract', () => {
    it('drops disallowed keys and warns', () => {
      const result = redactContext({
        memberName: 'Alice',
        activityTitle: 'Soccer',
        transactionAmount: 100,
        family_id: 'fam_123',
      });
      expect(result).toEqual({ family_id: 'fam_123' });
      expect(warnSpy).toHaveBeenCalledWith(
        '[diagnosticContext] dropped non-allowlisted context key:',
        'memberName'
      );
    });

    it('preserves email as the only PII', () => {
      const result = redactContext({
        family_email: 'greg@example.com',
        family_name: 'Robinsons',
        family_id: 'fam_123',
      });
      expect(result).toEqual({
        family_email: 'greg@example.com',
        family_name: 'Robinsons',
        family_id: 'fam_123',
      });
    });

    it('truncates string values longer than 200 chars', () => {
      const long = 'x'.repeat(500);
      const result = redactContext({ family_name: long });
      expect((result.family_name as string).length).toBe(201); // 200 + ellipsis
      expect((result.family_name as string).endsWith('…')).toBe(true);
    });

    it('enforces last-4-chars on _tail fields', () => {
      const result = redactContext({
        file_id_tail: 'abcdefghijklmn',
        invite_token_tail: 'ZYXWVUTSR',
      });
      expect(result.file_id_tail).toBe('…klmn');
      expect(result.invite_token_tail).toBe('…UTSR');
    });
  });

  describe('normalizeMessage — collapse nearly-identical errors', () => {
    it('replaces UUIDs', () => {
      expect(normalizeMessage('Failed to load 1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d')).toBe(
        'Failed to load <uuid>'
      );
    });

    it('replaces ISO timestamps', () => {
      expect(normalizeMessage('saved at 2026-04-27T14:42:18.123Z')).toBe('saved at <ts>');
      expect(normalizeMessage('saved at 2026-04-27T14:42:18Z')).toBe('saved at <ts>');
    });

    it('replaces 6+ digit numeric IDs', () => {
      expect(normalizeMessage('record 123456 not found')).toBe('record <id> not found');
    });

    it('replaces 8+ char hex strings', () => {
      expect(normalizeMessage('hash abc123def456 mismatch')).toBe('hash <hex> mismatch');
    });

    it('preserves non-id content', () => {
      expect(normalizeMessage('Could not save activity')).toBe('Could not save activity');
    });
  });

  describe('enrichAndRedact — includeEmail gating', () => {
    it('includes family_email only when includeEmail is true', async () => {
      const famMod = await import('@/stores/familyStore');
      vi.mocked(famMod.useFamilyStore).mockReturnValue({
        members: [{ role: 'owner', email: 'owner@example.com' }],
      } as never);

      const withEmail = enrichAndRedact({ surface: 's' }, { includeEmail: true });
      expect(withEmail.family_email).toBe('owner@example.com');

      const withoutEmail = enrichAndRedact({ surface: 's' }, { includeEmail: false });
      expect(withoutEmail.family_email).toBeUndefined();
    });

    it('always stamps build_sha and merges caller context (allowlisted only)', () => {
      const ctx = enrichAndRedact({
        surface: 's',
        context: { action: 'retry', memberName: 'leaked' },
      });
      expect(ctx.build_sha).toBe('test-sha');
      expect(ctx.action).toBe('retry');
      expect(ctx.memberName).toBeUndefined(); // dropped by the allowlist
    });

    it('never throws when a store read fails', async () => {
      const ctxMod = await import('@/stores/familyContextStore');
      vi.mocked(ctxMod.useFamilyContextStore).mockImplementationOnce(() => {
        throw new Error('pinia not ready');
      });
      expect(() => enrichAndRedact({ surface: 's' })).not.toThrow();
    });
  });
});
