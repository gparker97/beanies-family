import type { RecurringItem, RecurrenceRule, RecurrenceEnd } from '@/types/models';
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
      const start = parseLocalDate(startYmd);
      const month = (item.monthOfYear ?? 1) - 1;
      const anchor = toDateInputValue(new Date(start.getFullYear(), month, item.dayOfMonth));
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
