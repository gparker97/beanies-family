import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import OAuthCallbackPage from '../OAuthCallbackPage.vue';
import { encodeRedirectState } from '@/services/google/redirectState';

// P2 — the web callback bounce routes the one-time code to the GRANT'S OWN
// sessionStorage key: a Drive redirect → the Drive key, a calendar redirect →
// the calendar key. This is the structural half of "the two code keys can never
// co-populate" (the other half: only one grant's code is ever in flight).

const DRIVE_CODE_KEY = 'beanies_redirect_auth_code';
const CALENDAR_CODE_KEY = 'beanies_redirect_auth_code:calendar';

vi.mock('@/services/google/googleAuth', () => ({
  REDIRECT_AUTH_CODE_KEY: 'beanies_redirect_auth_code',
}));
vi.mock('@/services/calendar/calendarAuth', () => ({
  CALENDAR_REDIRECT_CODE_KEY: 'beanies_redirect_auth_code:calendar',
}));
vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock('@/utils/errorReporter', () => ({ reportError: vi.fn() }));

let hrefTarget = '';
const realLocation = window.location;

function stubLocation(search: string): void {
  hrefTarget = '';
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      search,
      origin: 'https://app.beanies.family',
      set href(v: string) {
        hrefTarget = v;
      },
      get href() {
        return hrefTarget;
      },
    },
  });
}

describe('OAuthCallbackPage — grant-namespaced bounce (P2)', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });
  afterEach(() => {
    Object.defineProperty(window, 'location', { configurable: true, value: realLocation });
  });

  it('routes a CALENDAR redirect code to the calendar key and bounces to its returnPath', () => {
    const state = encodeRedirectState({
      returnPath: '/settings?open=calendar-sync&calResume=connect',
      mode: 'create',
      grant: 'calendar',
    });
    stubLocation(`?code=CAL_CODE&state=${encodeURIComponent(state)}`);

    mount(OAuthCallbackPage);

    expect(sessionStorage.getItem(CALENDAR_CODE_KEY)).toBe('CAL_CODE');
    expect(sessionStorage.getItem(DRIVE_CODE_KEY)).toBeNull();
    expect(hrefTarget).toBe('/settings?open=calendar-sync&calResume=connect');
  });

  it('routes a DRIVE redirect code to the Drive key (grant omitted → drive)', () => {
    const state = encodeRedirectState({ returnPath: '/welcome?resume=setup', mode: 'create' });
    stubLocation(`?code=DRIVE_CODE&state=${encodeURIComponent(state)}`);

    mount(OAuthCallbackPage);

    expect(sessionStorage.getItem(DRIVE_CODE_KEY)).toBe('DRIVE_CODE');
    expect(sessionStorage.getItem(CALENDAR_CODE_KEY)).toBeNull();
    expect(hrefTarget).toBe('/welcome?resume=setup');
  });
});

/**
 * #98 — the PICKER grant's web return leg (the other half of the native coverage in
 * `googleAuth.pickerGrant.native.test.ts`).
 *
 * The acceptance criterion this pins: a picker redirect can NEVER commit a `drive.file`-only
 * token. On this path that means the code must never reach `REDIRECT_AUTH_CODE_KEY`, because
 * `completeRedirectAuth` would exchange whatever it finds there and commit it over the app's main
 * Drive token, silently stripping `userinfo.email`.
 *
 * It also pins the two navigation outcomes the ladder below would otherwise get wrong: a cancel
 * (no code, no error) would fall through to `window.location.href = '/'`, DISCARDING the invite
 * URL, and a decline would append `?authError=` and render as a sign-in failure.
 */
describe('OAuthCallbackPage — the picker grant (#98)', () => {
  const PICKER_KEY = 'beanies_redirect_auth_code:picker';
  const RETURN = '/join?fam=abc&fid=xyz';
  const pickerState = (): string =>
    encodeRedirectState({ returnPath: RETURN, mode: 'join', grant: 'picker' });

  beforeEach(() => {
    sessionStorage.clear();
  });
  afterEach(() => {
    Object.defineProperty(window, 'location', { configurable: true, value: realLocation });
  });

  it('parks the selection and NEVER writes the Drive code key, even when a code is present', () => {
    stubLocation(`?state=${pickerState()}&code=SCOPE_LIMITED&picked_file_ids=FILE_A`);
    mount(OAuthCallbackPage);

    expect(JSON.parse(sessionStorage.getItem(PICKER_KEY)!)).toMatchObject({ ids: 'FILE_A' });
    // ⚠️ THE INVARIANT. A code here is scope-limited to drive.file.
    expect(sessionStorage.getItem(DRIVE_CODE_KEY)).toBeNull();
    expect(sessionStorage.getItem(CALENDAR_CODE_KEY)).toBeNull();
    expect(hrefTarget).toBe(RETURN);
  });

  it('a cancel returns to the invite URL, never to /', () => {
    stubLocation(`?state=${pickerState()}`);
    mount(OAuthCallbackPage);

    expect(hrefTarget).toBe(RETURN);
    expect(hrefTarget).not.toBe('/');
    expect(JSON.parse(sessionStorage.getItem(PICKER_KEY)!)).toMatchObject({ ids: '' });
  });

  it('a decline returns to the invite URL WITHOUT an authError (it is not a sign-in failure)', () => {
    stubLocation(`?state=${pickerState()}&error=access_denied`);
    mount(OAuthCallbackPage);

    expect(hrefTarget).toBe(RETURN);
    expect(hrefTarget).not.toContain('authError');
  });

  it('still navigates to the invite URL when the stash write fails, and reports it', async () => {
    const spy = vi.spyOn(sessionStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });
    stubLocation(`?state=${pickerState()}&picked_file_ids=FILE_A`);
    mount(OAuthCallbackPage);

    const { reportError } = await import('@/utils/errorReporter');
    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'critical', surface: 'oauth.redirectStateLost' })
    );
    // The user is still put back where they came from rather than dumped on '/'.
    expect(hrefTarget).toBe(RETURN);
    spy.mockRestore();
  });
});
