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
