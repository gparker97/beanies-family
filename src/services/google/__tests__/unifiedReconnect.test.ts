import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mocks -------------------------------------------------------------------

vi.mock('@/services/google/googleAuth', () => ({
  DRIVE_SCOPES:
    'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email',
  requestAccessToken: vi.fn(async () => 'access-token'),
  shouldUseRedirectAuth: vi.fn(() => false),
  startRedirectAuth: vi.fn(async () => {
    /* would navigate the page in a real browser */
  }),
  ensureVerifiedGoogleAccountEmail: vi.fn(async () => 'greg@example.com'),
}));

vi.mock('@/services/calendar/calendarAuth', () => ({
  CALENDAR_SCOPES: [
    'https://www.googleapis.com/auth/calendar.events.owned',
    'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
    'https://www.googleapis.com/auth/userinfo.email',
  ],
}));

vi.mock('@/services/sync/fileHandleStore', () => ({
  getGoogleRefreshToken: vi.fn(async () => ({ token: 'refresh-token', issuedAt: 1 })),
}));

vi.mock('@/services/indexeddb/database', () => ({
  getActiveFamilyId: vi.fn(() => 'family-1'),
}));

const applyUnifiedRefreshToken = vi.fn(async () => ({ matched: 1, restored: 1, failed: 0 }));
vi.mock('@/stores/calendarSyncStore', () => ({
  useCalendarSyncStore: () => ({ applyUnifiedRefreshToken }),
}));

vi.mock('@/services/telemetry', () => ({ logEvent: vi.fn() }));
vi.mock('@/utils/errorReporter', () => ({ reportError: vi.fn() }));

import {
  UNIFIED_SCOPES,
  startUnifiedReconnect,
  fanOutCalendarAfterUnifiedConsent,
} from '../unifiedReconnect';

describe('unifiedReconnect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('UNIFIED_SCOPES', () => {
    it('is the deduped union of Drive + Calendar scopes (userinfo.email once)', () => {
      const parts = UNIFIED_SCOPES.split(' ');
      expect(parts).toContain('https://www.googleapis.com/auth/drive.file');
      expect(parts).toContain('https://www.googleapis.com/auth/calendar.events.owned');
      expect(parts).toContain('https://www.googleapis.com/auth/calendar.calendarlist.readonly');
      // userinfo.email is in BOTH sets — must appear exactly once.
      expect(parts.filter((s) => s.endsWith('userinfo.email'))).toHaveLength(1);
    });
  });

  describe('startUnifiedReconnect', () => {
    it('desktop: one popup consent for the union, then fans out; returns connected', async () => {
      const { requestAccessToken, startRedirectAuth } =
        await import('@/services/google/googleAuth');

      const outcome = await startUnifiedReconnect('greg@example.com');

      expect(outcome).toBe('connected');
      expect(requestAccessToken).toHaveBeenCalledWith({
        forceConsent: true,
        loginHint: 'greg@example.com',
        scope: UNIFIED_SCOPES,
      });
      expect(startRedirectAuth).not.toHaveBeenCalled();
      expect(applyUnifiedRefreshToken).toHaveBeenCalledWith({
        refreshToken: 'refresh-token',
        grantedScopes: expect.arrayContaining([
          'https://www.googleapis.com/auth/calendar.events.owned',
        ]),
        email: 'greg@example.com',
      });
    });

    it('redirect surface: hands off to startRedirectAuth with the union scope; returns redirecting', async () => {
      const { shouldUseRedirectAuth, startRedirectAuth, requestAccessToken } =
        await import('@/services/google/googleAuth');
      (shouldUseRedirectAuth as ReturnType<typeof vi.fn>).mockReturnValueOnce(true);

      const outcome = await startUnifiedReconnect('greg@example.com');

      expect(outcome).toBe('redirecting');
      expect(startRedirectAuth).toHaveBeenCalledWith(
        expect.stringContaining('unifiedResume=1'),
        'greg@example.com',
        'reconnect',
        { scope: UNIFIED_SCOPES }
      );
      expect(requestAccessToken).not.toHaveBeenCalled();
      // No inline fan-out on the redirect path (the resume handles it post-redirect).
      expect(applyUnifiedRefreshToken).not.toHaveBeenCalled();
    });

    it('returns failed and does not fan out when the consent throws', async () => {
      const { requestAccessToken } = await import('@/services/google/googleAuth');
      (requestAccessToken as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('nope'));

      const outcome = await startUnifiedReconnect('greg@example.com');

      expect(outcome).toBe('failed');
      expect(applyUnifiedRefreshToken).not.toHaveBeenCalled();
    });
  });

  describe('fanOutCalendarAfterUnifiedConsent', () => {
    it('skips (no store write) when there is no family loaded', async () => {
      const { getActiveFamilyId } = await import('@/services/indexeddb/database');
      (getActiveFamilyId as ReturnType<typeof vi.fn>).mockReturnValueOnce(null);

      await fanOutCalendarAfterUnifiedConsent();
      expect(applyUnifiedRefreshToken).not.toHaveBeenCalled();
    });

    it('skips when Drive did NOT commit a token (partial honesty — keeps calendar down)', async () => {
      const { getGoogleRefreshToken } = await import('@/services/sync/fileHandleStore');
      (getGoogleRefreshToken as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

      await fanOutCalendarAfterUnifiedConsent();
      expect(applyUnifiedRefreshToken).not.toHaveBeenCalled();
    });

    it('skips when no verified account email is available', async () => {
      const { ensureVerifiedGoogleAccountEmail } = await import('@/services/google/googleAuth');
      (ensureVerifiedGoogleAccountEmail as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

      await fanOutCalendarAfterUnifiedConsent();
      expect(applyUnifiedRefreshToken).not.toHaveBeenCalled();
    });

    it('applies the committed token to the verified account when both are present', async () => {
      await fanOutCalendarAfterUnifiedConsent();
      expect(applyUnifiedRefreshToken).toHaveBeenCalledWith({
        refreshToken: 'refresh-token',
        grantedScopes: expect.any(Array),
        email: 'greg@example.com',
      });
    });
  });
});
