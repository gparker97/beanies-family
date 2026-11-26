/**
 * Live flight checks (#143): the comparable schedule of a flight, from the segment, the
 * provider leg, or the stored pre-change values, plus the canonical revision string.
 *
 * Wall-clock to wall-clock, local to each airport. Nothing here converts through the device
 * zone: a provider `scheduledLocal` is split as written, its offset ignored.
 *
 * Pure, no logging. Relative imports and erasable TS only: Spike 0 runs this under plain node.
 */

import type { FlightLeg, ScheduleTuple } from '../../types/flightStatus';
import type { SegmentLiveState, VacationTravelSegment } from '../../types/models';
import { normaliseFlightNumber } from './flightNumber';

/**
 * The five fields the persisted revision is made of, in the order `revisionOf` joins them.
 * FROZEN: `liveRevision` in the family file and the Lambda's `sent_rev` are this positional,
 * unversioned 5-part string, so a sixth part would re-apply every flight once, overwrite hand
 * edits on Conflict flights and make the shared Lambda push repeats to older devices. The
 * Lambda's `TUPLE_FIELDS` (`infrastructure/lambda/flight-status/schedule.mjs`) is the twin of
 * THIS list, not of the client's six-field `TUPLE_FIELDS` (`scheduleParity.test.ts` pins it).
 * `revisionOf` lists its parts by hand and iterates no list; this one exists for
 * `classifyDiff`, the notice `pushable` rule and the parity test.
 */
export const REVISION_FIELDS = [
  'departureDate',
  'departureTime',
  'terminal',
  'arrivalDate',
  'arrivalTime',
] as const satisfies readonly (keyof ScheduleTuple)[];

/**
 * Every field a check compares, applies, strikes through and reverts: the revision's five plus
 * the arrival terminal, which rides beside the revision (recorded as `liveArrivalTerminal`).
 * Each is also the segment key of the same name (`planChange` / `revertPlan` write by it).
 */
export const TUPLE_FIELDS = [
  ...REVISION_FIELDS,
  'arrivalTerminal',
] as const satisfies readonly (keyof ScheduleTuple)[];

/** One schedule field, in `TUPLE_FIELDS` order. */
export type TupleField = (typeof TUPLE_FIELDS)[number];

/** What kind of value each field holds: how it is compared (`sameField`) and formatted
 *  (`fillNoteLine`). Total, so a new field fails to compile until it is classified. */
export const FIELD_KIND: Record<TupleField, 'date' | 'time' | 'terminal'> = {
  departureDate: 'date',
  departureTime: 'time',
  terminal: 'terminal',
  arrivalDate: 'date',
  arrivalTime: 'time',
  arrivalTerminal: 'terminal',
};

/**
 * Split a provider local time into `YYYY-MM-DD` and `HH:mm`, as written.
 *
 * Tolerant of the shapes AeroDataBox's `date-time` may take: a space or `T` separator, optional
 * seconds and fraction, and a trailing offset (`+08:00`, `+0800`) or `Z`. Returns null for
 * anything else, so a malformed string never becomes a "change".
 */
export function splitLocal(value: string | undefined): { date: string; time: string } | null {
  // Head, then the tail in flat steps: one regex with nested optional groups is what
  // `security/detect-unsafe-regex` rejects, and this reads no worse.
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})/.exec(value?.trim() ?? '');
  if (!m) return null;
  let rest = value!.trim().slice(m[0].length);
  if (rest.startsWith(':')) {
    if (!/^:\d\d/.test(rest)) return null;
    rest = rest.slice(3);
    if (rest.startsWith('.')) rest = rest.slice(1).replace(/^\d+/, '');
  }
  rest = rest.trim();
  const zoneOk =
    rest === '' || /^z$/i.test(rest) || /^[+-]\d\d$/.test(rest) || /^[+-]\d\d:?\d\d$/.test(rest);
  if (!zoneOk) return null;
  const hh = Number(m[2]);
  const mm = Number(m[3]);
  if (hh > 23 || mm > 59) return null;
  return { date: m[1]!, time: `${m[2]}:${m[3]}` };
}

/**
 * A vendor UTC string ("2026-12-13 15:05Z", a space or `T` separator) as epoch ms, or null for
 * an absent or unparseable value. The one parser for every `scheduledUtc` the client reads.
 *
 * The value MUST name its zone: a trailing `Z` or `±HH:MM`. Without one, `Date.parse` reads
 * the wall clock in the DEVICE zone, which is exactly the conversion this module never makes,
 * so such a value is null (the callers then fall back to the segment's own date and time).
 */
