/**
 * Read a Google `recurrence[]` array back into a beanies {@link RecurrenceRule}.
 * The inverse of `recurrenceRrule.ts`, and the only place that direction exists.
 *
 * ## Why this refuses so much
 *
 * `RecurrenceRule` is deliberately small: it has no `BYSETPOS`, no `BYMONTH`, no
 * multi-value `BYMONTHDAY`, no `EXDATE`, and no monthly ordinal field at all. The
 * ordinal in "the 2nd Wednesday" is re-derived from the activity's own start date
 * at expansion and serialization time (`recurrenceRrule.ts:122`), and the same is
 * true of the month in a yearly rule.
 *
 * That has a consequence people find surprising: a parse is only FAITHFUL when the
 * RRULE agrees with what the start date already implies. `FREQ=MONTHLY;BYDAY=2WE`
 * stored against a start date that happens to be the THIRD Wednesday would come
 * back out of beanies as the third Wednesday, silently, forever. So an anchor
 * disagreement is REFUSED rather than coerced.
 *
 * A refusal is not an error and not an exclusion. The caller still offers the event;
 * it simply comes across once, on its next occurrence, labelled as such. Getting a
 * single correct event is strictly better than getting a confidently wrong series.
 *
 * beanies' OWN emitted rules are not all round-trippable, and that is correct: the
 * clamped `BYMONTHDAY=28,29,30;BYSETPOS=-1` forms and the 29-Feb `BYMONTH=2` form
 * carry clamp semantics this model cannot re-express from the string alone. The
 * test asserts those refuse, which documents the asymmetry instead of hiding it.
 */

import type { RecurrenceRule, RecurrenceUnit, RecurrenceEnd } from '@/types/recurrence';
import { getWeekdayOrdinalInMonth, parseLocalDate } from '@/utils/date';

export type RruleRefusal =
  | 'no-rrule'
  | 'multi-rule'
  | 'extra-date-lines'
  | 'unsupported-freq'
  | 'unsupported-parts'
  | 'anchor-mismatch'
  | 'malformed';

export type RruleParse = { ok: true; rule: RecurrenceRule } | { ok: false; reason: RruleRefusal };

/** RRULE day codes indexed by JS weekday (0=Sun..6=Sat). Mirrors the writer. */
const RRULE_DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;

/** Parts this model has no field for. Any of them means the rule is not ours. */
const UNSUPPORTED_PARTS = ['BYSETPOS', 'BYMONTH', 'BYWEEKNO', 'BYYEARDAY', 'BYHOUR', 'BYMINUTE'];

const FREQ_TO_UNIT: Record<string, RecurrenceUnit> = {
  DAILY: 'day',
  WEEKLY: 'week',
  MONTHLY: 'month',
  YEARLY: 'year',
};

function refuse(reason: RruleRefusal): RruleParse {
  return { ok: false, reason };
}

/** `YYYYMMDD` or `YYYYMMDDTHHMMSSZ` → `YYYY-MM-DD`, or null if unparseable. */
function untilToYmd(raw: string): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(raw.trim());
  if (!m) return null;
  const ymd = `${m[1]}-${m[2]}-${m[3]}`;
  // A UTC end-of-day UNTIL (what the writer emits for timed events) is treated as
  // that calendar date. Timezone-exact UNTIL is a known v1 nuance on the way out
  // too, so the two directions agree.
  return Number.isNaN(new Date(`${ymd}T00:00:00`).getTime()) ? null : ymd;
}

/** Split `RRULE:FREQ=WEEKLY;BYDAY=MO` into `{ FREQ: 'WEEKLY', BYDAY: 'MO' }`. */
function toParts(rruleLine: string): Record<string, string> | null {
  const body = rruleLine.slice('RRULE:'.length);
  if (!body.trim()) return null;
  const parts: Record<string, string> = {};
  for (const chunk of body.split(';')) {
    if (!chunk) continue;
    const eq = chunk.indexOf('=');
    if (eq <= 0) return null;
    parts[chunk.slice(0, eq).trim().toUpperCase()] = chunk.slice(eq + 1).trim();
  }
  return parts;
}

