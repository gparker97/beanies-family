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
const mockTrackOnboardingStep = vi.fn();
vi.mock('@/services/telemetry/onboardingAttempt', () => ({
  trackOnboardingStep: (...args: unknown[]) => mockTrackOnboardingStep(...args),
}));

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

/**
 * #128 — the create flow's web Drive-consent exits. The page that started the redirect has
 * unloaded, so this page is the only place the outcome can be recorded and the decline explained.
 */
describe('OAuthCallbackPage — create-flow Drive consent (#128)', () => {
  const RESUME_REASON_KEY = 'beanies:resume-reason';
  const createState = (): string =>
    encodeRedirectState({ returnPath: '/welcome?resume=setup', mode: 'create' });

  beforeEach(() => {
    sessionStorage.clear();
    mockTrackOnboardingStep.mockClear();
  });
  afterEach(() => {
    Object.defineProperty(window, 'location', { configurable: true, value: realLocation });
  });

  it('a create code emits `drive-consent submitted` and stashes no reason', () => {
    stubLocation(`?code=DRIVE_CODE&state=${encodeURIComponent(createState())}`);
    mount(OAuthCallbackPage);

    expect(mockTrackOnboardingStep).toHaveBeenCalledTimes(1);
    expect(mockTrackOnboardingStep).toHaveBeenCalledWith('drive-consent', 'submitted');
    expect(sessionStorage.getItem(RESUME_REASON_KEY)).toBeNull();
    expect(hrefTarget).toBe('/welcome?resume=setup');
  });

  it('a create decline stashes `drive-declined`, emits `back` access_denied, and returns', () => {
    stubLocation(`?error=access_denied&state=${encodeURIComponent(createState())}`);
    mount(OAuthCallbackPage);

    expect(sessionStorage.getItem(RESUME_REASON_KEY)).toBe('drive-declined');
    expect(mockTrackOnboardingStep).toHaveBeenCalledTimes(1);
    expect(mockTrackOnboardingStep).toHaveBeenCalledWith('drive-consent', 'back', {
      error_code: 'access_denied',
    });
    expect(hrefTarget).toBe('/welcome?resume=setup');
  });

  it('any other `error=` value is collapsed to the closed `oauth-error` code, never echoed', () => {
    stubLocation(`?error=%3Cscript%3Ecrafted&state=${encodeURIComponent(createState())}`);
    mount(OAuthCallbackPage);

    expect(mockTrackOnboardingStep).toHaveBeenCalledWith('drive-consent', 'back', {
      error_code: 'oauth-error',
    });
    // Not a decline, so no "Google needs a yes" screen on return.
    expect(sessionStorage.getItem(RESUME_REASON_KEY)).toBeNull();
  });

  it('an access_denied WITH a description (a policy block) is not a decline: no reason, oauth-error', () => {
    stubLocation(
      `?error=access_denied&error_description=${encodeURIComponent('Access blocked by your admin')}&state=${encodeURIComponent(createState())}`
    );
    mount(OAuthCallbackPage);

    expect(sessionStorage.getItem(RESUME_REASON_KEY)).toBeNull();
    expect(mockTrackOnboardingStep).toHaveBeenCalledWith('drive-consent', 'back', {
      error_code: 'oauth-error',
    });
    expect(hrefTarget).toBe('/welcome?resume=setup');
  });

  it('the join arm forwards a described access_denied with its description (not a decline)', () => {
    const joinState = encodeRedirectState({ returnPath: '/join?fam=abc', mode: 'join' });
    stubLocation(
      `?error=access_denied&error_description=blocked&state=${encodeURIComponent(joinState)}`
    );
    mount(OAuthCallbackPage);

    expect(hrefTarget).toBe(
      `/join?fam=abc&authError=${encodeURIComponent('access_denied: blocked').replace(/%20/g, '+')}`
    );
  });

  it('a CALENDAR connect decline (also mode create) records nothing for the create flow', () => {
    const calState = encodeRedirectState({
      returnPath: '/settings?open=calendar-sync&calResume=connect',
      mode: 'create',
      grant: 'calendar',
    });
    stubLocation(`?error=access_denied&state=${encodeURIComponent(calState)}`);
    mount(OAuthCallbackPage);

    expect(sessionStorage.getItem(RESUME_REASON_KEY)).toBeNull();
    expect(mockTrackOnboardingStep).not.toHaveBeenCalled();
    expect(hrefTarget).toBe('/settings?open=calendar-sync&calResume=connect');
  });

  it('the join arm is unchanged: authError appended, no reason, no funnel event', () => {
    const joinState = encodeRedirectState({ returnPath: '/join?fam=abc', mode: 'join' });
    stubLocation(`?error=access_denied&state=${encodeURIComponent(joinState)}`);
    mount(OAuthCallbackPage);

    expect(hrefTarget).toBe('/join?fam=abc&authError=access_denied');
    expect(sessionStorage.getItem(RESUME_REASON_KEY)).toBeNull();
    expect(mockTrackOnboardingStep).not.toHaveBeenCalled();
  });

  it('a reconnect decline records nothing for the create flow', () => {
    const state = encodeRedirectState({ returnPath: '/settings', mode: 'reconnect' });
    stubLocation(`?error=access_denied&state=${encodeURIComponent(state)}`);
    mount(OAuthCallbackPage);

    expect(sessionStorage.getItem(RESUME_REASON_KEY)).toBeNull();
    expect(mockTrackOnboardingStep).not.toHaveBeenCalled();
    expect(hrefTarget).toBe('/settings');
  });
});

/**
 * #128 — the popup transport classifies `access_denied` the same way: bare is the person's
 * decline (forwarded as is, so `isUserCancellation` matches it exactly), described is a policy
 * block (forwarded with its description, so it is NOT read as a cancel).
 */
describe('OAuthCallbackPage — popup access_denied classification (#128)', () => {
  const postMessage = vi.fn();

  beforeEach(() => {
    postMessage.mockClear();
    Object.defineProperty(window, 'opener', { configurable: true, value: { postMessage } });
  });
  afterEach(() => {
    Object.defineProperty(window, 'opener', { configurable: true, value: null });
    Object.defineProperty(window, 'location', { configurable: true, value: realLocation });
  });

  it('posts a bare access_denied unchanged', () => {
    stubLocation('?error=access_denied');
    mount(OAuthCallbackPage);

    expect(postMessage).toHaveBeenCalledWith(
      { type: 'oauth-callback', code: null, error: 'access_denied' },
      'https://app.beanies.family'
    );
  });

  it('posts a described access_denied as `access_denied: <description>`', () => {
    stubLocation(`?error=access_denied&error_description=${encodeURIComponent('Access blocked')}`);
    mount(OAuthCallbackPage);

    expect(postMessage).toHaveBeenCalledWith(
      { type: 'oauth-callback', code: null, error: 'access_denied: Access blocked' },
      'https://app.beanies.family'
    );
  });
});