export function parseUtcMs(value: string | undefined): number | null {
  const v = value?.trim().replace(' ', 'T');
  if (!v || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(v)) return null;
  const ms = Date.parse(v);
  return Number.isNaN(ms) ? null : ms;
}

/** "9:05" / "09:05:00" → "09:05"; anything unrecognised is returned trimmed, never dropped. */
export function normaliseTime(value: string | undefined): string | undefined {
  const v = value?.trim();
  if (!v) return undefined;
  const parts = v.split(':');
  const [h, mi, s] = parts;
  const ok =
    (parts.length === 2 || (parts.length === 3 && /^\d{2}$/.test(s!))) &&
    /^\d{1,2}$/.test(h!) &&
    /^\d{2}$/.test(mi!);
  return ok ? `${h!.padStart(2, '0')}:${mi}` : v;
}

/** The stored time as `HH:mm` (`normaliseTime`, the tuple rule), only when it is a real
 *  clock time: a zone conversion of "25:00" or free text would be a wrong instant. */
export function hhmm(value: string | undefined): string | undefined {
  const t = normaliseTime(value);
  const m = t ? /^(\d{2}):(\d{2})$/.exec(t) : null;
  return m && Number(m[1]) <= 23 && Number(m[2]) <= 59 ? t : undefined;
}

/** The `YYYY-MM-DD` part of a stored date (a legacy value may carry a time); anything
 *  unrecognised is returned trimmed, never dropped. */
export function datePart(value: string | undefined): string | undefined {
  const v = value?.trim();
  if (!v) return undefined;
  return /^\d{4}-\d{2}-\d{2}/.exec(v)?.[0] ?? v;
}

/** `YYYY-MM-DD` plus `days` (negative goes back), calendar arithmetic with no zone; undefined
 *  for anything that is not a `YYYY-MM-DD`. */
export function addDaysYmd(ymd: string, days: number): string | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return undefined;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days));
  return d.toISOString().slice(0, 10);
}

/**
 * The one sort key for flights by departure: airport wall clock, date then time, on the tuple's
 * own normalisers ("9:05" sorts before "18:30"); an undated flight sorts last. The rail's
 * "Live checks" rows and the homecoming rule (`utils/homecoming.ts`) both order by it.
 */
export function departureSortKey(s: { departureDate?: string; departureTime?: string }): string {
  return `${datePart(s.departureDate) ?? '9999'} ${normaliseTime(s.departureTime) ?? ''}`;
}

/**
 * When a flight lands, as the briefing tells it: the airline's estimate (`estimatedArrival`,
 * an airport-local string read by `splitLocal`) when a live check carries one, else the plan's
 * `arrivalDate` / `arrivalTime`. Null without a date or without a real clock time (`hhmm`).
 * `scheduledTime` is set only when the estimate is used and its time differs from the plan's.
 */
export function resolveArrival(
  schedule: Pick<ScheduleTuple, 'arrivalDate' | 'arrivalTime'> | undefined,
  estimatedArrival: string | undefined
): { date: string; time: string; scheduledTime?: string } | null {
  const planned = hhmm(schedule?.arrivalTime);
  const estimate = splitLocal(estimatedArrival);
  // An estimate whose time is unusable ("24:00") falls back to the plan, never drops the row.
  const time = estimate ? hhmm(estimate.time) : undefined;
  if (estimate && time !== undefined) {
    return planned !== undefined && planned !== time
      ? { date: estimate.date, time, scheduledTime: planned }
      : { date: estimate.date, time };
  }
  const date = datePart(schedule?.arrivalDate);
  if (!date || planned === undefined) return null;
  return { date, time: planned };
}

/**
 * Terminal identity for comparison: drop "Terminal" and a leading "T", spaces, upper-case.
 * `T2` = `2` = `Terminal 2` = `terminal 2`. Undefined for an empty value. Comparison only:
 * an apply writes the provider's raw string.
 */
export function normaliseTerminal(value: string | undefined): string | undefined {
  const v = value
    ?.toUpperCase()
    .replace(/\bTERMINAL\b/g, '')
    .replace(/\s+/g, '');
  if (!v) return undefined;
  return v.replace(/^T(?=[0-9A-Z])/, '') || undefined;
}

function compact(tuple: ScheduleTuple): ScheduleTuple {
  const out: ScheduleTuple = {};
  for (const f of TUPLE_FIELDS) if (tuple[f] !== undefined) out[f] = tuple[f];
  return out;
}

/**
 * The segment's own schedule. A legacy segment with an arrival time but no arrival date takes
 * the departure date plus `arrivesNextDay`, so it does not read as a change on its first check.
 */
