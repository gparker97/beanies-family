import type { Cadence, RecurrenceRule } from '@/types/recurrence';
import {
  addDays,
  addMonths,
  getWeekdayOrdinalInMonth,
  nthWeekdayOfMonth,
  parseLocalDate,
  toDateInputValue,
} from '@/utils/date';

/**
 * Pure recurrence engine — the single occurrence generator for the canonical
 * {@link RecurrenceRule} shared by transactions, activities and lists.
 *
 * Design invariants (see the plan):
 * - **Clock injected.** No function reads `Date.now()`; callers pass the
 *   reference date. This keeps DST/timezone golden tests deterministic and is
 *   resume-safe.
 * - **`afterCount` is stateless-derived** — occurrences are counted from the
 *   anchor on every evaluation, never from a mutable "remaining" counter (which
 *   would drift under Automerge merges).
 * - **Override/split/"this-and-future" logic stays in the activity layer** — the
 *   engine is purely `rule + anchor → dates`; it must not learn activity-only
 *   concepts.
 *
 * Dates are handled as local-midnight `Date`s (via `parseLocalDate`) and returned
 * as `YYYY-MM-DD` strings (via `toDateInputValue`), matching the rest of the app.
 */

// A generous ceiling so an unbounded rule + unbounded caller can never spin
// forever. Range/count-bounded callers stop far below this.
const HARD_CAP = 5000;

