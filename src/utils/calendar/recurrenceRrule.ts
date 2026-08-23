// Pure mapper: a beanies activity's recurrence → a native Google Calendar RRULE.
//
// We emit a native recurrence (one recurring event + RRULE) rather than expanding
// occurrences into many events (#32 plan, Requirement 8). The per-kind anchor math
// mirrors the in-app planner; the weekday-ordinal helper is reused from date.ts.
//
// NOTE (deferred per plan): the planner's own occurrence math lives in
// `activityStore`; the plan's primary path extracts a shared `activityRecurrence`
// helper behind characterization tests. To avoid a big-bang refactor of the
// planner in v1 we keep this RRULE builder self-contained and reuse only the pure
// `date.ts` anchor helpers (`getWeekdayOrdinalInMonth`). Consolidating the two is
// tracked as follow-up.

import type { ActivityRecurrence, RecurrenceRule } from '@/types/models';
import { getWeekdayOrdinalInMonth, parseLocalDate } from '@/utils/date';

/** RRULE day codes indexed by JS weekday (0=Sun..6=Sat) — matches `daysOfWeek`. */
const RRULE_DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;

export interface RecurrenceInput {
  recurrence: ActivityRecurrence;
  /** Activity start date — `YYYY-MM-DD` (may be a fuller ISO string; only the date part is used). */
  date: string;
  /** Multi-day weekly recurrence (0=Sun..6=Sat). Ignored for non-weekly kinds. */
  daysOfWeek?: number[];
  /** Optional inclusive end date (`YYYY-MM-DD`) → RRULE UNTIL. */
  recurrenceEndDate?: string;
  /** All-day governs the UNTIL value-type (date vs UTC date-time). */
  isAllDay?: boolean;
  /** #70: canonical rule. When present it is authoritative (the legacy fields are ignored). */
  rule?: RecurrenceRule;
}

/** Parse the `YYYY-MM-DD` prefix into a LOCAL Date (no TZ shift), failing loud on a
 *  bad date so a malformed activity never silently produces a wrong RRULE anchor. */
function parseYmd(value: string): Date {
  const date = parseLocalDate(value.slice(0, 10));
  if (Number.isNaN(date.getTime())) {
    throw new Error(`recurrenceRrule: invalid date "${value}" (expected YYYY-MM-DD)`);
  }
  return date;
}

/**
 * Build the `UNTIL=` clause. Google requires the value-type to match DTSTART:
 * all-day master → date (`UNTIL=YYYYMMDD`); timed master → UTC date-time
 * (`UNTIL=YYYYMMDDT235959Z`, end-of-day). A mismatch silently drops the final
 * occurrence (#32 Pass 4). Timezone-exact UNTIL for timed events is a known
 * nuance accepted for v1 (end-of-day UTC is inclusive-safe).
 */
function untilClause(recurrenceEndDate: string, isAllDay: boolean): string {
  const ymd = recurrenceEndDate.slice(0, 10).replace(/-/g, '');
  return isAllDay ? `;UNTIL=${ymd}` : `;UNTIL=${ymd}T235959Z`;
}

/**
 * Map an activity's recurrence to a Google `recurrence` array entry (a single
 * `RRULE:...` string), or `[]` when the activity is non-recurring.
 * Pure. Returns the array Google's events resource expects (`recurrence: [...]`).
 *
 * NOTE: returns `[]` (not `null`) for `'none'` so the mapper ALWAYS sets
 * `resource.recurrence` — an empty array on a `patch` CLEARS a stale RRULE when a
 * recurring activity is edited to a one-off (Google patch is a partial update, so
 * omitting the field would leave the old rule in place). See #32 review F2.
 */
/**
 * #70: serialize a canonical {@link RecurrenceRule} to an RRULE. Thin — the whole
 * per-kind switch here exists because a rule can encode intervals + `afterCount`
 * that the legacy `ActivityRecurrence` enum cannot. Fails loud on a bad date via
 * `parseYmd` (shared with the legacy path).
 */
