/**
 * THE one query for what a day carries besides the family's own activities:
 * birthdays, public holidays, and (where a surface wants them) trips.
 *
 * Every calendar surface calls this. That is the point — see `utils/calendarDay.ts`
 * for why the planner and the beanie wall drifted, and why the fix is one query
 * with two renderers rather than one shared component.
 *
 * This is the impure half: it reads the stores and resolves the wording. The
 * bucketing, ordering and placement stay pure next door so they can be tested
 * without a Pinia or a translator.
 *
 * ## Both sources keep their own existing gates
 *
 * `holidaysInRange` already returns nothing when the family has hidden public
 * holidays or has set no country, so every surface inherits that preference with
 * no extra wiring. Birthdays come from members' own `dateOfBirth`, which is
 * optional and simply absent for anyone who has not set one.
 */
import { computed, type ComputedRef } from 'vue';
import { useFamilyStore } from '@/stores/familyStore';
import { useHolidayStore } from '@/stores/holidayStore';
import { useTranslation } from '@/composables/useTranslation';
import { birthdaysInRange, birthdayLabel, birthdayPassesFilter } from '@/utils/birthdays';
import { sortDayExtras, dayExtrasByDate, type DayExtra } from '@/utils/calendarDay';

export interface DayExtrasOptions {
  /**
   * The surface's person filter, or null when everyone is shown. A birthday is
   * ABOUT a member, so it follows that member exactly as their activities do.
   * Public holidays belong to nobody and correctly ignore it.
   *
   * Pets ALWAYS pass regardless — see `birthdayPassesFilter`, which is named
   * rather than inlined precisely so that rule cannot be lost at a call site.
   */
  isMemberVisible?: ComputedRef<((memberId: string) => boolean) | null>;
}

export function useDayExtras(
  /** Inclusive window. A single-day surface passes the same date twice. */
  startYmd: ComputedRef<string>,
  endYmd: ComputedRef<string>,
  options: DayExtrasOptions = {}
): {
  /** Everything in the window, ordered. */
  extras: ComputedRef<DayExtra[]>;
  /** The same, bucketed by date. */
  byDate: ComputedRef<Map<string, DayExtra[]>>;
} {
  const familyStore = useFamilyStore();
  const holidayStore = useHolidayStore();
  const { t } = useTranslation();

  const extras = computed<DayExtra[]>(() => {
    const first = startYmd.value;
    const last = endYmd.value;
    if (!first || !last || last < first) return [];

    const visible = options.isMemberVisible?.value ?? null;
    const out: DayExtra[] = [];

    for (const b of birthdaysInRange(familyStore.members, first, last)) {
      if (!birthdayPassesFilter(b, visible)) continue;
      out.push({
        kind: 'birthday',
        id: `b:${b.memberId}:${b.date}`,
        ymd: b.date,
        label: birthdayLabel(b, t),
        emoji: '🎂',
        birthday: b,
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
        holiday: h,
      });
    }

    return sortDayExtras(out);
  });

  return { extras, byDate: computed(() => dayExtrasByDate(extras.value)) };
}
