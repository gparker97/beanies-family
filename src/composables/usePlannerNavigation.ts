import { computed, ref, type ComputedRef, type Ref } from 'vue';
import {
  addDays,
  formatDayLong,
  formatMonthYear,
  formatMonthYearShort,
  formatMonthYearTiny,
  formatTodayCaption,
  toDateInputValue,
} from '@/utils/date';
import { useToday } from '@/composables/useToday';
import { formatWeekRange, useWeekNavigation } from '@/composables/useCalendarNavigation';
import { useBreakpoint } from '@/composables/useBreakpoint';

/** Every planner view, in switcher order. The one source for the type and its guard. */
export const PLANNER_VIEWS = ['month', 'week', 'day'] as const;

export type PlannerView = (typeof PLANNER_VIEWS)[number];

/** Narrow an untrusted string (an emitted value, a URL param) to a `PlannerView`. */
export function isPlannerView(value: unknown): value is PlannerView {
  return typeof value === 'string' && (PLANNER_VIEWS as readonly string[]).includes(value);
}

/**
 * Single source of truth for the calendar's current period.
 *
 * The Family Planner page owns ONE `referenceDate`; the Month / Week / Day
 * views are controlled — they receive `referenceDate` as a prop and render
 * off it. This composable derives the period `labels` and the prev/next/today
 * intents for the active view, reusing the existing date formatters and
 * `formatWeekRange` over `useWeekNavigation`'s `weekDays` (no parallel label logic).
 *
 * `labels` is a LADDER, longest first: the command bar renders the first one that
 * fits its title slot on one line (`useFirstThatFits`), so a narrow phone header
 * still shows the month and year. Month: "March 2026" → "Mar 2026" → "Mar '26".
 * Week: the range with the year → without it → the reference date's month ("Oct 2026"
 * → "Oct '26"; the strip below names the days, and the Month view titles the same month). Day: one label (the phone caption or
 * the desktop long form), so nothing is measured.
 *
 * Data-flow invariant (keep it one-way):
 *   - `referenceDate` flows page → views (props down). Views NEVER mutate it.
 *   - Navigation intent flows views → page (emit) and command-bar → page
 *     (emit); the page calls `goPrev`/`goNext`/`goToday` here.
 * This prevents the prop/watch ping-pong that bidirectional date state invites.
 *
 * Month stepping anchors to the 1st of the target month (`new Date(y, m±1, 1)`)
 * rather than `addMonths`, because `Date.setMonth` overflows on long days
 * (e.g. Mar 31 + 1mo → May 1, skipping April). The month grid only reads the
 * year/month, so anchoring to the 1st is both correct and harmless.
 */
export function usePlannerNavigation(activeView: Ref<PlannerView>): {
  referenceDate: Ref<Date>;
  labels: ComputedRef<string[]>;
  goPrev: () => void;
  goNext: () => void;
  goToday: () => void;
} {
  const { startOfToday } = useToday();
  const { isMobile } = useBreakpoint();
  const referenceDate = ref<Date>(startOfToday.value);
  const { weekDays } = useWeekNavigation(referenceDate);

  const labels = computed<string[]>(() => {
    switch (activeView.value) {
      case 'week': {
        const days = weekDays.value;
        const first = days[0]!.date;
        const last = days[6]!.date;
        // Past the year-less range the week strip already names every day, so the title
        // falls back to the reference date's month (the same month the Month view would
        // title, so toggling Week and Month on one date never flips the name).
        const d = referenceDate.value;
        return [
          formatWeekRange(first, last),
          formatWeekRange(first, last, false),
          formatMonthYearShort(d),
          formatMonthYearTiny(d),
        ];
      }
      case 'day':
        // Phones have little horizontal room in the reclaimed command bar, so
        // drop the year ("Wed, 27 May") — it's implicit once you're on the day.
        // Desktop keeps the full "Wednesday, 27 May 2026".
        return [
          isMobile.value
            ? formatTodayCaption(toDateInputValue(referenceDate.value))
            : formatDayLong(toDateInputValue(referenceDate.value)),
        ];
      default: {
        const d = referenceDate.value;
        return [formatMonthYear(d), formatMonthYearShort(d), formatMonthYearTiny(d)];
      }
    }
  });

  function stepMonth(delta: number): Date {
    const d = referenceDate.value;
    return new Date(d.getFullYear(), d.getMonth() + delta, 1);
  }

  function step(delta: 1 | -1): void {
    switch (activeView.value) {
      case 'month':
        referenceDate.value = stepMonth(delta);
        break;
      case 'week':
        referenceDate.value = addDays(referenceDate.value, delta * 7);
        break;
      default:
        referenceDate.value = addDays(referenceDate.value, delta);
    }
  }

  function goPrev(): void {
    step(-1);
  }
  function goNext(): void {
    step(1);
  }
  function goToday(): void {
    referenceDate.value = startOfToday.value;
  }

  return { referenceDate, labels, goPrev, goNext, goToday };
}
