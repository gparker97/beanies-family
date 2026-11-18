/**
 * The trip drawer's header: with one upcoming trip it is a plain title; with two or more the
 * trip chips stand in for the title in the same row, the `h2` stays (visually hidden) as the
 * dialog's accessible name, and tapping a chip switches the trip.
 */
import { mount } from '@vue/test-utils';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { computed, ref, type Ref } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import WallSheet from '../WallSheet.vue';
import WallStarsSheet from '../WallStarsSheet.vue';
import type { WallSheetTarget } from '@/types/wall';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/composables/useMemberAvatar', () => ({
  useMemberAvatarBindings: () => ({ memberAvatarBindings: () => ({}) }),
}));
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: vi.fn() }));
vi.mock('@/stores/familyStore', () => ({
  useFamilyStore: () => ({ sortedHumans: [], members: [] }),
}));
vi.mock('@/stores/activityStore', () => ({
  useActivityStore: () => ({ activities: [] }),
}));
vi.mock('@/stores/flightStatusStore', () => ({
  useFlightStatusStore: () => ({ verificationFor: () => null, nowMs: 0 }),
}));

interface FakeTrip {
  id: string;
  name: string;
  travellers: never[];
}
let trips: FakeTrip[] = [];

vi.mock('@/composables/useWallPeripherals', () => ({
  useWallPeripherals: (selected: Ref<string | null>) => ({
    mealsToday: ref([]),
    trip: computed(() => trips.find((t) => t.id === selected.value) ?? trips[0] ?? null),
    upcomingTrips: computed(() => trips),
    tripVacation: ref(null),
    groupedByDate: ref([]),
    accommodationGaps: ref([]),
    undatedItems: ref([]),
  }),
  wallTripDates: () => '20 Oct – 25 Oct',
}));

const TRIP: WallSheetTarget = { kind: 'trip' } as WallSheetTarget;

function mountSheet(target: WallSheetTarget = TRIP, { attach = false } = {}) {
  return mount(WallSheet, {
    ...(attach ? { attachTo: document.body } : {}),
    props: {
      target,
      isPending: () => false,
      visibleMemberIds: null,
      todosFor: () => [],
      allTodos: [],
      listsFor: () => [],
      orphanLists: [],
    },
    global: {
      stubs: {
        BeanieIcon: true,
        BeanieAvatar: true,
        WallTripTimeline: true,
        HandwrittenLine: true,
        CelebrationConfetti: true,
        WallStarsSheet: true,
      },
    },
  });
}

const header = (w: ReturnType<typeof mountSheet>) => w.find('.wall-sheet-head');

beforeEach(() => {
  setActivePinia(createPinia());
  trips = [];
});

describe('WallSheet trip header', () => {
  it('one trip: a plain visible title and no chips', () => {
    trips = [{ id: 'v1', name: 'Lake cabin', travellers: [] }];
    const w = mountSheet();
    const h2 = header(w).find('h2');
    expect(h2.text()).toBe('Lake cabin');
    expect(h2.classes()).not.toContain('sr-only');
    expect(w.find('[role="group"]').exists()).toBe(false);
    expect(w.find('[aria-pressed]').exists()).toBe(false);
  });

  it('two or more trips: the chips sit in the title row and the h2 names the dialog, hidden', () => {
    trips = [
      { id: 'v1', name: 'Lake cabin', travellers: [] },
      { id: 'v2', name: 'Grandma in the mountains', travellers: [] },
      { id: 'v3', name: 'Seaside week', travellers: [] },
    ];
    const w = mountSheet();
    const head = header(w);
    const group = head.find('[role="group"]');
    expect(group.exists()).toBe(true);
    expect(group.attributes('aria-label')).toBe('wall.trip.switcher');
    expect(group.findAll('button[aria-pressed]')).toHaveLength(3);
    // Close stays in the same row, after the strip.
    expect(head.find('button[aria-label="action.close"]').exists()).toBe(true);
    // Nothing above the trip card in the body any more.
    expect(w.find('.wall-sheet-body [role="group"]').exists()).toBe(false);

    const h2 = head.find('h2');
    expect(h2.classes()).toContain('sr-only');
    expect(h2.text()).toBe('Lake cabin');
    const dialog = w.find('[role="dialog"]');
    expect(dialog.attributes('aria-labelledby')).toBe(h2.attributes('id'));
  });

  it('tapping a chip switches the trip and the pressed chip', async () => {
    trips = [
      { id: 'v1', name: 'Lake cabin', travellers: [] },
      { id: 'v2', name: 'Grandma in the mountains', travellers: [] },
    ];
    const w = mountSheet();
    const chips = () => header(w).findAll('button[aria-pressed]');
    expect(chips().map((c) => c.attributes('aria-pressed'))).toEqual(['true', 'false']);

    await chips()[1]!.trigger('click');
    expect(chips().map((c) => c.attributes('aria-pressed'))).toEqual(['false', 'true']);
    expect(header(w).find('h2').text()).toBe('Grandma in the mountains');
  });
});

/**
 * The stars sheet (#154): a head in the chore lanes opens it for one bean. A child chip inside it
 * switches to that child through the sheet's existing `open`, and a member this device no longer
 * knows gets the feature's own title.
 */
describe('WallSheet stars', () => {
  it('renders the stars body and re-emits a chip switch as open with a stars target', () => {
    const w = mountSheet({ kind: 'stars', memberId: 'gone' });
    const body = w.findComponent(WallStarsSheet);
    expect(body.exists()).toBe(true);
    expect(body.props('memberId')).toBe('gone');
    expect(header(w).find('h2').text()).toBe('choreStars.title');
    body.vm.$emit('switch-member', 'kid');
    expect(w.emitted('open')).toEqual([[{ kind: 'stars', memberId: 'kid' }]]);
  });

  it('a chip switch keeps focus inside the dialog, on the new title', async () => {
    // The chip that had focus belongs to the old body; once the target changes it is gone, and
    // focus would fall to <body> behind the aria-modal dialog.
    const w = mountSheet({ kind: 'stars', memberId: 'gone' }, { attach: true });
    const chip = document.createElement('button');
    w.find('.wall-sheet-panel').element.appendChild(chip);
    chip.focus();
    chip.remove();

    await w.setProps({ target: { kind: 'stars', memberId: 'kid' } });
    const title = header(w).find('h2');
    expect(title.attributes('tabindex')).toBe('-1');
    expect(document.activeElement).toBe(title.element);
    expect(w.find('[role="dialog"]').element.contains(document.activeElement)).toBe(true);
    w.unmount();
  });
});
