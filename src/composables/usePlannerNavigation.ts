import { computed, ref, type ComputedRef, type Ref } from 'vue';
import { addDays, formatDayLong, formatMonthYear, toDateInputValue } from '@/utils/date';
import { useToday } from '@/composables/useToday';
import { useWeekNavigation } from '@/composables/useCalendarNavigation';

export type PlannerView = 'month' | 'week' | 'day';

/**
 * Single source of truth for the calendar's current period.
 *
 * The Family Planner page owns ONE `referenceDate`; the Month / Week / Day
 * views are controlled — they receive `referenceDate` as a prop and render
 * off it. This composable derives the period `label` and the prev/next/today
 * intents for the active view, reusing the existing date formatters and
 * `useWeekNavigation`'s week-range label (no parallel label logic).
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
  label: ComputedRef<string>;
  goPrev: () => void;
  goNext: () => void;
  goToday: () => void;
} {
  const { startOfToday } = useToday();
  const referenceDate = ref<Date>(startOfToday.value);
  const { weekLabel } = useWeekNavigation(referenceDate);

  const label = computed(() => {
    switch (activeView.value) {
      case 'week':
        return weekLabel.value;
      case 'day':
        return formatDayLong(toDateInputValue(referenceDate.value));
      default:
        return formatMonthYear(referenceDate.value);
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

  return { referenceDate, label, goPrev, goNext, goToday };
}
