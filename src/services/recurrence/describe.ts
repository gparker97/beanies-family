import type { RecurrenceRule } from '@/types/recurrence';
import type { UIStringKey } from '@/services/translation/uiStrings';
import { fillTemplate } from '@/utils/fillTemplate';
import { getOrdinalSuffix } from '@/utils/format';
import {
  parseLocalDate,
  getWeekdayOrdinalInMonth,
  formatDate,
  formatDateShort,
} from '@/utils/date';

/**
 * The single canonical plain-language summary of a {@link RecurrenceRule} —
 * used by the picker's live readout and by `useRecurrenceLabel` (which is the
 * one resolver that replaces the three old `formatFrequency`/
 * `formatActivityRecurrence` implementations). Pure; takes `t` so it stays
 * translation-store-agnostic. Anchors (day-of-month, nth-weekday, yearly date)
 * derive from `anchorYmd`.
 */

type T = (key: UIStringKey) => string;

/** Short weekday i18n keys, Sunday-first (JS `Date.getDay()`). Shared so the
 *  picker, summary and RRULE never drift on weekday labelling. */
export const WEEKDAY_SHORT: readonly UIStringKey[] = [
  'planner.weekday.short.sun',
  'planner.weekday.short.mon',
  'planner.weekday.short.tue',
  'planner.weekday.short.wed',
  'planner.weekday.short.thu',
  'planner.weekday.short.fri',
  'planner.weekday.short.sat',
];

function joinWeekdays(list: number[] | undefined, anchorYmd: string, t: T): string {
  const set = list && list.length ? list : [parseLocalDate(anchorYmd).getDay()];
  return [...new Set(set)]
    .sort((a, b) => a - b)
    .map((d) => t(WEEKDAY_SHORT[d]!))
    .join(', ');
}

export function describeRule(rule: RecurrenceRule, anchorYmd: string, t: T): string {
  const n = rule.interval;
  let core = '';
  // A malformed anchor must never crash a render. `getWeekdayOrdinalInMonth`
  // THROWS on an invalid Date, and this now runs inside list/card templates
  // (`ActivityListCard`, `ListTile`) where an activity with a bad `date` — a
  // state `expandRecurring` already reports-and-skips, so it exists in the wild
  // — would tear the whole list down. The deleted `formatActivityRecurrence`
  // guarded this explicitly; keep the guarantee.
  if (Number.isNaN(parseLocalDate(anchorYmd).getTime())) {
    return t('planner.recurrence.none');
  }

  switch (rule.unit) {
    case 'day':
      core =
        n === 1 ? t('recurrence.desc.daily') : fillTemplate(t('recurrence.desc.everyNDays'), { n });
      break;
    case 'week':
      core =
        n === 1
          ? fillTemplate(t('recurrence.desc.weeklyOn'), {
              days: joinWeekdays(rule.weekdays, anchorYmd, t),
            })
          : fillTemplate(t('recurrence.desc.everyNWeeksOn'), {
              n,
              days: joinWeekdays(rule.weekdays, anchorYmd, t),
            });
      break;
    case 'month': {
      const anchor = parseLocalDate(anchorYmd);
      if (rule.monthlyAnchor === 'weekday') {
        const ordinal = getOrdinalSuffix(getWeekdayOrdinalInMonth(anchor));
        const day = t(WEEKDAY_SHORT[anchor.getDay()]!);
        core =
          n === 1
            ? fillTemplate(t('recurrence.desc.monthlyOnDay'), { ordinal, day })
            : fillTemplate(t('recurrence.desc.everyNMonthsOnDay'), { n, ordinal, day });
      } else {
        const dateLabel =
          rule.monthlyDay === 'last'
            ? t('recurrence.desc.lastDay')
            : getOrdinalSuffix(
                typeof rule.monthlyDay === 'number' ? rule.monthlyDay : anchor.getDate()
              );
        core =
          n === 1
            ? fillTemplate(t('recurrence.desc.monthlyOnDate'), { date: dateLabel })
            : fillTemplate(t('recurrence.desc.everyNMonthsOnDate'), { n, date: dateLabel });
      }
      break;
    }
    case 'year': {
      const date = formatDateShort(anchorYmd);
      core =
        n === 1
          ? fillTemplate(t('recurrence.desc.yearlyOn'), { date })
          : fillTemplate(t('recurrence.desc.everyNYearsOn'), { n, date });
      break;
    }
  }

  if (rule.end.kind === 'onDate') {
    core += ` · ${fillTemplate(t('recurrence.desc.untilDate'), { date: formatDate(rule.end.date) })}`;
  } else if (rule.end.kind === 'afterCount') {
    core += ` · ${fillTemplate(t('recurrence.desc.timesN'), { n: rule.end.count })}`;
  }
  return core;
}
