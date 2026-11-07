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

/** The order every tuple walk uses; `revisionOf` joins in this order. */
export const TUPLE_FIELDS = [
  'departureDate',
  'departureTime',
  'terminal',
  'arrivalDate',
  'arrivalTime',
] as const satisfies readonly (keyof ScheduleTuple)[];

/** One schedule field, in `TUPLE_FIELDS` order. */
export type TupleField = (typeof TUPLE_FIELDS)[number];

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

/** The `YYYY-MM-DD` part of a stored date (a legacy value may carry a time); anything
 *  unrecognised is returned trimmed, never dropped. */
export function datePart(value: string | undefined): string | undefined {
  const v = value?.trim();
  if (!v) return undefined;
  return /^\d{4}-\d{2}-\d{2}/.exec(v)?.[0] ?? v;
}

function addDaysYmd(ymd: string, days: number): string | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return undefined;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days));
  return d.toISOString().slice(0, 10);
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
  });
}

/**
 * The provider's schedule. Departure half (and departure terminal, raw) from `leg`; arrival
 * half from `arrivalLeg`, which is `leg` by default (a single-sector flight), the later sector
 * of a multi-stop number, or `null` when no returned sector reaches the booking's arrival: the
 * arrival half is then undefined, and an undefined provider field is never compared or written.
 * `pickLeg`'s `arrivalLeg` has exactly these semantics, so `tupleFromLeg(m.leg, m.arrivalLeg)`.
 */
export function tupleFromLeg(leg: FlightLeg, arrivalLeg: FlightLeg | null = leg): ScheduleTuple {
  const dep = splitLocal(leg.departure.scheduledLocal);
  const arr = arrivalLeg ? splitLocal(arrivalLeg.arrival.scheduledLocal) : null;
  return compact({
    departureDate: dep?.date,
    departureTime: dep?.time,
    terminal: leg.departure.terminal?.trim() || undefined,
    arrivalDate: arr?.date,
    arrivalTime: arr?.time,
  });
}

/** The values a segment held before the last airline change, as a tuple (drops `at`). */
export function tupleFromWas(liveWas: VacationTravelSegment['liveWas']): ScheduleTuple | undefined {
  if (!liveWas) return undefined;
  return compact({
    departureDate: liveWas.departureDate,
    departureTime: liveWas.departureTime,
    terminal: liveWas.terminal,
    arrivalDate: liveWas.arrivalDate,
    arrivalTime: liveWas.arrivalTime,
  });
}

function sameField(f: TupleField, a: string | undefined, b: string): boolean {
  if (f === 'terminal') return normaliseTerminal(a) === normaliseTerminal(b);
  if (f === 'departureTime' || f === 'arrivalTime') return normaliseTime(a) === normaliseTime(b);
  return datePart(a) === datePart(b);
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
 * The canonical revision string persisted as `liveRevision`: the tuple itself, joined in
 * `TUPLE_FIELDS` order with `|`, terminal normalised, `''` for an undefined field
 * ("2026-12-13|18:30|3|2026-12-14|00:40"). Human-readable in the pod, synchronous, no crypto.
 * A terminal that appears later is a new revision, so it applies.
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

/** The four synced live fields, copied as one unit; undefined when the segment has none. The
 *  ONE place their names are listed outside the model. */
export function pickLiveState(seg: SegmentLiveState): SegmentLiveState | undefined {
  const { liveRevision, liveWas, liveAppliedAt, liveCancelledAt } = seg;
  if (
    liveRevision === undefined &&
    liveWas === undefined &&
    liveAppliedAt === undefined &&
    liveCancelledAt === undefined
  ) {
    return undefined;
  }
  const out: SegmentLiveState = {};
  if (liveRevision !== undefined) out.liveRevision = liveRevision;
  if (liveWas !== undefined) out.liveWas = { ...liveWas };
  if (liveAppliedAt !== undefined) out.liveAppliedAt = liveAppliedAt;
  if (liveCancelledAt !== undefined) out.liveCancelledAt = liveCancelledAt;
  return out;
}
