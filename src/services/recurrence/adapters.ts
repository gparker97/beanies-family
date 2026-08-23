import type {
  RecurringItem,
  RecurrenceRule,
  RecurrenceEnd,
  FamilyActivity,
  ActivityRecurrence,
} from '@/types/models';
import { extractDatePart, toDateInputValue, parseLocalDate } from '@/utils/date';

/**
 * Legacy → canonical adapters (#70). A rule-bearing entity is authoritative;
 * an entity without a `rule` is read through here so existing `.beanpod` data
 * keeps working with no at-rest migration. See the plan's backward-compat
 * section. Every read of a legacy recurrence field should go through a
 * `resolve*` function — never read the deprecated fields directly elsewhere.
 */

/** A rule plus the anchor date the engine should expand it from. */
export interface ResolvedRule {
  rule: RecurrenceRule;
  anchor: string; // YYYY-MM-DD
}

function endFrom(endDate: string | undefined): RecurrenceEnd {
  return endDate ? { kind: 'onDate', date: extractDatePart(endDate) } : { kind: 'never' };
}

/**
 * Resolve a `RecurringItem` to its canonical rule + anchor.
 * - `item.rule` present → authoritative (anchor = the item's start date).
 * - else → derive from the legacy `frequency`/`dayOfMonth`/`monthOfYear`.
 *   Yearly's anchor is rebuilt from `monthOfYear`/`dayOfMonth` (which can differ
 *   from `startDate`) so the engine's date-derived yearly matches the legacy
 *   processor exactly.
 */
export function resolveRecurringItemRule(item: RecurringItem): ResolvedRule {
  const startYmd = extractDatePart(item.startDate);
  if (item.rule) return { rule: item.rule, anchor: startYmd };

  const end = endFrom(item.endDate);
  switch (item.frequency) {
    case 'monthly':
      return {
        rule: {
          unit: 'month',
          interval: 1,
          monthlyAnchor: 'date',
          monthlyDay: item.dayOfMonth,
          end,
        },
        anchor: startYmd,
      };
    case 'yearly': {
      const y = parseLocalDate(startYmd).getFullYear();
      const month = (item.monthOfYear ?? 1) - 1;
      // Clamp the day to the month's length so an impossible (month, day) — e.g.
      // Feb 29 in a non-leap start year — does NOT JS-overflow into the next
      // month (which would mislabel + mis-anchor the series).
      const maxDay = new Date(y, month + 1, 0).getDate();
      const anchor = toDateInputValue(new Date(y, month, Math.min(item.dayOfMonth, maxDay)));
      return { rule: { unit: 'year', interval: 1, end }, anchor };
    }
    case 'daily':
    default:
      return { rule: { unit: 'day', interval: 1, end }, anchor: startYmd };
  }
}

/**
 * Best-effort legacy shadow of a canonical rule — used ONLY to satisfy
 * `RecurringItem`'s required `frequency`/`dayOfMonth` schema when persisting a
 * rule-bearing item. It is INERT: `resolveRecurringItemRule` reads `rule` first,
 * so these fields never drive behavior once `rule` is present. Rules the legacy
 * shape cannot express (weekly, biweekly, every-N, monthly-by-weekday) fall back
 * to harmless defaults; a pre-#70 client would misread them, but downgrade is
 * already unsupported for new-capability rules (see the plan — no dual-write of
 * meaning, only this schema shim).
 */
export function legacyShadowFromRule(
  rule: RecurrenceRule,
  anchorYmd: string
): { frequency: RecurringItem['frequency']; dayOfMonth: number; monthOfYear?: number } {
  const anchor = parseLocalDate(anchorYmd);
  if (
    rule.unit === 'month' &&
    rule.monthlyAnchor === 'date' &&
    typeof rule.monthlyDay === 'number'
  ) {
    return { frequency: 'monthly', dayOfMonth: rule.monthlyDay };
  }
  if (rule.unit === 'year') {
    return {
      frequency: 'yearly',
      dayOfMonth: Math.min(anchor.getDate(), 28),
      monthOfYear: anchor.getMonth() + 1,
    };
  }
  if (rule.unit === 'day' && rule.interval === 1) {
    return { frequency: 'daily', dayOfMonth: Math.min(anchor.getDate(), 28) };
  }
  // Non-representable in the legacy shape — inert placeholder (rule is authoritative).
  return { frequency: 'monthly', dayOfMonth: Math.min(anchor.getDate(), 28) };
}

