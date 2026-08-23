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
      // WKST is load-bearing for INTERVAL >= 2 (#70). RFC 5545 defaults it to
      // MO, but the engine anchors the N-week cycle on the ANCHOR'S SUNDAY
      // (`recurrenceEngine.generate`, week branch). Without this the two produce
      // permanently disjoint sets 7 days apart whenever the chosen weekday falls
      // earlier in the Sunday-week than the anchor's weekday. Emitted only for
      // intervals that actually skip weeks — WKST has no effect at INTERVAL=1
      // and would be noise on every existing weekly export.
      if (interval > 1) parts.push('WKST=SU');
      break;
    }
    case 'month':
      parts.push('FREQ=MONTHLY');
      if (rule.monthlyAnchor === 'weekday') {
        parts.push(`BYDAY=${getWeekdayOrdinalInMonth(start)}${RRULE_DAYS[start.getDay()]}`);
      } else {
        // The engine CLAMPS a numeric day a month lacks to that month's last
        // day (#70). Google must do the same or the two diverge: per RFC 5545
        // `BYMONTHDAY=31` SKIPS February outright, so a naive serialization
        // would show Feb 28 in beanies and nothing at all in the family's
        // calendar. `BYMONTHDAY=28,..,N` + `BYSETPOS=-1` selects the last of
        // the days that actually exist in each month — exactly the clamp.
        // Day 31 (and 'last') collapse to the simpler `BYMONTHDAY=-1`.
        const day = rule.monthlyDay === 'last' ? 31 : (rule.monthlyDay ?? start.getDate());
        if (day >= 31) {
          parts.push('BYMONTHDAY=-1');
        } else if (day > 28) {
          const candidates = [];
          for (let d = 28; d <= day; d++) candidates.push(d);
          parts.push(`BYMONTHDAY=${candidates.join(',')}`);
          parts.push('BYSETPOS=-1');
        } else {
          parts.push(`BYMONTHDAY=${day}`);
        }
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
      // `WKST=SU` is a no-op here (BYDAY *is* the start's weekday, so every week
      // start gives the same dates) but is emitted for consistency with the rule
      // path, which needs it — see `ruleToRrule`. Keeping both identical also
      // preserves the legacy-vs-rule byte-parity oracle in the tests.
      rule = `FREQ=WEEKLY;INTERVAL=2;BYDAY=${RRULE_DAYS[start.getDay()]};WKST=SU`;
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
