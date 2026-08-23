import type {
  RecurringItem,
  RecurrenceRule,
  RecurrenceEnd,
  FamilyActivity,
  ActivityRecurrence,
  FamilyList,
  ListFrequency,
  Cadence,
} from '@/types/models';
import { extractDatePart, toDateInputValue, parseLocalDate } from '@/utils/date';
import { logEvent } from '@/services/telemetry/logEvent';

/** One place to record a stored recurrence shape that fell outside the model. */
function reportUnmappable(surface: 'transaction' | 'activity' | 'list', reason: string): null {
  logEvent({
    level: 'warn',
    surface: 'recurrence',
    message: 'rule-adapter-fallback',
    context: { recur_surface: surface, recur_reason: reason },
  });
  return null;
}

/**
 * Legacy → canonical adapters (#70). A rule-bearing entity is authoritative;
 * an entity without a `rule` is read through here so existing `.beanpod` data
 * keeps working with no at-rest migration. Every read of a legacy recurrence
 * field should go through a `resolve*` function — never read the deprecated
 * fields directly elsewhere.
 *
 * ── The resolver contract ───────────────────────────────────────────────────
 * All three surfaces share ONE signature: `(entity) => ResolvedRule | null`.
 * The anchor rides WITH the rule because every engine entry point takes
 * `(rule, anchorYmd)` and the anchor is not always the entity's obvious start
 * date — a legacy yearly `RecurringItem` rebuilds it from `monthOfYear`/
 * `dayOfMonth`. Bundling them makes anchor bugs structurally impossible.
 *
 * `null` carries two meanings, by surface:
 *   • activities / lists — the entity does not recur (one-time / one-off).
 *   • transactions — a `RecurringItem` always recurs, so `null` can only mean
 *     the stored shape was unmappable. Callers must decide explicitly:
 *     `normalizeToMonthly` → the raw amount; `budgetStore` → omit the row;
 *     `recurringProcessor` → fall through to its legacy switch.
 * Every `null` from an unmappable value logs `rule-adapter-fallback` first, so
 * a shape outside the model is never silently swallowed.
 *
 * ── The shadow fidelity contract ────────────────────────────────────────────
 * A rule-bearing entity also carries legacy "shadow" fields so a pre-#70 client
 * (and any not-yet-converted reader) still sees something sane. Which shadow
 * fields are TRUSTWORTHY is fixed:
 *   FAITHFUL for every rule — `recurrence !== 'none'` (recurs at all);
 *     `recurrenceEndDate` (written iff `end.kind === 'onDate'`);
 *     `RecurringItem.frequency === 'yearly'` iff `unit === 'year'` AND
 *     `interval === 1`; `FamilyList.frequency` PRESENCE; and `daysOfWeek` is
 *     always ASSIGNED (possibly `undefined`), never omitted, so a diff can
 *     clear it.
 *   LOSSY — the `recurrence` KIND (`week/3` shadows as `'biweekly'`);
 *     `daysOfWeek`; the specific `ListFrequency`;
 *     `RecurringItem.dayOfMonth` for non-monthly rules.
 * THE RULE: a reader must become rule-aware iff it depends on a LOSSY field.
 * Readers touching only faithful fields are correct by construction and are
 * deliberately left alone (e.g. `reconcilePlan.activityInWindow`).
 *
 * ── Cross-client tie-break ──────────────────────────────────────────────────
 * rule/cadence WINS. The shadow is write-only from #70 clients and is never
 * read back on a rule-bearing entity — so an old client editing one writes only
 * the shadow, which a new client then ignores.
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
export function resolveTransactionRule(item: RecurringItem): ResolvedRule | null {
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
      return { rule: { unit: 'day', interval: 1, end }, anchor: startYmd };
    default:
      // A `RecurringItem` always recurs, so this can only be an unmappable
      // stored value. Previously it fell through to DAILY here while
      // `recurringStore.normalizeToMonthly` defaulted the same input to
      // MONTHLY — a silent 30x disagreement. Now it is reported, and each
      // caller decides explicitly.
      return reportUnmappable('transaction', 'unknown-frequency');
  }
}

/**
 * Best-effort legacy shadow of a canonical rule — used ONLY to satisfy
 * `RecurringItem`'s required `frequency`/`dayOfMonth` schema when persisting a
 * rule-bearing item. It is INERT: `resolveTransactionRule` reads `rule` first,
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
  // `'last'` is a label variant of day 31 (see RecurrenceRule.monthlyDay) —
  // normalize it here, or a `'last'` monthly rule would fall through to the
  // inert placeholder below and shadow as a WRONG dayOfMonth.
  const monthlyDay = rule.monthlyDay === 'last' ? 31 : rule.monthlyDay;
  // `interval === 1` is REQUIRED here. Without it an every-3-months rule shadows
  // as an indistinguishable, genuine-looking `frequency: 'monthly'` — unlike the
  // week/every-N cases, which land on the visibly-inert placeholder below. A
  // quarterly premium would then be counted as a monthly one by every
  // shadow-reading surface.
  if (
    rule.unit === 'month' &&
    rule.interval === 1 &&
    rule.monthlyAnchor === 'date' &&
    typeof monthlyDay === 'number'
  ) {
    return { frequency: 'monthly', dayOfMonth: monthlyDay };
  }
  if (rule.unit === 'year' && rule.interval === 1) {
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

export type ActivityRecurrenceFields = Pick<
  FamilyActivity,
  'recurrence' | 'date' | 'daysOfWeek' | 'recurrenceEndDate' | 'rule'
>;

/**
 * Resolve an activity to its canonical rule — `rule` first, else derived from
 * the legacy `recurrence`/`daysOfWeek`/`recurrenceEndDate`. Returns `null` for a
 * one-time activity (`recurrence: 'none'` and no rule). Used by the picker (to
 * load a legacy activity) and by `describeActivity`; the EXACT legacy expansion
 * + RRULE paths stay on their own switches for byte-parity. Monthly-on-date is
 * taken verbatim (1–31) — the engine's clamp matches legacy activity
 * generation exactly, so no cap is needed.
 */