export function tupleFromSegment(
  seg: Pick<
    VacationTravelSegment,
    | 'departureDate'
    | 'departureTime'
    | 'terminal'
    | 'arrivalDate'
    | 'arrivalTime'
    | 'arrivalTerminal'
    | 'arrivesNextDay'
  >
): ScheduleTuple {
  const departureDate = datePart(seg.departureDate);
  const arrivalTime = normaliseTime(seg.arrivalTime);
  let arrivalDate = datePart(seg.arrivalDate);
  if (!arrivalDate && arrivalTime && departureDate) {
    arrivalDate = addDaysYmd(departureDate, seg.arrivesNextDay ? 1 : 0);
  }
  return compact({
    departureDate,
    departureTime: normaliseTime(seg.departureTime),
    terminal: seg.terminal?.trim() || undefined,
    arrivalDate,
    arrivalTime,
    arrivalTerminal: seg.arrivalTerminal?.trim() || undefined,
  });
}

/**
 * The provider's schedule. Departure half (and departure terminal, raw) from `leg`; arrival
 * half (and arrival terminal, raw) from `arrivalLeg`, which is `leg` by default (a single-sector flight), the later sector
 * of a multi-stop number, or `null` when no returned sector reaches the booking's arrival: the
 * arrival half is then undefined, and an undefined provider field is never compared or written.
 * `pickLeg`'s `arrivalLeg` has exactly these semantics, so `tupleFromLeg(m.leg, m.arrivalLeg)`.
 *
 * An arrival terminal with no comparison key (`normaliseTerminal` undefined: the bare word
 * "Terminal") is read as not stated: it has no record (`arrivalTerminalRecord`), so against a
 * plan with none it would be a Conflict nothing could ever settle. The departure terminal is
 * read as written (it is part of the revision, which the Lambda restates).
 */
export function tupleFromLeg(leg: FlightLeg, arrivalLeg: FlightLeg | null = leg): ScheduleTuple {
  const dep = splitLocal(leg.departure.scheduledLocal);
  const arr = arrivalLeg ? splitLocal(arrivalLeg.arrival.scheduledLocal) : null;
  const arrivalTerminal = arrivalLeg?.arrival.terminal?.trim();
  return compact({
    departureDate: dep?.date,
    departureTime: dep?.time,
    terminal: leg.departure.terminal?.trim() || undefined,
    arrivalDate: arr?.date,
    arrivalTime: arr?.time,
    arrivalTerminal: normaliseTerminal(arrivalTerminal) !== undefined ? arrivalTerminal : undefined,
  });
}

/** The values a segment held before the last airline change, as a tuple (drops `at`; `{}` for
 *  a `liveWas` holding only `at`, which `noticeRevision` relies on). */
export function tupleFromWas(liveWas: VacationTravelSegment['liveWas']): ScheduleTuple | undefined {
  return liveWas ? compact(liveWas) : undefined;
}

function sameField(f: TupleField, a: string | undefined, b: string): boolean {
  switch (FIELD_KIND[f]) {
    case 'terminal':
      return normaliseTerminal(a) === normaliseTerminal(b);
    case 'time':
      return normaliseTime(a) === normaliseTime(b);
    case 'date':
      return datePart(a) === datePart(b);
  }
}

/**
 * True when the segment agrees with the provider on every field the PROVIDER states.
 *
 * A provider-undefined field (no published terminal, an unmatched arrival half) is skipped, so
 * an airport that publishes no terminal can never erase the family's "Terminal 2". A field the
 * provider states and the segment lacks is a difference.
 */
export function tuplesEqual(mine: ScheduleTuple, provider: ScheduleTuple): boolean {
  for (const f of TUPLE_FIELDS) {
    const p = provider[f];
    if (p === undefined) continue;
    if (!sameField(f, mine[f], p)) return false;
  }
  return true;
}

/**
 * Which fields the provider would change, split by what the segment held:
 *  - `changed`: the segment had a value and the provider states a different one (an airline
 *    change: it is announced, struck out and can be put back);
 *  - `filled`: the segment had no value and the provider states one (a terminal published
 *    later: a quiet fill, never announced).
 * A provider-undefined field is in neither list (the `tuplesEqual` rule), so
 * `changed.length === 0 && filled.length === 0` exactly when `tuplesEqual(mine, provider)`.
 * Both lists keep `TUPLE_FIELDS` order.
 */
