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

import {
  redactContext,
  normalizeMessage,
  enrichAndRedact,
  getBuildVersionLabel,
  getProductVersionLabel,
  getFullVersionLabel,
  breadcrumbsForReport,
} from '../diagnosticContext';
import { APP_VERSION } from '@/constants/appVersion';

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

  describe('getBuildVersionLabel — welcome-gate build marker', () => {
    it('formats short SHA + date and matches the error-reporter Build prefix', () => {
      vi.stubEnv('VITE_BUILD_SHA', '41f5353fdeadbeef');
      vi.stubEnv('VITE_BUILD_TIME', '2026-06-19T09:33:00Z');
      const label = getBuildVersionLabel();
      expect(label).toMatch(/^41f5353 · /); // short SHA = first 7, matches Slack Build prefix
      expect(label).toContain('Jun 2026');
    });

    it('falls back to the short SHA alone when the build time is missing', () => {
      vi.stubEnv('VITE_BUILD_SHA', '41f5353fdeadbeef');
      vi.stubEnv('VITE_BUILD_TIME', '');
      expect(getBuildVersionLabel()).toBe('41f5353');
    });

    it('shows "dev" for a local build (Vite define yields "dev")', () => {
      // The vite.config define resolves `VITE_BUILD_SHA` to the literal 'dev'
      // for local builds (`process.env.VITE_BUILD_SHA || 'dev'`), so that's the
      // realistic local value — not an empty string.
      vi.stubEnv('VITE_BUILD_SHA', 'dev');
      vi.stubEnv('VITE_BUILD_TIME', '');
      expect(getBuildVersionLabel()).toBe('dev');
    });
  });

  describe('product version labels (sidebar + settings)', () => {
    it('getProductVersionLabel is the friendly "v<APP_VERSION>" (sidebar)', () => {
      expect(getProductVersionLabel()).toBe(`v${APP_VERSION}`);
    });

    it('getFullVersionLabel combines product version + build marker (settings)', () => {
      vi.stubEnv('VITE_BUILD_SHA', '41f5353fdeadbeef');
      vi.stubEnv('VITE_BUILD_TIME', '2026-06-19T09:33:00Z');
      const label = getFullVersionLabel();
      expect(label).toBe(`v${APP_VERSION} · 41f5353 · 19 Jun 2026`);
      // product version leads, build marker follows — the two answer different questions.
      expect(label.startsWith(`v${APP_VERSION} · `)).toBe(true);
    });
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

    // `errorReporter.handleReport` injects `severity` so the firehose can answer
    // "which events actually paged Slack?" (LogLevel has no 'critical'). It was
    // never allowlisted, so it was stripped from every report ever sent and the
    // stated intent was silently defeated. Regression guard.
    it('preserves severity so the firehose stays filterable', () => {
      expect(redactContext({ severity: 'critical' })).toEqual({ severity: 'critical' });
      expect(warnSpy).not.toHaveBeenCalled();
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

    it('includes family_name only when includeEmail is true (PII stays off the firehose)', async () => {
      const ctxMod = await import('@/stores/familyContextStore');
      // mockReturnValueOnce ×2 — self-cleaning, one read per enrichAndRedact call
      vi.mocked(ctxMod.useFamilyContextStore)
        .mockReturnValueOnce({ activeFamilyId: 'fam-uuid', activeFamilyName: 'Robinsons' } as never)
        .mockReturnValueOnce({
          activeFamilyId: 'fam-uuid',
          activeFamilyName: 'Robinsons',
        } as never);

      // Slack error path: user-typed family name (PII) is included alongside email
      const slackPath = enrichAndRedact({ surface: 's' }, { includeEmail: true });
      expect(slackPath.family_name).toBe('Robinsons');
      expect(slackPath.family_id).toBe('fam-uuid');

      // Telemetry firehose: family_name must NOT ship; only the random family_id correlates
      const firehose = enrichAndRedact({ surface: 's' }, { includeEmail: false });
      expect(firehose.family_name).toBeUndefined();
      expect(firehose.family_id).toBe('fam-uuid');
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

    it('attaches a flat web_storage signal that survives redaction', () => {
      const out = enrichAndRedact({ surface: 's' });
      expect(typeof out.web_storage).toBe('string');
      expect(out.web_storage).toMatch(/^ls=(true|false),ss=(true|false)$/);
    });
  });

  describe('breadcrumbsForReport — PII-safe, tail-preserving', () => {
    it('redacts email-shaped tokens (no raw address survives)', () => {
      const out = breadcrumbsForReport([
        'route: OAuthCallback',
        'auth: needsAuth=false, user=cssoff@test.com',
      ]);
      expect(out).not.toContain('cssoff@test.com');
      expect(out).toContain('<email>');
    });

    it('keeps the TAIL when the trail exceeds MAX_STRING_LEN (failure point survives)', () => {
      const crumbs = Array.from({ length: 60 }, (_, i) => `step-${i}-padding-padding`);
      crumbs.push('THE-FAILURE-POINT');
      const out = breadcrumbsForReport(crumbs);
      expect(out.length).toBeLessThanOrEqual(200);
      expect(out.startsWith('…')).toBe(true);
      expect(out).toContain('THE-FAILURE-POINT'); // last crumb retained, head dropped
    });

    it('returns an empty string for an empty trail', () => {
      expect(breadcrumbsForReport([])).toBe('');
    });

    it('output survives redactContext (allowlisted, not re-truncated at exactly 200)', () => {
      const crumbs = Array.from({ length: 60 }, (_, i) => `step-${i}-padding-padding`);
      const value = breadcrumbsForReport(crumbs);
      const redacted = redactContext({ breadcrumbs: value });
      expect(redacted.breadcrumbs).toBe(value);
    });
  });
});
