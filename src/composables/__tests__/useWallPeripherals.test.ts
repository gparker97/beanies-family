/**
 * Which trip the wall shows.
 *
 * The cards always show the next trip; the drawer may page through every upcoming one. Both
 * read this composable, so the rule under test is the selection: no selection is the next
 * trip, a selection wins while it is still upcoming, and a selection that has gone (the trip
 * ended or was deleted with the drawer open) falls back instead of blanking the drawer.
 */
import { ref, type Ref } from 'vue';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { FamilyVacation } from '@/types/models';

const upcomingVacations = ref<FamilyVacation[]>([]);
// A plain variable: a ref here would unwrap the ref it is holding.
let timelineSource: Ref<FamilyVacation | undefined> | null = null;

vi.mock('@/stores/vacationStore', () => ({
  useVacationStore: () => ({
    get upcomingVacations() {
      return upcomingVacations.value;
    },
  }),
}));
vi.mock('@/stores/familyStore', () => ({
  useFamilyStore: () => ({ members: [{ id: 'm1', name: 'Mia' }] }),
}));
vi.mock('@/stores/listStore', () => ({ useListStore: () => ({ lists: [] }) }));
vi.mock('@/stores/mealPlanStore', () => ({ useMealPlanStore: () => ({ todaysMeals: [] }) }));
vi.mock('@/stores/recipesStore', () => ({ useRecipesStore: () => ({ recipes: [] }) }));
vi.mock('@/composables/useToday', () => ({ useToday: () => ({ today: ref('2026-11-11') }) }));
vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/composables/useVacationTimeline', () => ({
  useVacationTimeline: (vacation: Ref<FamilyVacation | undefined>) => {
    timelineSource = vacation;
    return {
      timelineItems: ref([]),
      groupedByDate: ref([]),
      accommodationGaps: ref([]),
      undatedItems: ref([]),
    };
  },
}));

import { useWallPeripherals, wallTripDates } from '../useWallPeripherals';

function vacation(id: string, startDate: string, endDate: string): FamilyVacation {
  return { id, name: id, assigneeIds: ['m1', 'gone'], startDate, endDate } as FamilyVacation;
}

beforeEach(() => {
  upcomingVacations.value = [
    vacation('tokyo', '2026-11-20', '2026-11-27'),
    vacation('bali', '2026-12-18', '2026-12-28'),
    vacation('perth', '2027-02-03', '2027-02-03'),
  ];
});

describe('useWallPeripherals trip selection', () => {
  it('shows the next trip when nothing is selected, and lists them all', () => {
    const { trip, upcomingTrips } = useWallPeripherals();
    expect(trip.value?.id).toBe('tokyo');
    expect(upcomingTrips.value.map((t) => t.id)).toEqual(['tokyo', 'bali', 'perth']);
    // A traveller who has left the family is dropped, not rendered as a blank chip.
    expect(trip.value?.travellers.map((m) => m.id)).toEqual(['m1']);
  });

  it('follows the selection, and the itinerary follows with it', () => {
    const selected = ref<string | null>(null);
    const { trip, tripVacation } = useWallPeripherals(selected);
    selected.value = 'bali';
    expect(trip.value?.id).toBe('bali');
    expect(tripVacation.value?.id).toBe('bali');
    // The timeline is built from the SAME ref, so it cannot show another trip's bookings.
    expect(timelineSource?.value?.id).toBe('bali');
  });

  it('falls back to the next trip when the selected one is no longer upcoming', () => {
    const selected = ref<string | null>('bali');
    const { trip } = useWallPeripherals(selected);
    upcomingVacations.value = upcomingVacations.value.filter((v) => v.id !== 'bali');
    expect(trip.value?.id).toBe('tokyo');
  });

  it('has no trip when there are none', () => {
    upcomingVacations.value = [];
    const { trip, upcomingTrips } = useWallPeripherals(ref('bali'));
    expect(trip.value).toBeNull();
    expect(upcomingTrips.value).toEqual([]);
  });
});

describe('wallTripDates', () => {
  it('is a range, one date for a one-day trip, and empty with no start', () => {
    const day = (iso: string) =>
      new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
    expect(wallTripDates({ startDate: '2026-11-20', endDate: '2026-11-27' })).toBe(
      `${day('2026-11-20')} – ${day('2026-11-27')}`
    );
    expect(wallTripDates({ startDate: '2027-02-03', endDate: '2027-02-03' })).toBe(
      day('2027-02-03')
    );
    expect(wallTripDates({ startDate: '2027-02-03' })).toBe(day('2027-02-03'));
    expect(wallTripDates({})).toBe('');
  });
});