export function diffTuple(
  mine: ScheduleTuple,
  provider: ScheduleTuple
): { changed: TupleField[]; filled: TupleField[] } {
  const changed: TupleField[] = [];
  const filled: TupleField[] = [];
  for (const f of TUPLE_FIELDS) {
    const p = provider[f];
    if (p === undefined) continue;
    if (mine[f] === undefined) filled.push(f);
    else if (!sameField(f, mine[f], p)) changed.push(f);
  }
  return { changed, filled };
}

/**
 * The canonical revision string persisted as `liveRevision`: the tuple's five
 * `REVISION_FIELDS`, joined in that order with `|`, terminal normalised, `''` for an undefined
 * field ("2026-12-13|18:30|3|2026-12-14|00:40"). Human-readable in the pod, synchronous, no
 * crypto. A departure terminal that appears later is a new revision, so it applies. The arrival
 * terminal is NOT part of it (it is recorded as `liveArrivalTerminal`; see `classifyDiff`).
 *
 * A PERSISTED value: changing this format re-applies every flight once. Never fold it into a
 * shared hash helper (see `src/utils/stableVariant.ts`).
 */
export function revisionOf(tuple: ScheduleTuple): string {
  return [
    datePart(tuple.departureDate) ?? '',
    normaliseTime(tuple.departureTime) ?? '',
    normaliseTerminal(tuple.terminal) ?? '',
    datePart(tuple.arrivalDate) ?? '',
    normaliseTime(tuple.arrivalTime) ?? '',
  ].join('|');
}

/**
 * The `liveArrivalTerminal` record of the airline's arrival terminal on THIS flight:
 * `<flight number>|<departure day>|<terminal key>` ("SQ318|2026-12-13|2"), from the segment's
 * number (`normaliseFlightNumber`, '' when it has none), the airline answer's departure day
 * (`datePart`) and its arrival terminal's comparison key (`normaliseTerminal`). Undefined when
 * the airline states no arrival terminal with a key, or no departure day (a malformed
 * `scheduledLocal`): such an answer is never recorded.
 *
 * Self-scoping, like `liveRevision` (which embeds the airline's dates and times): a re-booked
 * flight (a new number, or a new day, whose check answers with that day's leg) holds a record
 * that no longer matches, so its arrival terminal is owed again (a fill), never the family's
 * own edit. The day is the AIRLINE's, as in `liveRevision`, not the plan's: "Put it back" of a
 * moved day restores the old day while the answer stays the same, and must stay a Conflict.
 * The ONE builder of the record: `classifyDiff`, `planChange` and the store's notice key and
 * conflict log all go through it. A PERSISTED value.
 */
export function arrivalTerminalRecord(
  seg: Pick<VacationTravelSegment, 'airline' | 'flightNumber'>,
  provider: Pick<ScheduleTuple, 'departureDate' | 'arrivalTerminal'>
): string | undefined {
  const key = normaliseTerminal(provider.arrivalTerminal);
  const day = datePart(provider.departureDate);
  if (key === undefined || day === undefined) return undefined;
  const number = normaliseFlightNumber(seg.airline, seg.flightNumber)?.query ?? '';
  return `${number}|${day}|${key}`;
}

/**
 * A change notice's base identity: the revision, plus `~<arrival terminal record>` only when
 * the arrival terminal moved (`was.arrivalTerminal` is set). A quiet arrival-terminal fill
 * therefore changes no existing notice id, while a moved arrival terminal (the revision
 * unchanged) is a new notice. `record` is `liveArrivalTerminal`'s form (`arrivalTerminalRecord`;
 * a caller holding a provider answer builds it from that), appended as is. Two callers only:
 * `noticeRevAfterWrite` (`verify.ts`, the id a change is frozen under) and `noticeRevision`'s
 * fallback for a change written without one (`occurrenceNotice.ts`).
 */
export function changeNoticeRevision(
  revision: string,
  record: string | undefined,
  was: Pick<ScheduleTuple, 'arrivalTerminal'> | undefined
): string {
  return was?.arrivalTerminal !== undefined ? `${revision}~${record ?? ''}` : revision;
}

/**
 * How the airline's answer differs from the plan, split by whether the plan has acted on it.
 * The five `REVISION_FIELDS` are recorded as `liveRevision`, `arrivalTerminal` as
 * `liveArrivalTerminal` (`arrivalTerminalRecord`), each on its own, so a flight sitting in
 * Conflict over a hand-edited time still takes the airline's first arrival terminal (only that
 * field is owed). A differing field already acted on is the family's own edit:
 *  - `changed`: owed, the plan holds a different value (announced, struck out, revertible);
 *  - `filled`: owed, the plan holds none (a quiet fill);
 *  - `contested`: differing, but this answer was already acted on (the Conflict; never
 *    overwritten).
 * A provider-undefined field is in none of them (the `diffTuple` rule), so the airline dropping
 * its arrival terminal owes nothing. All three keep `TUPLE_FIELDS` order.
 */
