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
import { computed } from 'vue';
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
import { isWallSafeList } from '@/utils/wallJobs';
import { isFiled } from '@/utils/listLifecycle';
import { tripDayProgress, tripPhase } from '@/utils/vacation';
import { SLOT_EMOJI, SLOT_INDEX } from '@/constants/mealSlots';
import type { FamilyList, FamilyMember, MealPlanEntry, MealSlot } from '@/types/models';

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

export function useWallPeripherals() {
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

  /**
   * "Tonight" means dinner when there is one. Falling back to the last meal of
   * the day rather than the first keeps the card forward-looking on a family
   * that only plans lunches.
   */
  const tonight = computed<WallMeal | null>(() => {
    const meals = mealsToday.value;
    return meals.find((m) => m.slot === 'dinner') ?? meals[meals.length - 1] ?? null;
  });

  /**
   * The raw vacation behind the wall's trip, exposed so the sheet does not
   * re-look it up. That second lookup was both a second source of truth and a
   * real if rare failure mode: when the find missed, the whole trip body
   * rendered empty with nothing logged.
   */
  const tripVacation = computed(() => vacationStore.upcomingVacations[0]);

  /** The trip in flight, else the next one coming. */
  const trip = computed<WallTrip | null>(() => {
    const vacation = tripVacation.value;
    if (!vacation) return null;
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
  });

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
   * `isWallSafeList` is the same gate the jobs rule uses, so a health list
   * cannot reach a shared screen through the lists card after being excluded
   * from the jobs columns.
   */
  const lists = computed<FamilyList[]>(() =>
    listStore.lists.filter((l) => !isFiled(l) && isWallSafeList(l))
  );

  return {
    mealsToday,
    tonight,
    trip,
    tripVacation,
    timelineItems,
    groupedByDate,
    accommodationGaps,
    undatedItems,
    lists,
  };
}