function ruleToRrule(rule: RecurrenceRule, start: Date, isAllDay: boolean): string[] {
  const parts: string[] = [];
  const interval = rule.interval;
  switch (rule.unit) {
    case 'day':
      parts.push('FREQ=DAILY');
      break;
    case 'week': {
      const days =
        interval === 1
          ? rule.weekdays && rule.weekdays.length
            ? rule.weekdays
            : [start.getDay()]
          : [rule.weekdays?.[0] ?? start.getDay()];
      const byday = days
        .filter((d) => d >= 0 && d <= 6)
        .map((d) => RRULE_DAYS[d])
        .join(',');
      parts.push('FREQ=WEEKLY');
      parts.push(`BYDAY=${byday}`);
      break;
    }
    case 'month':
      parts.push('FREQ=MONTHLY');
      if (rule.monthlyAnchor === 'weekday') {
        parts.push(`BYDAY=${getWeekdayOrdinalInMonth(start)}${RRULE_DAYS[start.getDay()]}`);
      } else {
        parts.push(
          `BYMONTHDAY=${rule.monthlyDay === 'last' ? -1 : (rule.monthlyDay ?? start.getDate())}`
        );
      }
      break;
    case 'year':
      parts.push('FREQ=YEARLY');
      break;
  }
  if (interval > 1) parts.splice(1, 0, `INTERVAL=${interval}`);
  let tail = '';
  if (rule.end.kind === 'onDate') tail = untilClause(rule.end.date, isAllDay);
  else if (rule.end.kind === 'afterCount') tail = `;COUNT=${rule.end.count}`;
  return [`RRULE:${parts.join(';')}${tail}`];
}

export function buildRecurrenceRule(input: RecurrenceInput): string[] {
  // #70: rule-bearing activities serialize the canonical rule; legacy activities
  // keep the exact switch below for byte-parity.
  if (input.rule) return ruleToRrule(input.rule, parseYmd(input.date), input.isAllDay === true);

  const { recurrence } = input;
  if (recurrence === 'none') return [];

  const start = parseYmd(input.date);
  const until =
    input.recurrenceEndDate && input.recurrenceEndDate.trim()
      ? untilClause(input.recurrenceEndDate, input.isAllDay === true)
      : '';

  let rule: string;
  switch (recurrence) {
    case 'daily':
      rule = 'FREQ=DAILY';
      break;
    case 'weekly': {
      const days =
        input.daysOfWeek && input.daysOfWeek.length > 0 ? input.daysOfWeek : [start.getDay()];
      const byday = days
        .filter((d) => d >= 0 && d <= 6)
        .map((d) => RRULE_DAYS[d])
        .join(',');
      rule = `FREQ=WEEKLY;BYDAY=${byday}`;
      break;
    }
    case 'biweekly':
      // Single day-of-week anchored to start, step 14 days (daysOfWeek ignored — see model).
      rule = `FREQ=WEEKLY;INTERVAL=2;BYDAY=${RRULE_DAYS[start.getDay()]}`;
      break;
    case 'monthly':
      rule = `FREQ=MONTHLY;BYMONTHDAY=${start.getDate()}`;
      break;
    case 'monthly-by-day': {
      const ordinal = getWeekdayOrdinalInMonth(start); // 1..4 or -1 (last)
      rule = `FREQ=MONTHLY;BYDAY=${ordinal}${RRULE_DAYS[start.getDay()]}`;
      break;
    }
    case 'yearly':
      rule = 'FREQ=YEARLY';
      break;
    default: {
      // Exhaustiveness guard — a new ActivityRecurrence kind must be handled here.
      const _exhaustive: never = recurrence;
      throw new Error(`recurrenceRrule: unhandled recurrence kind "${_exhaustive}"`);
    }
  }

  return [`RRULE:${rule}${until}`];
}
