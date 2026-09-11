/**
 * The reference days the beanie wall's all-day band shows beside the family's
 * own events: family birthdays and public holidays.
 *
 * ## Why a composable, and why all three views share it
 *
 * The wall has three calendar views with two different column shapes, and the
 * bug that produced this file was a surface being missed. So the stores, the
 * wording and the placement are resolved in ONE place and each view asks for the
 * shape it has — rather than three views each remembering to read two stores and
 * format two labels.
 *
 * It is also the only layer here that is impure. `wallDayReferences` and
 * `wallSharedReferences` place already-labelled items; this resolves the labels
 * and the data, so the placement stays testable without a Pinia or a translator.
 *
 * ## Both sources respect their existing settings
 *
 * `holidaysInRange` returns nothing when the family has hidden public holidays
 * or set no country, so the wall inherits that preference with no extra wiring.
 * Birthdays come from members' own `dateOfBirth`, which is optional and simply
 * absent for anyone who has not set one.
 */
import { computed, type ComputedRef } from 'vue';
import { useFamilyStore } from '@/stores/familyStore';
import { useHolidayStore } from '@/stores/holidayStore';
import { useTranslation } from '@/composables/useTranslation';
import { birthdaysInRange, birthdayLabel, birthdayPassesFilter } from '@/utils/birthdays';
import {
  wallDayReferences,
  wallSharedReferences,
  type WallBandReference,
  type WallReferenceDay,
} from '@/utils/wallActivities';

export function useWallReferenceDays(
  days: ComputedRef<readonly string[]>,
  /**
   * The wall's person filter, or null when everyone is shown. A birthday is
   * ABOUT a member, so it follows the filter exactly as that member's events do
   * — otherwise narrowing the wall to one bean left the others' birthdays on
   * screen with none of their events. Public holidays belong to nobody and
   * correctly ignore it.
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
  const familyStore = useFamilyStore();
  const holidayStore = useHolidayStore();
  const { t } = useTranslation();

  /** Every reference day in the visible window, labelled and sorted. */
  const references = computed<WallReferenceDay[]>(() => {
    const window = days.value;
    if (window.length === 0) return [];
    const first = window[0]!;
    const last = window[window.length - 1]!;

    const out: WallReferenceDay[] = [];

    const visible = isMemberVisible?.value ?? null;
    for (const b of birthdaysInRange(familyStore.members, first, last)) {
      if (!birthdayPassesFilter(b, visible)) continue;
      out.push({
        kind: 'birthday',
        id: `b:${b.memberId}:${b.date}`,
        ymd: b.date,
        label: birthdayLabel(b, t),
        emoji: '🎂',
      });
    }

    for (const h of holidayStore.holidaysInRange(first, last)) {
      out.push({
        kind: 'holiday',
        id: `h:${h.name}:${h.date}`,
        ymd: h.date,
        // Same shape as `HolidayChip` and `HolidayBanner`, so the kitchen screen
        // and the phone name the day identically.
        label: `${h.name} (${h.countryCode})`,
      });
    }

    // Birthdays before holidays on a shared date: one is about somebody in this
    // family, the other is about the country.
    out.sort(
      (a, b) =>
        a.ymd.localeCompare(b.ymd) ||
        (a.kind === b.kind ? a.label.localeCompare(b.label) : a.kind === 'birthday' ? -1 : 1)
    );
    return out;
  });

  const byDay = computed(() => wallDayReferences(references.value, days.value));

  const shared = (ymd: ComputedRef<string>, columnCount: ComputedRef<number>) =>
    computed(() => wallSharedReferences(references.value, ymd.value, columnCount.value));

  return { byDay, shared };
}