/**
 * `2WE` → `{ ordinal: 2, weekday: 3 }`; `MO` → `{ ordinal: null, weekday: 1 }`.
 *
 * Parsed by hand rather than by regex. The obvious pattern
 * (`/^([+-]?\d+)?([A-Z]{2})$/`) pairs an optional quantified group with a following
 * one, which `security/detect-unsafe-regex` flags. There is no real backtracking
 * risk here (digits and letters are disjoint), but this input arrives from an
 * external API, the hand-rolled version is no longer and is easier to read, and
 * "suppress the security rule because I reasoned about it" is a worse habit than
 * simply not needing it. Per RFC 5545 the ordinal is -53..53, so the digit run is
 * bounded to two either way.
 */
function parseByDayToken(token: string): { ordinal: number | null; weekday: number } | null {
  const t = token.trim().toUpperCase();
  if (t.length < 2) return null;

  const code = t.slice(-2);
  const weekday = RRULE_DAYS.indexOf(code as (typeof RRULE_DAYS)[number]);
  if (weekday < 0) return null;

  const prefix = t.slice(0, -2);
  if (prefix === '') return { ordinal: null, weekday };

  const sign = prefix[0] === '-' ? -1 : 1;
  const digits = prefix[0] === '+' || prefix[0] === '-' ? prefix.slice(1) : prefix;
  if (digits.length === 0 || digits.length > 2) return null;
  for (const ch of digits) {
    if (ch < '0' || ch > '9') return null;
  }
  const ordinal = sign * Number(digits);
  return ordinal === 0 ? null : { ordinal, weekday };
}

function parseEnd(parts: Record<string, string>): RecurrenceEnd | null {
  if (parts.UNTIL) {
    const date = untilToYmd(parts.UNTIL);
    return date ? { kind: 'onDate', date } : null;
  }
  if (parts.COUNT) {
    const count = Number(parts.COUNT);
    return Number.isInteger(count) && count >= 1 ? { kind: 'afterCount', count } : null;
  }
  return { kind: 'never' };
}

/**
 * Parse Google's `recurrence[]` for a master starting on `startYmd`.
 *
 * `startYmd` is not decoration: it is what makes an anchor-agreement check
 * possible, and without it a monthly or weekly rule cannot be validated at all.
 */
