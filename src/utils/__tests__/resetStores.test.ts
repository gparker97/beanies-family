/**
 * REVIEW-DEMO regression guard.
 *
 * `resetAllAppStores` is a fan-out over every family-scoped store, so the useful
 * thing to pin here is the ONE piece of non-store module state it also owns:
 * the demo-session flag.
 *
 * Why this test exists: sign-out from `AppHeader` does `resetAllAppStores()`
 * followed by `router.replace('/login')` — with no page reload. So a demo flag
 * that is only cleared "when the module is dropped" is never cleared at all, and
 * the "this is sample data" banner would follow the user to the login screen and
 * onto the next real pod they create in the same JS session.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Every store is a fan-out target, not the subject — stub them all so the test
// stays about the flag rather than about Pinia bootstrapping.
const resetState = () => ({ resetState: vi.fn() });
for (const store of [
  'syncStore',
  'familyStore',
  'accountsStore',
  'transactionsStore',
  'assetsStore',
  'goalsStore',
  'recurringStore',
  'settingsStore',
  'memberFilterStore',
  'todoStore',
  'listStore',
  'activityStore',
  'holidayStore',
]) {
  const name = `use${store[0]!.toUpperCase()}${store.slice(1)}`;
  vi.doMock(`@/stores/${store}`, () => ({ [name]: () => resetState() }));
}
vi.mock('@/stores/calendarSyncStore', () => ({ useCalendarSyncStore: () => ({ stop: vi.fn() }) }));
vi.mock('@/stores/calendarClashStore', () => ({
  useCalendarClashStore: () => ({ stop: vi.fn() }),
}));
vi.mock('@/config/flags', () => ({ isFlagEnabled: () => false }));

describe('resetAllAppStores', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('clears the demo-session flag, so the demo banner cannot leak into the next session', async () => {
    const { markDemoSession, isDemoSession } = await import('@/utils/reviewDemo');
    const { resetAllAppStores } = await import('@/utils/resetStores');

    markDemoSession();
    expect(isDemoSession.value).toBe(true);

    resetAllAppStores();

    expect(isDemoSession.value).toBe(false);
  });
});