export function classifyDiff(
  seg: Parameters<typeof tupleFromSegment>[0] &
    Pick<
      VacationTravelSegment,
      'liveRevision' | 'liveArrivalTerminal' | 'airline' | 'flightNumber'
    >,
  provider: ScheduleTuple
): { changed: TupleField[]; filled: TupleField[]; contested: TupleField[] } {
  const d = diffTuple(tupleFromSegment(seg), provider);
  const revisionActed = revisionOf(provider) === seg.liveRevision;
  const owed = (f: TupleField) =>
    f === 'arrivalTerminal'
      ? arrivalTerminalRecord(seg, provider) !== seg.liveArrivalTerminal
      : !revisionActed;
  const differing = TUPLE_FIELDS.filter((f) => d.changed.includes(f) || d.filled.includes(f));
  return {
    changed: d.changed.filter(owed),
    filled: d.filled.filter(owed),
    contested: differing.filter((f) => !owed(f)),
  };
}

/** The synced live fields, in one list: `pickLiveState` copies exactly these. */
export const LIVE_STATE_FIELDS = [
  'liveRevision',
  'liveArrivalTerminal',
  'liveWas',
  'liveAppliedAt',
  'liveCancelledAt',
] as const satisfies readonly (keyof SegmentLiveState)[];

type ExpectTrue<T extends true> = T;
/** Compile-time check, exported only so it is not an unused local: `LIVE_STATE_FIELDS` names
 *  every `SegmentLiveState` key, so widening the Pick without listing the field here fails to
 *  compile instead of silently dropping it. */
export type LiveStateFieldsComplete = ExpectTrue<
  [Exclude<keyof SegmentLiveState, (typeof LIVE_STATE_FIELDS)[number]>] extends [never]
    ? true
    : false
>;

/**
 * The five synced live fields, copied as one unit (`liveWas` by value); undefined when the
 * segment has none. The ONE place their names are listed outside the model. Occurrences get
 * their live state only through here (`vacation.ts`), so a dropped field would change the bell
 * and OS notice ids and stop them matching the store's dismiss key.
 */
export function pickLiveState(seg: SegmentLiveState): SegmentLiveState | undefined {
  const out: Record<string, unknown> = {};
  let any = false;
  for (const f of LIVE_STATE_FIELDS) {
    const v = seg[f];
    if (v === undefined) continue;
    any = true;
    out[f] = typeof v === 'object' ? { ...v } : v;
  }
  return any ? (out as SegmentLiveState) : undefined;
}

/**
 * What each synced live field is to the plan's record (`liveRecordOf`): `'record'` when a
 * write that changes it is a new record a cached answer must have been seen beside, `'detail'`
 * when it only describes a record (`liveWas`, the values before a change, written with
 * `liveAppliedAt`). Total, the `FIELD_KIND` precedent: a new live field fails to compile until
 * it is classified.
 */
export const LIVE_FIELD_ROLE: Record<keyof SegmentLiveState, 'record' | 'detail'> = {
  liveRevision: 'record',
  liveArrivalTerminal: 'record',
  liveWas: 'detail',
  liveAppliedAt: 'record',
  liveCancelledAt: 'record',
};

const RECORD_FIELDS = LIVE_STATE_FIELDS.filter((f) => LIVE_FIELD_ROLE[f] === 'record');

/**
 * The plan's live record as one string: the `'record'` fields of `LIVE_FIELD_ROLE`, in
 * `LIVE_STATE_FIELDS` order, joined with `§`, `''` for an absent one. A cached check remembers
 * the record it was asked beside (`FlightCheck.planRecord`), so a record written by another
 * device is told apart from one this device has seen (`isSuperseded` in `verify.ts`).
 *
 * `liveAppliedAt` and `liveCancelledAt` are in it as OPAQUE identity tokens, compared for
 * equality only: never ordered, never parsed, never compared with a clock. They are there so a
 * record that goes away and comes back (cancel, reinstate, cancel again, which reproduces the
 * same cancel revision) still reads as a new one. Device state only, never persisted in the pod.
 */
export function liveRecordOf(seg: SegmentLiveState): string {
  return RECORD_FIELDS.map((f) => {
    const v = seg[f];
    return typeof v === 'string' ? v : '';
  }).join('§');
}