function atMidnight(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function daysInMonth(year: number, monthIdx: number): number {
  return new Date(year, monthIdx + 1, 0).getDate();
}

/** The weekday set an occurrence lands on for a week-unit cadence. */
function weekSet(cadence: Cadence, anchor: Date): number[] {
  const interval = Math.max(1, Math.floor(cadence.interval || 1));
  if (interval === 1) {
    const w = cadence.weekdays && cadence.weekdays.length ? cadence.weekdays : [anchor.getDay()];
    return [...new Set(w)].sort((a, b) => a - b);
  }
  // interval >= 2: a single weekday (no multi-day intervals — see the plan).
  const single =
    cadence.weekdays && cadence.weekdays.length ? cadence.weekdays[0]! : anchor.getDay();
  return [single];
}

/** The earliest date on/after `anchor` whose weekday is in `set`. */
function firstWeekOccurrence(set: number[], anchor: Date): Date {
  for (let d = 0; d < 7; d++) {
    const cand = addDays(anchor, d);
    if (set.includes(cand.getDay())) return cand;
  }
  return anchor; // unreachable: set is always non-empty
}

/**
 * Infinite ascending generator of occurrence dates for a cadence, starting at
 * the first occurrence on/after the anchor. Callers MUST bound it (by range,
 * count, or end date) — every public function does.
 */
function* generate(cadence: Cadence, anchor: Date): Generator<Date> {
  const a = atMidnight(anchor);
  const interval = Math.max(1, Math.floor(cadence.interval || 1));

  switch (cadence.unit) {
    case 'day': {
      let d = a;
      for (;;) {
        yield new Date(d);
        d = addDays(d, interval);
      }
    }
    case 'week': {
      const set = weekSet(cadence, a);
      const first = firstWeekOccurrence(set, a);
      const weekStart = addDays(first, -first.getDay()); // Sunday of first's week
      for (let c = 0; ; c++) {
        const base = addDays(weekStart, c * interval * 7);
        for (const wd of set) {
          const occ = addDays(base, wd);
          if (occ >= first) yield new Date(occ);
        }
      }
    }
    case 'month': {
      const useWeekday = cadence.monthlyAnchor === 'weekday';
      const ordinal = useWeekday ? getWeekdayOrdinalInMonth(a) : null;
      const weekday = useWeekday ? a.getDay() : null;
      const isLast = cadence.monthlyDay === 'last';
      const day = typeof cadence.monthlyDay === 'number' ? cadence.monthlyDay : a.getDate();
      const firstOfAnchorMonth = new Date(a.getFullYear(), a.getMonth(), 1);
      for (let m = 0; ; m++) {
        const base = addMonths(firstOfAnchorMonth, m * interval);
        const y = base.getFullYear();
        const mi = base.getMonth();
        let occ: Date;
        if (useWeekday) occ = nthWeekdayOfMonth(base, ordinal!, weekday!);
        else if (isLast) occ = new Date(y, mi, daysInMonth(y, mi));
        else occ = new Date(y, mi, Math.min(day, daysInMonth(y, mi)));
        if (occ >= a) yield new Date(occ);
      }
    }
    case 'year': {
      const month = a.getMonth();
      const day = a.getDate();
      for (let y = 0; ; y++) {
        const year = a.getFullYear() + y * interval;
        const occ = new Date(year, month, Math.min(day, daysInMonth(year, month)));
        if (occ >= a) yield new Date(occ);
      }
    }
  }
}

function endDateBound(rule: RecurrenceRule): Date | null {
  return rule.end.kind === 'onDate' ? parseLocalDate(rule.end.date) : null;
}

/**
 * All occurrences of `rule` (anchored at `anchorYmd`) that fall within
 * `[rangeStartYmd, rangeEndYmd]` inclusive, honoring the rule's end.
 * `afterCount` counts from the anchor, not from the range start.
 */
export function occurrencesInRange(
  rule: RecurrenceRule,
  anchorYmd: string,
  rangeStartYmd: string,
  rangeEndYmd: string
): string[] {
  const anchor = parseLocalDate(anchorYmd);
  const rStart = parseLocalDate(rangeStartYmd);
  const rEnd = parseLocalDate(rangeEndYmd);
  const endBound = endDateBound(rule);
  const out: string[] = [];
  let i = 0;
  let produced = 0;
  for (const occ of generate(rule, anchor)) {
    if (++i > HARD_CAP) break;
    if (endBound && occ > endBound) break;
    produced++;
    if (rule.end.kind === 'afterCount' && produced > rule.end.count) break;
    if (occ > rEnd) break;
    if (occ >= rStart) out.push(toDateInputValue(occ));
  }
  return out;
}

/** The first occurrence strictly AFTER `afterYmd` (the materialization cursor). */
export function nextDueAfter(
  rule: RecurrenceRule,
  anchorYmd: string,
  afterYmd: string
): string | null {
  const anchor = parseLocalDate(anchorYmd);
  const after = parseLocalDate(afterYmd);
  const endBound = endDateBound(rule);
  let i = 0;
  let produced = 0;
  for (const occ of generate(rule, anchor)) {
    if (++i > HARD_CAP) break;
    produced++;
    if (rule.end.kind === 'afterCount' && produced > rule.end.count) return null;
    if (endBound && occ > endBound) return null;
    if (occ > after) return toDateInputValue(occ);
  }
  return null;
}

/** The first occurrence on/after `fromYmd`, honoring the rule's end. */
export function firstDueOnOrAfter(
  rule: RecurrenceRule,
  anchorYmd: string,
  fromYmd: string
): string | null {
  const anchor = parseLocalDate(anchorYmd);
  const from = parseLocalDate(fromYmd);
  const endBound = endDateBound(rule);
  let i = 0;
  let produced = 0;
  for (const occ of generate(rule, anchor)) {
    if (++i > HARD_CAP) break;
    produced++;
    if (rule.end.kind === 'afterCount' && produced > rule.end.count) return null;
    if (endBound && occ > endBound) return null;
    if (occ >= from) return toDateInputValue(occ);
  }
  return null;
}

/** The next `count` occurrences on/after `fromYmd`, honoring the rule's end. */
export function previewNext(
  rule: RecurrenceRule,
  anchorYmd: string,
  fromYmd: string,
  count: number
): string[] {
  const anchor = parseLocalDate(anchorYmd);
  const from = parseLocalDate(fromYmd);
  const endBound = endDateBound(rule);
  const out: string[] = [];
  let i = 0;
  let produced = 0;
  for (const occ of generate(rule, anchor)) {
    if (++i > HARD_CAP) break;
    produced++;
    if (rule.end.kind === 'afterCount' && produced > rule.end.count) break;
    if (endBound && occ > endBound) break;
    if (occ >= from) {
      out.push(toDateInputValue(occ));
      if (out.length >= count) break;
    }
  }
  return out;
}

/**
 * Whether a list reset is due as of `todayYmd`, given the last reset (or the
 * list's start when never reset). Reset cadences use only {@link Cadence}
 * (no end). Weekly cadences honor a chosen weekday; other units step by period.
 */
export function isResetDue(
  cadence: Cadence,
  anchorYmd: string,
  lastResetYmd: string | undefined,
  todayYmd: string
): boolean {
  const from = lastResetYmd ?? anchorYmd;
  // The next scheduled occurrence strictly after the last reset — if today has
  // reached it, a reset is due. Uses the never-ending rule form.
  const next = nextDueAfter({ ...cadence, end: { kind: 'never' } }, anchorYmd, from);
  if (!next) return false;
  return parseLocalDate(todayYmd) >= parseLocalDate(next);
}

const WEEKS_PER_MONTH = 52 / 12; // ≈ 4.345

/**
 * Average occurrences per month — for normalizing a recurring amount to a
 * monthly-equivalent (summary widgets). Backward-compatible with the legacy
 * factors: daily → 30, monthly → 1, yearly → 1/12. Weekly counts the selected
 * weekdays; intervals divide.
 */
export function monthlyFactor(cadence: Cadence): number {
  const interval = Math.max(1, Math.floor(cadence.interval || 1));
  switch (cadence.unit) {
    case 'day':
      return 30 / interval;
    case 'week': {
      const days = cadence.interval === 1 ? Math.max(1, cadence.weekdays?.length ?? 1) : 1;
      return (WEEKS_PER_MONTH * days) / interval;
    }
    case 'month':
      return 1 / interval;
    case 'year':
      return 1 / (12 * interval);
  }
}

/** Structural validity of a rule before it is persisted. */
export function isRuleComplete(rule: RecurrenceRule | null | undefined): rule is RecurrenceRule {
  if (!rule) return false;
  if (!['day', 'week', 'month', 'year'].includes(rule.unit)) return false;
  if (!Number.isInteger(rule.interval) || rule.interval < 1) return false;
  if (rule.unit === 'week' && rule.interval >= 2 && (rule.weekdays?.length ?? 0) > 1) return false;
  if (rule.unit === 'month') {
    if (rule.monthlyAnchor === 'date') {
      const d = rule.monthlyDay;
      if (d !== 'last' && !(typeof d === 'number' && d >= 1 && d <= 28)) return false;
    } else if (rule.monthlyAnchor !== 'weekday') {
      return false;
    }
  }
  if (rule.end.kind === 'afterCount' && (!Number.isInteger(rule.end.count) || rule.end.count < 1)) {
    return false;
  }
  if (rule.end.kind === 'onDate' && !/^\d{4}-\d{2}-\d{2}/.test(rule.end.date)) return false;
  return true;
}
