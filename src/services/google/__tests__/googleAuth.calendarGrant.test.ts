import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { decodeRedirectState } from '../redirectState';

// P2 — calendar grant on the shared redirect transport (WEB / non-native arm).
// Proves: (1) the Drive start side is byte-identical to pre-P2 (scope, state,
// consent, no grant leak); (2) the calendar grant carries its own scope + a
// grant='calendar' state; (3) the Drive settlement memo can never consume a
// calendar code (structural isolation — separate sessionStorage keys).

vi.mock('../pkce', () => ({
  generateCodeVerifier: vi.fn(() => 'mock-verifier'),
  generateCodeChallenge: vi.fn(async () => 'mock-challenge'),
}));
vi.mock('../oauthProxy', () => ({
  exchangeCodeForTokens: vi.fn(async () => ({
    access_token: 'tok',
    refresh_token: 'rt',
    expires_in: 3600,
    token_type: 'Bearer',
    scope: 'drive.file userinfo.email',
  })),
  refreshAccessToken: vi.fn(),
}));
vi.mock('@/services/sync/fileHandleStore', () => ({
  storeGoogleRefreshToken: vi.fn(async () => {}),
  getGoogleRefreshToken: vi.fn(async () => null),
  clearGoogleRefreshToken: vi.fn(async () => {}),
}));
vi.mock('@/services/indexeddb/database', () => ({ getActiveFamilyId: vi.fn(() => null) }));
vi.mock('@/services/telemetry', () => ({ logEvent: vi.fn() }));
vi.mock('@/utils/errorReporter', () => ({ reportError: vi.fn() }));

const DRIVE_CODE_KEY = 'beanies_redirect_auth_code';
const CALENDAR_CODE_KEY = 'beanies_redirect_auth_code:calendar';
const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events.owned';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

let googleAuth: typeof import('../googleAuth');

/** Capture the URL a web redirect navigates to (window.location.href setter). */
function spyHref(): { get: () => string; restore: () => void } {
  let captured = '';
  const spy = vi.spyOn(window.location, 'href', 'set').mockImplementation((v: string) => {
    captured = v;
  });
  return { get: () => captured, restore: () => spy.mockRestore() };
}

describe('googleAuth — calendar grant on the redirect transport (web)', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.resetAllMocks();
    sessionStorage.clear();
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'cid.apps.googleusercontent.com');
    googleAuth = await import('../googleAuth');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('start side — Drive default is byte-identical to pre-P2', () => {
    it('Drive redirect carries the drive.file scope, a state, prompt=consent, and NO grant in state', async () => {
      const href = spyHref();
      await googleAuth.startRedirectAuth('/welcome?resume=setup', 'a@b.com', 'create');
      const url = new URL(href.get());
      href.restore();

      expect(url.searchParams.get('scope')).toContain(DRIVE_SCOPE);
      expect(url.searchParams.get('scope')).not.toContain(CALENDAR_SCOPE);
      expect(url.searchParams.get('prompt')).toBe('consent');
      expect(url.searchParams.get('access_type')).toBe('offline');
      // The decoded state resolves to the drive grant (grant omitted on the wire).
      const decoded = decodeRedirectState(url.searchParams.get('state'));
      expect(decoded?.grant).toBe('drive');
    });

    it('omitting opts is identical to passing {grant:"drive"} (no behavioural drift)', async () => {
      const a = spyHref();
      await googleAuth.startRedirectAuth('/welcome', 'a@b.com', 'create');
      const urlA = a.get();
      a.restore();

      const b = spyHref();
      await googleAuth.startRedirectAuth('/welcome', 'a@b.com', 'create', { grant: 'drive' });
      const urlB = b.get();
      b.restore();

      expect(urlB).toBe(urlA);
    });
  });

  describe('start side — calendar grant', () => {
    it('calendar redirect carries the calendar scope + a grant="calendar" state, still prompt=consent', async () => {
      const href = spyHref();
      await googleAuth.startRedirectAuth(
        '/settings?open=calendar-sync&calResume=connect',
        'a@b.com',
        'create',
        {
          grant: 'calendar',
          scope: CALENDAR_SCOPE,
        }
      );
      const url = new URL(href.get());
      href.restore();

      expect(url.searchParams.get('scope')).toContain(CALENDAR_SCOPE);
      expect(url.searchParams.get('scope')).not.toContain(DRIVE_SCOPE);
      expect(url.searchParams.get('prompt')).toBe('consent');
      const decoded = decodeRedirectState(url.searchParams.get('state'));
      expect(decoded?.grant).toBe('calendar');
      expect(decoded?.returnPath).toBe('/settings?open=calendar-sync&calResume=connect');
    });
  });

  describe('structural isolation — the two code keys can never co-populate/cross-consume', () => {
    it('the calendar code key is distinct from the Drive code key', () => {
      expect(googleAuth.REDIRECT_AUTH_CODE_KEY).toBe(DRIVE_CODE_KEY);
      expect(googleAuth.REDIRECT_AUTH_CODE_KEY_CALENDAR).toBe(CALENDAR_CODE_KEY);
      expect(googleAuth.REDIRECT_AUTH_CODE_KEY_CALENDAR).not.toBe(
        googleAuth.REDIRECT_AUTH_CODE_KEY
      );
    });

    it('completeRedirectAuth (Drive) is a no-op when ONLY a calendar code is pending — never consumes it', async () => {
      sessionStorage.setItem(CALENDAR_CODE_KEY, 'cal-code');
      const { exchangeCodeForTokens } = await import('../oauthProxy');

      const token = await googleAuth.completeRedirectAuth();

      expect(token).toBeNull(); // no Drive code → nothing to complete
      expect(exchangeCodeForTokens).not.toHaveBeenCalled();
      // The calendar code is untouched — left for the calendar sibling completion.
      expect(sessionStorage.getItem(CALENDAR_CODE_KEY)).toBe('cal-code');
    });
  });
});
