/**
 * Everything the wall shows AROUND the calendar: tonight's meal, the trip in
 * flight, and the family's lists.
 *
 * The mockup's bottom band and right rail are not decoration — they are the
 * reason a wall display beats a paper calendar, and leaving them out reduced
 * the wall to "activities only". This composable is the ONE place that decides
 * what those cards show, so the band (views A and B) and the rail (view C)
 * cannot drift apart, and a drill-in sheet reads the same objects the card did.
 *
 * Read-only by design: every write on the wall goes through `useWallJobs`.
 */
import { computed, type Ref } from 'vue';
import { useFamilyStore } from '@/stores/familyStore';
import { useListStore } from '@/stores/listStore';
import { useMealPlanStore } from '@/stores/mealPlanStore';
import { useRecipesStore } from '@/stores/recipesStore';
import { useVacationStore } from '@/stores/vacationStore';
import { useVacationTimeline } from '@/composables/useVacationTimeline';
import { useToday } from '@/composables/useToday';
import { useTranslation } from '@/composables/useTranslation';
import { mealDisplayName } from '@/utils/mealDisplayName';
import type { UIStringKey } from '@/services/translation/uiStrings';
import { isWallSafeList, wallShowsList } from '@/utils/wallJobs';
import { isFiled } from '@/utils/listLifecycle';
import { plateClock } from '@/utils/todoPlate';
import { tripDayProgress, tripPhase } from '@/utils/vacation';
import { SLOT_EMOJI, SLOT_INDEX, pickTonight } from '@/constants/mealSlots';
import type {
  FamilyList,
  FamilyMember,
  FamilyVacation,
  MealPlanEntry,
  MealSlot,
} from '@/types/models';

export interface WallMeal {
  id: string;
  slot: MealSlot;
  emoji: string;
  /** `wall.meals.slot.*` — the meal's slot, named rather than merely coloured. */
  slotKey: UIStringKey;
  name: string;
  cook: FamilyMember | null;
}

export interface WallTrip {
  id: string;
  name: string;
  travellers: FamilyMember[];
  startDate?: string;
  endDate?: string;
  /** 0–100, only meaningful once the trip has started. */
  percent: number;
  phase: ReturnType<typeof tripPhase>;
}

/**
 * "31 Aug – 2 Sep", or a single date when the trip is one day; '' with no start.
 * One formatter for the card and the drawer's trip chips, so they cannot disagree.
 */
export function wallTripDates(trip: Pick<WallTrip, 'startDate' | 'endDate'>): string {
  if (!trip.startDate) return '';
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
  const day = (iso: string) =>
    new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString(undefined, opts);
  const start = day(trip.startDate);
  if (!trip.endDate || trip.endDate.slice(0, 10) === trip.startDate.slice(0, 10)) return start;
  return `${start} – ${day(trip.endDate)}`;
}

/**
 * @param selectedTripId The trip the caller is looking at. The drawer passes its own ref so a
 * family can page through every upcoming trip; the cards pass nothing and always get the next
 * one. An id that is no longer upcoming (the trip ended or was deleted while the drawer was
 * open) falls back to the next trip rather than rendering an empty body.
 */
