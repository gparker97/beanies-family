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
import { describe, it, expect, beforeEach, vi } from 'vitest';
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
  });

  it('mounts without throwing', async () => {
    const { default: Page } = await import('../TravelPlansPage.vue');
    const w = mount(Page, { global: { stubs: { teleport: true } }, shallow: true });
    expect(w.exists()).toBe(true);
  });

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
  });
});
