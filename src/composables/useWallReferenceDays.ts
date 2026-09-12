/**
 * PLACEMENT of the beanie wall's reference days. Nothing more.
 *
 * ⚠️ This used to read `familyStore` and `holidayStore` itself and build its own
 * labels, in parallel with the planner doing the same thing separately. That is
 * precisely how the two calendars came to disagree about what exists on a day:
 * the wall had no concept of public holidays at all, and family birthdays had to
 * be wired into nine surfaces by hand, reaching one of them on the first attempt.
 *
 * What a day CARRIES is now one question, asked by both calendars through
 * `useDayExtras` (see `utils/calendarDay.ts` for the reasoning). What is left
 * here is the part that genuinely differs: the wall has two column shapes and
 * renders a 3-to-7 day window, so a `DayExtra` has to be PLACED rather than
 * simply listed.
 */
import { computed, type ComputedRef } from 'vue';
import { useDayExtras } from '@/composables/useDayExtras';
import {
  wallDayReferences,
  wallSharedReferences,
  type WallBandReference,
} from '@/utils/wallActivities';

export function useWallReferenceDays(
  days: ComputedRef<readonly string[]>,
  /**
   * The wall's person filter, or null when everyone is shown. Handed straight to
   * `useDayExtras`, which owns the pets-always-pass rule so it cannot be lost at
   * a call site.
   */
  isMemberVisible?: ComputedRef<((memberId: string) => boolean) | null>
): {
  /** Placed on DAY-shaped columns — the days view and the today view. */
  byDay: ComputedRef<WallBandReference[]>;
  /** Placed across MEMBER-shaped columns for one day — the bean lanes. */
  shared: (
    ymd: ComputedRef<string>,
    columnCount: ComputedRef<number>
  ) => ComputedRef<WallBandReference[]>;
} {
  const { extras } = useDayExtras(
    computed(() => days.value[0] ?? ''),
    computed(() => days.value[days.value.length - 1] ?? ''),
    { isMemberVisible }
  );

  const byDay = computed(() => wallDayReferences(extras.value, days.value));

  const shared = (ymd: ComputedRef<string>, columnCount: ComputedRef<number>) =>
    computed(() => wallSharedReferences(extras.value, ymd.value, columnCount.value));

  return { byDay, shared };
}
