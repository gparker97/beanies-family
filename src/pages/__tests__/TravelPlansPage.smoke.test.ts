/**
 * A page-level SMOKE TEST, added mid-decomposition and for a specific reason.
 *
 * While extracting TimelineSegmentCard I added `v-for="item in group.items"` to a call site
 * whose enclosing <div> already iterated `entry.data.items` — every booking would have
 * rendered N² times. type-check, lint and 4906 unit tests were all green with that bug in
 * place, because nothing in the suite ever rendered this page.
 *
 * This is deliberately shallow: it asserts that the page mounts and that each region appears
 * the RIGHT NUMBER of times. That is precisely the class of mistake template surgery makes,
 * and it is the class unit tests on extracted components cannot catch.
 */
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { FamilyVacation } from '@/types/models';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock('@/composables/useToast', () => ({
  useToast: () => ({ showToast: vi.fn() }),
  showToast: vi.fn(),
}));
vi.mock('@/utils/errorReporter', () => ({ reportError: vi.fn() }));
vi.mock('@/composables/useConfirm', () => ({ confirm: vi.fn().mockResolvedValue(true) }));
vi.mock('@/composables/usePermissions', () => ({
  usePermissions: () => ({ canEditActivities: { value: true } }),
}));
vi.mock('@/composables/useQuickAddIntent', () => ({ useQuickAddIntent: vi.fn() }));
vi.mock('@/composables/useMagicReader', () => ({
  // The magic-beans door asks which kinds the sheet may offer (#108); none, in this page's tests.
  availableShareKinds: () => [],
  useMagicReader: () => ({ canReadTravelDoc: { value: false } }),
  useMagicReaderConsumer: vi.fn(),
}));
vi.mock('@/services/telemetry', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/telemetry')>()),
  logEvent: vi.fn(),
}));

// Selection is driven through the route query, the page's real entry point for "open this
// trip" (`?vacation=<id>`, pushed by a card tap and by the planner). Triggering the card's
// event is not an option: `shallow` leaves child components unresolved, so there is no
// component there to emit. One shared reactive route, so a test sets the query it needs.
const { routeState, routerMock } = await vi.hoisted(async () => {
  const { reactive } = await import('vue');
  const { vi: hoistedVi } = await import('vitest');
  return {
    routeState: reactive({ params: {}, query: {} as Record<string, string> }),
    routerMock: { push: hoistedVi.fn(), replace: hoistedVi.fn(), back: hoistedVi.fn() },
  };
});
vi.mock('vue-router', () => ({
  useRoute: () => routeState,
  useRouter: () => routerMock,
}));

function trip(over?: Partial<FamilyVacation>): FamilyVacation {
  return {
    id: 'vac-1',
    activityId: 'act-1',
    name: 'Japan Trip',
    tripType: 'fly_and_stay',
    // FUTURE dates: with past ones `upcomingVacations` is empty and the count
    // assertion below degenerates into 0 === 0, which passes for the wrong reason.
    startDate: '2099-07-01',
    endDate: '2099-07-10',
    assigneeIds: [],
    travelSegments: [],
    accommodations: [],
    transportation: [],
    ideas: [],
    createdBy: 'm-1',
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    ...over,
  } as FamilyVacation;
}