// ── Activities (#70 Phase B) ─────────────────────────────────────────────────

type ActivityRecurrenceFields = Pick<
  FamilyActivity,
  'recurrence' | 'date' | 'daysOfWeek' | 'recurrenceEndDate' | 'rule'
>;

/**
 * Resolve an activity to its canonical rule — `rule` first, else derived from
 * the legacy `recurrence`/`daysOfWeek`/`recurrenceEndDate`. Returns `null` for a
 * one-time activity (`recurrence: 'none'` and no rule). Used by the picker (to
 * load a legacy activity) and by `describeActivity`; the EXACT legacy expansion
 * + RRULE paths stay on their own switches for byte-parity (this adapter caps
 * monthly-on-date at 28/last, which only matters on edit of a rare 29–31 item).
 */
export function activityRuleAdapter(activity: ActivityRecurrenceFields): RecurrenceRule | null {
  if (activity.rule) return activity.rule;
  if (activity.recurrence === 'none') return null;
  const anchor = parseLocalDate(extractDatePart(activity.date));
  const end: RecurrenceEnd = activity.recurrenceEndDate
    ? { kind: 'onDate', date: extractDatePart(activity.recurrenceEndDate) }
    : { kind: 'never' };
  switch (activity.recurrence) {
    case 'daily':
      return { unit: 'day', interval: 1, end };
    case 'weekly':
      return {
        unit: 'week',
        interval: 1,
        weekdays: activity.daysOfWeek?.length ? [...activity.daysOfWeek] : [anchor.getDay()],
        end,
      };
    case 'biweekly':
      return { unit: 'week', interval: 2, weekdays: [anchor.getDay()], end };
    case 'monthly':
      // Verbatim day (1–31) for a faithful label; the engine skips months lacking
      // it. (Legacy activity generation clamps instead of skips — reconciled when
      // the ActivityModal UI adopts the picker; today this adapter is display-only.)
      return {
        unit: 'month',
        interval: 1,
        monthlyAnchor: 'date',
        monthlyDay: anchor.getDate(),
        end,
      };
    case 'monthly-by-day':
      return { unit: 'month', interval: 1, monthlyAnchor: 'weekday', end };
    case 'yearly':
      return { unit: 'year', interval: 1, end };
  }
}

/**
 * Legacy shadow of a rule for `FamilyActivity` — satisfies the required
 * `recurrence` enum + `daysOfWeek`/`recurrenceEndDate` when persisting a
 * rule-bearing activity. INERT: `expandRecurring`/RRULE read `rule` first when
 * present. Rules the legacy enum can't express (every-N-weeks/months) fall back
 * to the nearest kind (a pre-#70 client would approximate them).
 */
export function activityShadowFromRule(rule: RecurrenceRule): {
  recurrence: ActivityRecurrence;
  daysOfWeek?: number[];
  recurrenceEndDate?: string;
} {
  const recurrenceEndDate = rule.end.kind === 'onDate' ? rule.end.date : undefined;
  switch (rule.unit) {
    case 'day':
      return { recurrence: 'daily', recurrenceEndDate };
    case 'week':
      return rule.interval === 2
        ? { recurrence: 'biweekly', recurrenceEndDate }
        : {
            recurrence: 'weekly',
            daysOfWeek: rule.weekdays ? [...rule.weekdays] : undefined,
            recurrenceEndDate,
          };
    case 'month':
      return {
        recurrence: rule.monthlyAnchor === 'weekday' ? 'monthly-by-day' : 'monthly',
        recurrenceEndDate,
      };
    case 'year':
      return { recurrence: 'yearly', recurrenceEndDate };
  }
}