export function resolveActivityRule(activity: ActivityRecurrenceFields): ResolvedRule | null {
  const anchorYmd = extractDatePart(activity.date);
  if (activity.rule) return { rule: activity.rule, anchor: anchorYmd };
  if (activity.recurrence === 'none') return null;
  const anchor = parseLocalDate(anchorYmd);
  const end: RecurrenceEnd = activity.recurrenceEndDate
    ? { kind: 'onDate', date: extractDatePart(activity.recurrenceEndDate) }
    : { kind: 'never' };
  const at = (rule: RecurrenceRule): ResolvedRule => ({ rule, anchor: anchorYmd });
  switch (activity.recurrence) {
    case 'daily':
      return at({ unit: 'day', interval: 1, end });
    case 'weekly':
      return at({
        unit: 'week',
        interval: 1,
        weekdays: activity.daysOfWeek?.length ? [...activity.daysOfWeek] : [anchor.getDay()],
        end,
      });
    case 'biweekly':
      return at({ unit: 'week', interval: 2, weekdays: [anchor.getDay()], end });
    case 'monthly':
      // Verbatim day (1–31). The engine CLAMPS a month lacking the day to its
      // last day, which is byte-exact with legacy activity generation
      // (expandMonthlyByDate) — so this needs no cap and loses no fidelity.
      return at({
        unit: 'month',
        interval: 1,
        monthlyAnchor: 'date',
        monthlyDay: anchor.getDate(),
        end,
      });
    case 'monthly-by-day':
      return at({ unit: 'month', interval: 1, monthlyAnchor: 'weekday', end });
    case 'yearly':
      return at({ unit: 'year', interval: 1, end });
    default:
      // Exhaustive over `ActivityRecurrence` — but this reads `.beanpod` data at
      // rest, so a legacy or corrupt value must degrade loudly, not return
      // `undefined` while the signature promises `ResolvedRule | null`.
      // (`assertNever` would THROW, which is unacceptable from a render path.)
      return reportUnmappable('activity', 'unknown-recurrence');
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
  // `daysOfWeek` is ALWAYS assigned, never omitted. `diffPayload` iterates
  // `Object.keys(next)`, so an absent key means "leave untouched" — omitting it
  // would strand a stale `[1,3]` on an activity edited from weekly to monthly,
  // which then permanently refuses a series-scope move (the multi-weekday guard)
  // and poisons the Google push hash.
  switch (rule.unit) {
    case 'day':
      return { recurrence: 'daily', daysOfWeek: undefined, recurrenceEndDate };
    case 'week':
      // ANY interval >= 2 shadows as 'biweekly' with no daysOfWeek — matching
      // legacy biweekly semantics (anchor weekday, 14-day step). `interval >= 3`
      // has no faithful legacy representation — see the shadow fidelity contract.
      return rule.interval >= 2
        ? { recurrence: 'biweekly', daysOfWeek: undefined, recurrenceEndDate }
        : {
            recurrence: 'weekly',
            daysOfWeek: rule.weekdays ? [...rule.weekdays] : undefined,
            recurrenceEndDate,
          };
    case 'month':
      return {
        recurrence: rule.monthlyAnchor === 'weekday' ? 'monthly-by-day' : 'monthly',
        daysOfWeek: undefined,
        recurrenceEndDate,
      };
    case 'year':
      return { recurrence: 'yearly', daysOfWeek: undefined, recurrenceEndDate };
  }
}

// ── Lists (#70 Phase C) ──────────────────────────────────────────────────────

type ListCadenceFields = Pick<FamilyList, 'lifecycle' | 'frequency' | 'cadence' | 'createdAt'>;

/**
 * Resolve a list to its canonical reset rule + anchor.
 *
 * A list RESETS on a cadence rather than materializing occurrences, so it
 * stores a bare `Cadence`. This wraps it in an `end: 'never'` rule so the whole
 * engine and `describeRule` work on it unchanged — the shim lives here, once,
 * instead of at every call site.
 *
 * ANCHOR vs CURSOR: the anchor is `createdAt`, NOT `lastResetDate`. They are
 * separate parameters to `isResetDue` for a reason — anchoring on the last
 * reset would re-anchor the cycle every time it fires, so an every-2-weeks list
 * would drift forward whenever the family didn't open the app on the due day.
 *
 * Returns `null` when the list does not recur, or when a recurring list has
 * NEITHER `cadence` NOR `frequency`. It deliberately does not default to weekly:
 * a list that never resets today must not suddenly start. (This subsumes the
 * `!list.frequency` guard in `computeRecurringReset`.)
 *
 * The legacy mapping is exact, verified against `listLifecycle.computeRecurringReset`:
 *   daily   `today > last`                        → day/1
 *   weekly  `mondayOf(today) > mondayOf(last)`    → week/1 on MONDAY
 *   monthly `monthKey(today) > monthKey(last)`    → month/1 on the 1st
 */
export function resolveListRule(list: ListCadenceFields): ResolvedRule | null {
  if (list.lifecycle !== 'recurring') return null;
  const anchor = extractDatePart(list.createdAt);
  const asRule = (cadence: Cadence): ResolvedRule => ({
    rule: { ...cadence, end: { kind: 'never' } },
    anchor,
  });

  if (list.cadence) return asRule(list.cadence);
  switch (list.frequency) {
    case 'daily':
      return asRule({ unit: 'day', interval: 1 });
    case 'weekly':
      // Monday, matching the legacy ISO-week boundary — NOT the list's creation
      // weekday, which would silently move every existing list's reset day.
      return asRule({ unit: 'week', interval: 1, weekdays: [1] });
    case 'monthly':
      return asRule({ unit: 'month', interval: 1, monthlyAnchor: 'date', monthlyDay: 1 });
    case undefined:
      return null; // never resets — preserved exactly
    default:
      return reportUnmappable('list', 'unknown-frequency');
  }
}

/**
 * Legacy `ListFrequency` shadow of a cadence, for pre-#70 clients.
 *
 * Returns `undefined` for any cadence the three-value enum cannot express
 * EXACTLY. That asymmetry is deliberate and safety-driven: a list reset is
 * DESTRUCTIVE (it clears every item's completion), and there is nothing slower
 * than `'monthly'` in the enum — so approximating `every 2 weeks` as `'weekly'`,
 * or `yearly` as `'monthly'`, would make an old client wipe the family's ticks
 * more often than they asked. Under-resetting leaves a stale checklist someone
 * can clear by hand; over-resetting destroys work with no undo. An omitted
 * `frequency` makes an old client never reset the list, which is the safe error.
 */
export function listShadowFromCadence(cadence: Cadence): ListFrequency | undefined {
  if (cadence.interval !== 1) return undefined;
  if (cadence.unit === 'day') return 'daily';
  if (cadence.unit === 'week') {
    // Legacy weekly resets once a week on the Monday boundary. Only a
    // single-weekday Monday cadence means the same thing.
    const days = cadence.weekdays ?? [];
    return days.length === 1 && days[0] === 1 ? 'weekly' : undefined;
  }
  if (cadence.unit === 'month') {
    return cadence.monthlyAnchor !== 'weekday' && cadence.monthlyDay === 1 ? 'monthly' : undefined;
  }
  return undefined; // yearly has no legacy equivalent
}