export function useWallPeripherals(selectedTripId?: Ref<string | null>) {
  const familyStore = useFamilyStore();
  const listStore = useListStore();
  const mealPlanStore = useMealPlanStore();
  const recipesStore = useRecipesStore();
  const vacationStore = useVacationStore();
  const { today } = useToday();
  const { t } = useTranslation();

  function toWallMeal(meal: MealPlanEntry): WallMeal {
    return {
      id: meal.id,
      slot: meal.slot,
      emoji: SLOT_EMOJI[meal.slot],
      slotKey: `wall.meals.slot.${meal.slot}` as UIStringKey,
      name: mealDisplayName(meal, recipesStore.recipes, t),
      cook: meal.cookMemberId
        ? (familyStore.members.find((m) => m.id === meal.cookMemberId) ?? null)
        : null,
    };
  }

  /** Every meal planned for today, in slot order — the card shows one, the sheet all. */
  const mealsToday = computed<WallMeal[]>(() => {
    return [...mealPlanStore.todaysMeals]
      .sort((a, b) => SLOT_INDEX[a.slot] - SLOT_INDEX[b.slot] || a.position - b.position)
      .map(toWallMeal);
  });

  /** "Tonight": dinner, else the last meal of the day (`pickTonight`, shared with the widget). */
  const tonight = computed<WallMeal | null>(() => pickTonight(mealsToday.value));

  function toWallTrip(vacation: FamilyVacation): WallTrip {
    const progress = tripDayProgress(vacation, today.value);
    return {
      id: vacation.id,
      name: vacation.name,
      travellers: vacation.assigneeIds
        .map((id) => familyStore.members.find((m) => m.id === id))
        .filter((m): m is FamilyMember => !!m),
      startDate: vacation.startDate,
      endDate: vacation.endDate,
      percent: progress ? Math.round((progress.day / progress.total) * 100) : 0,
      phase: tripPhase(vacation, today.value),
    };
  }

  /** Every trip in flight or still to come, soonest first: the drawer's trip chips. */
  const upcomingTrips = computed<WallTrip[]>(() => vacationStore.upcomingVacations.map(toWallTrip));

  /**
   * The raw vacation behind the wall's trip, exposed so the sheet does not
   * re-look it up. That second lookup was both a second source of truth and a
   * real if rare failure mode: when the find missed, the whole trip body
   * rendered empty with nothing logged.
   *
   * The caller's selection when it is still upcoming, else the next trip.
   */
  const tripVacation = computed(() => {
    const upcoming = vacationStore.upcomingVacations;
    const selectedId = selectedTripId?.value;
    return (selectedId && upcoming.find((v) => v.id === selectedId)) || upcoming[0];
  });

  /** The selected trip, else the one in flight, else the next one coming. */
  const trip = computed<WallTrip | null>(() =>
    tripVacation.value ? toWallTrip(tripVacation.value) : null
  );

  /**
   * The itinerary, from the app's OWN timeline rule.
   *
   * This used to be a hand-rolled `vacation.travelSegments.slice(0, 3)` — the
   * only place in the app that built its own leg list, and the only one with a
   * cap, so a trip with four flights showed three and a trip with a hotel
   * showed none of it. `useVacationTimeline` already merges all three entity
   * types, orders them by date then time with untimed last, groups them by day
   * and attaches each one's when-band; the travel page has rendered it in
   * production all along. The wall now reads the same thing rather than holding
   * a second opinion about what a trip contains.
   */
  const { timelineItems, groupedByDate, accommodationGaps, undatedItems } = useVacationTimeline(
    tripVacation,
    today
  );

  /**
   * Active lists, minus the private categories.
   *
   * Built from the RAW `listStore.lists`, deliberately not `activeLists`: that
   * getter runs through `createMemberFiltered`, i.e. the account holder's
   * persisted, phone-shared member filter. A parent narrowing their planner to
   * one child would have blanked "The lists" on the kitchen wall — exactly the
   * cross-contamination `WallFooter` keeps its own filter to avoid.
   *
   * `isWallSafeList` and `wallShowsList` are the same gates the jobs rule uses, so a
   * health list, or one not showing yet, cannot reach a shared screen through the lists
   * card after being excluded from the jobs columns.
   */
  const lists = computed<FamilyList[]>(() => {
    const clock = { ...plateClock(), ymd: today.value };
    return listStore.lists.filter(
      (l) => !isFiled(l) && isWallSafeList(l) && wallShowsList(l, clock)
    );
  });

  return {
    mealsToday,
    tonight,
    trip,
    upcomingTrips,
    tripVacation,
    timelineItems,
    groupedByDate,
    accommodationGaps,
    undatedItems,
    lists,
  };
}