describe('TravelPlansPage — smoke', () => {
  // Every page watches the one shared route; a page left mounted would react to the next test's query.
  enableAutoUnmount(afterEach);

  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    // Hermetic: mounting reaches code that performs a real fetch (link previews, avatars),
    // which happy-dom leaves hanging until the 5s timeout — and only when the whole suite
    // runs, so it passed in isolation and failed together. A test that depends on run order
    // is not a safety net.
    routeState.query = {};
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue({ ok: true, status: 200, json: async () => ({}), text: async () => '' })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('mounts without throwing', async () => {
    const { default: Page } = await import('../TravelPlansPage.vue');
    const w = mount(Page, { global: { stubs: { teleport: true } }, shallow: true });
    expect(w.exists()).toBe(true);
    // 20s, not vitest's default 5s: the FIRST mount of this page in a full-suite run pays a
    // large one-off module-init cost. Verified by swapping the two tests — the failure
    // followed the POSITION, not the test, so it is harness startup rather than an
    // empty-state hang in the page itself.
  }, 20_000);

  it('renders ONE card per upcoming trip — not N per trip', async () => {
    // The exact bug this file was created for: a nested v-for renders each item once per
    // sibling. Two trips must produce two cards.
    const { useVacationStore } = await import('@/stores/vacationStore');
    const store = useVacationStore();
    store.vacations = [trip(), trip({ id: 'vac-2', name: 'Ski Trip' })];

    const { default: Page } = await import('../TravelPlansPage.vue');
    const w = mount(Page, { global: { stubs: { teleport: true } }, shallow: true });
    await w.vm.$nextTick();

    expect(store.upcomingVacations.length).toBe(2); // guard: the assertion below must be meaningful
    // Counted as stubbed COMPONENTS. The previous version counted bare `<tripcard>`
    // elements — which only exist when the component is NOT imported (Vue's silent
    // unknown-element fallback). That assertion was literally pinning the missing-import
    // bug that blanked the page in prod (2026-08-29): a resolved, stubbed TripCard
    // renders as `trip-card-stub`, so the old count read 0 the moment the bug was fixed.
    const stubs = w.findAll('trip-card-stub');
    expect(stubs.length).toBe(2);
    // And the inverse guard: an unresolved placeholder must NEVER appear.
    expect(w.findAll('tripcard').length).toBe(0);
  }, 20_000);

  it('renders the DETAIL view for the trip named in `?vacation=`', async () => {
    const { useVacationStore } = await import('@/stores/vacationStore');
    const store = useVacationStore();
    store.vacations = [trip(), trip({ id: 'vac-2', name: 'Ski Trip' })];
    routeState.query = { vacation: 'vac-2' };

    const { default: Page } = await import('../TravelPlansPage.vue');
    const w = mount(Page, { global: { stubs: { teleport: true } }, shallow: true });
    await w.vm.$nextTick();

    expect(w.text()).toContain('Ski Trip');
    expect(w.text()).not.toContain('Japan Trip');
    expect(w.findAll('trip-card-stub').length).toBe(0);
    expect(w.text()).not.toContain('travel.notFound.title');
  }, 20_000);

  it('shows not-found, with a way back, for a `?vacation=` no trip matches, and logs it once', async () => {
    const { logEvent } = await import('@/services/telemetry');
    const { useVacationStore } = await import('@/stores/vacationStore');
    const store = useVacationStore();
    store.vacations = [trip()];
    routeState.query = { vacation: 'gone' };

    const { default: Page } = await import('../TravelPlansPage.vue');
    const w = mount(Page, { global: { stubs: { teleport: true } }, shallow: true });
    await w.vm.$nextTick();

    expect(w.text()).toContain('travel.notFound.title');
    expect(w.find('back-link-stub').exists()).toBe(true);
    expect(w.findAll('trip-card-stub').length).toBe(0);
    store.vacations = [trip(), trip({ id: 'vac-3' })]; // an unrelated change re-renders
    await w.vm.$nextTick();
    const notFound = vi
      .mocked(logEvent)
      .mock.calls.filter(([e]) => e.surface === 'travel' && e.message === 'vacation_not_found');
    expect(notFound).toHaveLength(1);
  }, 20_000);

  it('deleting the open trip goes back to the list with no not-found flash and no warning', async () => {
    const { logEvent } = await import('@/services/telemetry');
    const { useVacationStore } = await import('@/stores/vacationStore');
    const store = useVacationStore();
    store.vacations = [trip(), trip({ id: 'vac-2', name: 'Ski Trip' })];
    routeState.query = { vacation: 'vac-2' };
    // The real delete drops the trip, then keeps awaiting (list-link cleanup) before it returns.
    vi.spyOn(store, 'deleteVacation').mockImplementation(async (id: string) => {
      store.vacations = store.vacations.filter((v) => v.id !== id);
      await new Promise((r) => setTimeout(r, 0));
      return true;
    });

    const { default: Page } = await import('../TravelPlansPage.vue');
    const w = mount(Page, { global: { stubs: { teleport: true } }, shallow: true });
    await w.vm.$nextTick();
    await w.find('button[title="vacation.deleteTitle"]').trigger('click');
    await new Promise((r) => setTimeout(r, 10));
    await w.vm.$nextTick();

    expect(store.deleteVacation).toHaveBeenCalledWith('vac-2');
    // The mocked router never moves the route, so the trip stays gone under `?vacation=` here:
    // the window a real Back takes to land. happy-dom has no history state: goBack falls back.
    expect(routerMock.push).toHaveBeenCalledWith({ path: '/travel' });
    expect(w.text()).not.toContain('travel.notFound.title');
    const notFound = vi
      .mocked(logEvent)
      .mock.calls.filter(([e]) => e.message === 'vacation_not_found');
    expect(notFound).toHaveLength(0);

    // The route leaves the trip, then Forward returns to it: now it is genuinely missing.
    routeState.query = {};
    await w.vm.$nextTick();
    routeState.query = { vacation: 'vac-2' };
    await w.vm.$nextTick();
    expect(w.text()).toContain('travel.notFound.title');
  }, 20_000);

  it('deleting goes back in history when the previous entry is the plain trips list', async () => {
    vi.spyOn(window.history, 'state', 'get').mockReturnValue({ back: '/travel' });
    const { useVacationStore } = await import('@/stores/vacationStore');
    const store = useVacationStore();
    store.vacations = [trip(), trip({ id: 'vac-2', name: 'Ski Trip' })];
    routeState.query = { vacation: 'vac-2' };
    vi.spyOn(store, 'deleteVacation').mockImplementation(async (id: string) => {
      store.vacations = store.vacations.filter((v) => v.id !== id);
      return true;
    });

    const { default: Page } = await import('../TravelPlansPage.vue');
    const w = mount(Page, { global: { stubs: { teleport: true } }, shallow: true });
    await w.vm.$nextTick();
    await w.find('button[title="vacation.deleteTitle"]').trigger('click');
    await new Promise((r) => setTimeout(r, 10));

    expect(routerMock.back).toHaveBeenCalledOnce();
    expect(routerMock.push).not.toHaveBeenCalled();
  }, 20_000);

  it('a failed delete stays on the trip, says so, and reports it', async () => {
    const { showToast } = await import('@/composables/useToast');
    const { reportError } = await import('@/utils/errorReporter');
    const { useVacationStore } = await import('@/stores/vacationStore');
    const store = useVacationStore();
    store.vacations = [trip(), trip({ id: 'vac-2', name: 'Ski Trip' })];
    routeState.query = { vacation: 'vac-2' };
    vi.spyOn(store, 'deleteVacation').mockResolvedValue(false);

    const { default: Page } = await import('../TravelPlansPage.vue');
    const w = mount(Page, { global: { stubs: { teleport: true } }, shallow: true });
    await w.vm.$nextTick();
    await w.find('button[title="vacation.deleteTitle"]').trigger('click');
    await new Promise((r) => setTimeout(r, 10));
    await w.vm.$nextTick();

    expect(routerMock.back).not.toHaveBeenCalled();
    expect(routerMock.push).not.toHaveBeenCalled();
    expect(w.text()).toContain('Ski Trip');
    expect(showToast).toHaveBeenCalledWith('error', 'error.deleteFailed');
    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({ surface: 'travel', severity: 'warning' })
    );
  }, 20_000);

  it('a cold-start deep link waits for the trips instead of reporting the trip missing', async () => {
    const { logEvent } = await import('@/services/telemetry');
    const { useVacationStore } = await import('@/stores/vacationStore');
    const store = useVacationStore();
    store.vacations = [];
    routeState.query = { vacation: 'vac-2' };

    const { default: Page } = await import('../TravelPlansPage.vue');
    const w = mount(Page, { global: { stubs: { teleport: true } }, shallow: true });
    await w.vm.$nextTick();
    expect(w.text()).not.toContain('travel.notFound.title');

    store.vacations = [trip(), trip({ id: 'vac-2', name: 'Ski Trip' })];
    await w.vm.$nextTick();
    expect(w.text()).toContain('Ski Trip');
    const notFound = vi
      .mocked(logEvent)
      .mock.calls.filter(([e]) => e.message === 'vacation_not_found');
    expect(notFound).toHaveLength(0);
  }, 20_000);
});