export function parseRecurrence(lines: string[] | undefined, startYmd: string): RruleParse {
  if (!lines || lines.length === 0) return refuse('no-rrule');

  const rrules = lines.filter((l) => l.trim().toUpperCase().startsWith('RRULE:'));
  // EXDATE / RDATE / EXRULE carve holes in or bolt extras onto a series. The model
  // has nowhere to put them, and a series imported without its exclusions would
  // show occurrences the family deliberately removed.
  const extras = lines.filter((l) => /^(EXDATE|RDATE|EXRULE)/i.test(l.trim()));
  if (extras.length > 0) return refuse('extra-date-lines');
  if (rrules.length === 0) return refuse('no-rrule');
  if (rrules.length > 1) return refuse('multi-rule');

  const parts = toParts(rrules[0].trim());
  if (!parts) return refuse('malformed');

  for (const bad of UNSUPPORTED_PARTS) {
    if (parts[bad] !== undefined) return refuse('unsupported-parts');
  }

  const unit = FREQ_TO_UNIT[(parts.FREQ ?? '').toUpperCase()];
  if (!unit) return refuse('unsupported-freq');

  const interval = parts.INTERVAL === undefined ? 1 : Number(parts.INTERVAL);
  if (!Number.isInteger(interval) || interval < 1) return refuse('malformed');

  const end = parseEnd(parts);
  if (!end) return refuse('malformed');

  const start = parseLocalDate(startYmd.slice(0, 10));
  if (Number.isNaN(start.getTime())) return refuse('malformed');

  switch (unit) {
    case 'day':
      if (parts.BYDAY || parts.BYMONTHDAY) return refuse('unsupported-parts');
      return { ok: true, rule: { unit, interval, end } };

    case 'week': {
      if (parts.BYMONTHDAY) return refuse('unsupported-parts');
      if (!parts.BYDAY) {
        // No BYDAY: the series runs on the start date's weekday, which is exactly
        // what the model means by an empty `weekdays`.
        return { ok: true, rule: { unit, interval, end } };
      }
      const tokens = parts.BYDAY.split(',').map(parseByDayToken);
      if (tokens.some((t) => t === null)) return refuse('malformed');
      const days = (tokens as Array<{ ordinal: number | null; weekday: number }>).map((t) => t);
      // An ordinal is meaningless on a weekly rule and the model cannot hold one.
      if (days.some((d) => d.ordinal !== null)) return refuse('unsupported-parts');
      const weekdays = [...new Set(days.map((d) => d.weekday))].sort((a, b) => a - b);
      // The model allows several weekdays only at interval 1 (`recurrence.ts`).
      if (weekdays.length > 1 && interval > 1) return refuse('unsupported-parts');
      // ANCHOR AGREEMENT: the engine expands from the activity's own start date, so
      // a day set that excludes that weekday would generate a different series.
      if (!weekdays.includes(start.getDay())) return refuse('anchor-mismatch');
      return { ok: true, rule: { unit, interval, weekdays, end } };
    }

    case 'month': {
      if (parts.BYDAY && parts.BYMONTHDAY) return refuse('unsupported-parts');

      if (parts.BYDAY) {
        const tokens = parts.BYDAY.split(',');
        if (tokens.length > 1) return refuse('unsupported-parts');
        const day = parseByDayToken(tokens[0]);
        if (!day) return refuse('malformed');
        if (day.ordinal === null) return refuse('unsupported-parts');
        // ANCHOR AGREEMENT. The ordinal has no field: it is re-derived from the
        // start date. Accepting `BYDAY=2WE` against a third-Wednesday start would
        // silently produce the THIRD Wednesday series instead of the second.
        if (day.weekday !== start.getDay()) return refuse('anchor-mismatch');
        if (day.ordinal !== getWeekdayOrdinalInMonth(start)) return refuse('anchor-mismatch');
        return { ok: true, rule: { unit, interval, monthlyAnchor: 'weekday', end } };
      }

      if (parts.BYMONTHDAY) {
        const values = parts.BYMONTHDAY.split(',');
        // Multi-value BYMONTHDAY is the clamp form beanies itself emits alongside
        // BYSETPOS; without BYSETPOS it means something else again. Either way the
        // model has one `monthlyDay`, so this is not representable.
        if (values.length > 1) return refuse('unsupported-parts');
        const raw = Number(values[0]);
        if (!Number.isInteger(raw) || raw === 0) return refuse('malformed');
        if (raw === -1) {
          // "Last day of the month". ANCHOR AGREEMENT: the start must actually BE
          // its month's last day, or beanies would move the series.
          const lastDay = new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate();
          if (start.getDate() !== lastDay) return refuse('anchor-mismatch');
          return {
            ok: true,
            rule: { unit, interval, monthlyAnchor: 'date', monthlyDay: 'last', end },
          };
        }
        if (raw < 0) return refuse('unsupported-parts'); // -2 etc has no field
        if (raw !== start.getDate()) return refuse('anchor-mismatch');
        // A day a short month lacks means two DIFFERENT series. RFC 5545 SKIPs
        // February for BYMONTHDAY=31; the beanies engine CLAMPs to the 28th. The
        // writer refuses to serialize this naively for exactly that reason
        // (`clampedMonthDayParts`), so reading it back naively is the same bug in
        // the other direction, and an adopted event would have its Google rule
        // rewritten from "the 31st" to "the last day" on the first ordinary edit.
        if (raw > 28) return refuse('unsupported-parts');
        return { ok: true, rule: { unit, interval, monthlyAnchor: 'date', monthlyDay: raw, end } };
      }

      // Bare FREQ=MONTHLY inherits the day from DTSTART, which is what
      // `monthlyAnchor: 'date'` with the start's own day means — but only while
      // that day exists in every month. Past the 28th the two engines diverge
      // (see above), so it is refused rather than quietly rescheduled.
      if (start.getDate() > 28) return refuse('unsupported-parts');
      return {
        ok: true,
        rule: { unit, interval, monthlyAnchor: 'date', monthlyDay: start.getDate(), end },
      };
    }

    case 'year':
      // BYMONTH is already refused above, which correctly rejects beanies' own
      // 29-Feb form. A bare FREQ=YEARLY inherits month and day from DTSTART.
      if (parts.BYDAY || parts.BYMONTHDAY) return refuse('unsupported-parts');
      // Same clamp-vs-skip divergence as monthly: RFC 5545 SKIPs non-leap years
      // for a 29 Feb anchor, the beanies engine clamps to 28 Feb. The writer emits
      // `BYMONTH=2;BYMONTHDAY=28,29;BYSETPOS=-1` precisely because a bare
      // FREQ=YEARLY would show 28 Feb in beanies and nothing in Google.
      if (start.getMonth() === 1 && start.getDate() === 29) return refuse('unsupported-parts');
      return { ok: true, rule: { unit, interval, end } };
  }
}
