import type { Cadence, RecurrenceRule } from '@/types/recurrence';
import { occurrencesInRange } from '@/services/recurrence/recurrenceEngine';

/**
 * Cadence helpers: the conversions and identity keys between a bare
 * {@link Cadence} (the shape of a repetition) and a full {@link RecurrenceRule}
 * (a cadence plus an end). Pure, so every surface that compares or converts a
 * schedule shares one definition instead of a private copy.
 */

/** The cadence of a rule: every field except `end`. */
export function cadenceOf(rule: RecurrenceRule): Cadence {
  const cadence: Cadence & { end?: unknown } = { ...rule };
  delete cadence.end;
  return cadence;
}

/** A cadence as an occurrence-generating rule that never ends. */
export function cadenceToRule(cadence: Cadence): RecurrenceRule {
  return { ...cadence, end: { kind: 'never' } };
}

/**
 * Order-independent identity for a cadence: the same schedule always yields the
 * same key, whatever its object key order or weekday order. Two cadences with
 * equal keys are the same schedule, so an unchanged key is never a write.
 */
export function cadenceKey(c: Cadence): string {
  return JSON.stringify([
    c.unit,
    c.interval,
    [...(c.weekdays ?? [])].sort((a, b) => a - b),
    c.monthlyAnchor ?? null,
    c.monthlyDay ?? null,
  ]);
}

/** Order-independent identity for a full rule: its cadence key plus its end. */
export function ruleKey(rule: RecurrenceRule): string {
  const end = rule.end;
  const endPart =
    end.kind === 'onDate'
      ? ['onDate', end.date]
      : end.kind === 'afterCount'
        ? ['afterCount', end.count]
        : ['never'];
  return JSON.stringify([cadenceKey(rule), endPart]);
}

/** Is `ymd` (YYYY-MM-DD) an occurrence of `rule` anchored at `anchorYmd`? */
export function isOccurrence(rule: RecurrenceRule, anchorYmd: string, ymd: string): boolean {
  return occurrencesInRange(rule, anchorYmd, ymd, ymd).length > 0;
}
