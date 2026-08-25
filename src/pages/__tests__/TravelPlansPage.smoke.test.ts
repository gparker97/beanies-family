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
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { FamilyVacation } from '@/types/models';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock('@/composables/useToast', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));
vi.mock('@/composables/useConfirm', () => ({ confirm: vi.fn().mockResolvedValue(true) }));
vi.mock('@/composables/usePermissions', () => ({
  usePermissions: () => ({ canEditActivities: { value: true } }),
}));
vi.mock('@/composables/useQuickAddIntent', () => ({ useQuickAddIntent: vi.fn() }));
vi.mock('@/composables/useMagicReader', () => ({
  useMagicReader: () => ({ canReadTravelDoc: { value: false } }),
  useMagicReaderConsumer: vi.fn(),
}));
vi.mock('vue-router', () => ({
  useRoute: () => ({ params: {}, query: {} }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

// Selection is driven through the deep-link composable — the page's real entry point for
// "open this trip". Triggering the card's event is not an option: `shallow` leaves child
// components unresolved, so there is no component there to emit.
let deepLinkId: string | null = null;
vi.mock('@/composables/useDeepLinkParam', () => ({
  useDeepLinkParam: (opts: { open: (id: string) => boolean }) => {
    if (deepLinkId) {
      const id = deepLinkId;
      // Next tick, so the page's own reactive state is set up before selection lands.
      void Promise.resolve().then(() => opts.open(id));
    }
  },
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
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    // Hermetic: mounting reaches code that performs a real fetch (link previews, avatars),
    // which happy-dom leaves hanging until the 5s timeout — and only when the whole suite
    // runs, so it passed in isolation and failed together. A test that depends on run order
    // is not a safety net.
    deepLinkId = null;
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue({ ok: true, status: 200, json: async () => ({}), text: async () => '' })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
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
    // Counted by ELEMENT, not by component: under `shallow` the child renders as a
    // placeholder <tripcard> element, which findAllComponents(name) does not match. The
    // element count is what reflects the v-for, and the v-for is what this guards.
    expect(w.findAll('tripcard').length).toBe(2);
  }, 20_000);

  // NOT COVERED, deliberately, and this is a limitation worth naming rather than papering
  // over: the DETAIL view (timeline + ideas panel) has no smoke coverage. Selecting a trip
  // needs a child component to emit, and `shallow` leaves children unresolved; driving it
  // through the deep-link composable did not land either. Several attempts produced only a
  // test that asserted 0 === 0, which is worse than no test.
  //
  // Consequence for whoever continues the decomposition: extracting TripTimeline (~330
  // lines, the largest remaining unit) has NO structural safety net. Either solve this
  // harness problem first, or verify that extraction in a browser.
});
