/**
 * The revision contract, RESTATED for the Lambda (#143 Phase 2), plus the webhook's per-device
 * push plan.
 *
 * WHY A RESTATEMENT AND NOT AN IMPORT. The device seeds the server's `sent_rev` with the revision
 * its plan holds (`liveRevision`, `src/utils/flightStatus/schedule.ts` `revisionOf` and
 * `verify.ts` `cancelRevisionOf`), and the server pushes only a revision the device does not
 * know. If the two `revisionOf`s differ by one byte, the first webhook pushes a revision the
 * device already holds. Every Lambda is its own zero-dependency zip (`billing/ddb.mjs` header) and
 * the client's `match.ts` imports `AIRPORTS`, which must never ship here, so this file restates
 * the small pure core and the client test
 * `src/utils/flightStatus/__tests__/scheduleParity.test.ts` runs the shared fixtures through both.
 * Change one side without the other and that test fails.
 *
 * Restated from `src/utils/flightStatus/schedule.ts`: `splitLocal`, `parseUtcMs`,
 * `normaliseTime`, `datePart`, `normaliseTerminal`, `tupleFromLeg`, `revisionOf`; from
 * `verify.ts`: `CANCELLED_REVISION_SUFFIX`, `cancelRevisionOf`; from `match.ts`: `usableLegs` and
 * `continues`, for CODES only (`legForCodes`). The server never needs `pickLeg`: the device
 * registers the provider's own leg codes (`dep`, `arr`), so selection is a code lookup.
 *
 * ONE SERVER-ONLY RULE has no client counterpart: a payload is per NUMBER, so `legForCodes` takes
 * the leg NEAREST the departure the device knows (its `sent_rev`) within 12 h (`SAME_INSTANCE_MS`;
 * daily instances are 24 h apart, so 12 h is the largest bound that never takes the adjacent
 * instance), not the client's booked date ±1 day. The asymmetry: a retime of 12 h or more (e.g.
 * across midnight) is not pushed; the device's on-open check still finds and applies it.
 *
 * Pure, no I/O, no logging. JSDoc types mirror `src/types/flightStatus.ts`.
 *
 * @typedef {{ iata?: string, scheduledLocal?: string, scheduledUtc?: string, terminal?: string }} LegSide
 * @typedef {{ number: string, status: string, isCargo?: boolean, airline?: { name?: string },
 *   departure: LegSide, arrival: LegSide }} FlightLeg
 * @typedef {{ departureDate?: string, departureTime?: string, terminal?: string,
 *   arrivalDate?: string, arrivalTime?: string }} ScheduleTuple
 */

/** The order every tuple walk uses; `revisionOf` joins in this order. */
export const TUPLE_FIELDS = Object.freeze([
  'departureDate',
  'departureTime',
  'terminal',
  'arrivalDate',
  'arrivalTime',
]);

/** Split a provider local time into `YYYY-MM-DD` and `HH:mm`, as written (offset ignored). */
export function splitLocal(value) {
  const v = typeof value === 'string' ? value.trim() : '';
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})/.exec(v);
  if (!m) return null;
  let rest = v.slice(m[0].length);
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
  return { date: m[1], time: `${m[2]}:${m[3]}` };
}

/** A vendor UTC string that NAMES its zone, as epoch ms; null otherwise. */
export function parseUtcMs(value) {
  const v = typeof value === 'string' ? value.trim().replace(' ', 'T') : '';
  if (!v || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(v)) return null;
  const ms = Date.parse(v);
  return Number.isNaN(ms) ? null : ms;
}

/** "9:05" / "09:05:00" → "09:05"; anything unrecognised is returned trimmed, never dropped. */
export function normaliseTime(value) {
  const v = typeof value === 'string' ? value.trim() : '';
  if (!v) return undefined;
  const parts = v.split(':');
  const [h, mi, s] = parts;
  const ok =
    (parts.length === 2 || (parts.length === 3 && /^\d{2}$/.test(s))) &&
    /^\d{1,2}$/.test(h) &&
    /^\d{2}$/.test(mi);
  return ok ? `${h.padStart(2, '0')}:${mi}` : v;
}

/** The `YYYY-MM-DD` part of a stored date; anything unrecognised is returned trimmed. */
export function datePart(value) {
  const v = typeof value === 'string' ? value.trim() : '';
  if (!v) return undefined;
  return /^\d{4}-\d{2}-\d{2}/.exec(v)?.[0] ?? v;
}

/** Terminal identity: drop "Terminal" and a leading "T", spaces, upper-case. `T2` = `Terminal 2`. */
export function normaliseTerminal(value) {
  const v =
    typeof value === 'string'
      ? value
          .toUpperCase()
          .replace(/\bTERMINAL\b/g, '')
          .replace(/\s+/g, '')
      : '';
  if (!v) return undefined;
  return v.replace(/^T(?=[0-9A-Z])/, '') || undefined;
}

function compact(tuple) {
  const out = {};
  for (const f of TUPLE_FIELDS) if (tuple[f] !== undefined) out[f] = tuple[f];
  return out;
}

/**
 * The provider's schedule: departure half (and raw departure terminal) from `leg`, arrival half
 * from `arrivalLeg` (`leg` by default; `null` = no sector reaches the booking's arrival, so the
 * arrival half is undefined).
 * @param {FlightLeg} leg
 * @param {FlightLeg | null} [arrivalLeg]
 * @returns {ScheduleTuple}
 */
export function tupleFromLeg(leg, arrivalLeg = leg) {
  const dep = splitLocal(leg.departure?.scheduledLocal);
  const arr = arrivalLeg ? splitLocal(arrivalLeg.arrival?.scheduledLocal) : null;
  return compact({
    departureDate: dep?.date,
    departureTime: dep?.time,
    terminal: leg.departure?.terminal?.trim() || undefined,
    arrivalDate: arr?.date,
    arrivalTime: arr?.time,
  });
}

/**
 * The canonical revision string ("2026-12-13|18:30|3|2026-12-14|00:40"). A PERSISTED format on
 * the client; byte-identical here or the server pushes revisions the device already knows.
 */
export function revisionOf(tuple) {
  return [
    datePart(tuple.departureDate) ?? '',
    normaliseTime(tuple.departureTime) ?? '',
    normaliseTerminal(tuple.terminal) ?? '',
    datePart(tuple.arrivalDate) ?? '',
    normaliseTime(tuple.arrivalTime) ?? '',
  ].join('|');
}

export const CANCELLED_REVISION_SUFFIX = '|cancelled';

/** The revision of a cancellation: the schedule's revision plus the suffix. */
export function cancelRevisionOf(tuple) {
  return revisionOf(tuple) + CANCELLED_REVISION_SUFFIX;
}

/**
 * A revision string back to its (normalised) tuple and cancel flag, for the push copy's "what
 * changed". Not on the client: only the server needs to read a revision it did not compute.
 * An unparseable value is an empty tuple.
 */
export function parseRevision(rev) {
  const raw = typeof rev === 'string' ? rev : '';
  const cancelled = raw.endsWith(CANCELLED_REVISION_SUFFIX);
  const body = cancelled ? raw.slice(0, -CANCELLED_REVISION_SUFFIX.length) : raw;
  const parts = body.split('|');
  if (parts.length !== TUPLE_FIELDS.length) return { tuple: {}, cancelled };
  const tuple = {};
  TUPLE_FIELDS.forEach((f, i) => {
    if (parts[i] !== '') tuple[f] = parts[i];
  });
  return { tuple, cancelled };
}

// ── Leg selection by the provider's own codes (restates match.ts usableLegs + continues) ─────

const DAY_MS = 86_400_000;
/** The longest layover a continuation sector may follow its inbound sector by. */
const MAX_CONNECTION_MS = 36 * 3_600_000;
/**
 * SERVER ONLY (no client counterpart): how far from the departure a device KNOWS (its `sent_rev`)
 * a leg may depart and still be that device's instance. The client's ±1 day tolerance is safe
 * there because its input is the provider's answer for the booked date; a webhook payload is per
 * NUMBER and carries only the items that changed, so another leg from the same airport is usually
 * the number's next (or previous) daily instance, 24 h from the known departure. Daily instances
 * are 24 h apart, so 12 h is the LARGEST bound that can never take the adjacent instance: keep it.
 *
 * The resulting asymmetry with the client is deliberate: a retime of 12 h or more (across
 * midnight or not) is not pushed; the device's own on-open check, which reads the booked date
 * ±1 day, still finds and applies it. A missed push is a delayed notice; taking the adjacent
 * instance would be a false one.
 */
const SAME_INSTANCE_MS = 12 * 3_600_000;

function ymdToMs(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd ?? '');
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

/** Cargo, legs without a usable departure schedule, and legs departing outside date ± 1 day never take part. */
function usableLegs(legs, departureDate) {
  const booked = ymdToMs(departureDate);
  return legs.filter((leg) => {
    if (!leg || leg.isCargo) return false;
    const dep = splitLocal(leg.departure?.scheduledLocal);
    if (!dep) return false;
    if (booked === null) return true;
    const at = ymdToMs(dep.date);
    return at !== null && Math.abs(at - booked) <= DAY_MS;
  });
}

function wallMs(value) {
  const p = splitLocal(value);
  if (!p) return null;
  const ms = Date.parse(`${p.date}T${p.time}:00Z`);
  return Number.isNaN(ms) ? null : ms;
}

/** The departure a revision states, as wall-clock ms at the departure airport; null without both. */
function knownDepartureMs(rev) {
  const { tuple } = parseRevision(rev);
  return tuple.departureDate && tuple.departureTime
    ? wallMs(`${tuple.departureDate} ${tuple.departureTime}`)
    : null;
}

/** `next` departs the airport `first` lands at, at or after it lands, within 36 h. */
function continues(first, next) {
  if (next === first) return false;
  if (!first.arrival?.iata || next.departure?.iata !== first.arrival.iata) return false;
  const arrUtc = parseUtcMs(first.arrival.scheduledUtc);
  const depUtc = parseUtcMs(next.departure.scheduledUtc);
  const [landed, leaves] =
    arrUtc !== null && depUtc !== null
      ? [arrUtc, depUtc]
      : [wallMs(first.arrival.scheduledLocal), wallMs(next.departure.scheduledLocal)];
  if (landed === null || leaves === null) return false;
  return leaves >= landed && leaves - landed <= MAX_CONNECTION_MS;
}

/**
 * The leg a registered device watches, by the provider codes it registered.
 *
 * Departure: a usable leg whose departure IATA equals `dep`. When `rev` states a departure (the
 * device's `sent_rev`, always on a registered device), the one NEAREST that departure within
 * `SAME_INSTANCE_MS`, whatever its date: the number's adjacent daily instance is never read as a
 * move, even when a pushed retime has taken the device's own leg off `date` and the payload also
 * carries the former (or next) instance ON `date`. Only without a known departure (no or an
 * unparseable `rev`) the legs on `date`. Still several (equally near, or several on `date`) →
 * those that reach `arr`; still several → none, never a guess. Arrival half: the leg itself when it lands at `arr`, else the continuation
 * sector reaching `arr` (`continues`), else `null`; `arr` absent → `null` (the device registered
 * no arrival half).
 *
 * @param {FlightLeg[]} legs
 * @param {{ dep: string, arr?: string, date: string, rev?: string }} codes  `rev` = the revision
 *   the device knows (its `sent_rev`).
 * @returns {{ leg: FlightLeg, arrivalLeg: FlightLeg | null } | null}
 */
export function legForCodes(legs, { dep, arr, date, rev }) {
  const usable = usableLegs(Array.isArray(legs) ? legs : [], date);
  const reaches = (l) =>
    l.arrival?.iata === arr || usable.some((n) => continues(l, n) && n.arrival?.iata === arr);
  let found = usable.filter((l) => l.departure?.iata === dep);
  const known = knownDepartureMs(rev);
  if (known !== null) {
    const distance = (l) => {
      const at = wallMs(l.departure.scheduledLocal);
      return at === null ? Infinity : Math.abs(at - known);
    };
    const near = found.filter((l) => distance(l) < SAME_INSTANCE_MS);
    const nearest = Math.min(...near.map(distance));
    found = near.filter((l) => distance(l) === nearest);
  } else {
    found = found.filter((l) => splitLocal(l.departure.scheduledLocal)?.date === date);
  }
  if (found.length > 1 && arr) {
    const reaching = found.filter(reaches);
    if (reaching.length > 0) found = reaching;
  }
  if (found.length !== 1) return null;
  const leg = found[0];
  if (!arr) return { leg, arrivalLeg: null };
  if (leg.arrival?.iata === arr) return { leg, arrivalLeg: leg };
  const onward = usable.find((l) => continues(leg, l) && l.arrival?.iata === arr);
  return { leg, arrivalLeg: onward ?? null };
}

// ── The webhook's push plan ──────────────────────────────────────────────────────────────────

const ARRIVAL_FIELDS = ['arrivalDate', 'arrivalTime'];

/** A tuple value in its revision form, so a provider value compares with a parsed revision. */
function revisionForm(field, value) {
  if (value === undefined) return undefined;
  if (field === 'terminal') return normaliseTerminal(value);
  if (field === 'departureTime' || field === 'arrivalTime') return normaliseTime(value);
  return datePart(value);
}

/**
 * Plan one push per device whose known revision differs from the payload's.
 *
 * For each device: select its leg by its own `date`/`dep`/`arr` and the departure its `sent_rev`
 * states (`legForCodes`; none, e.g. a payload carrying only another day's instance →
 * `skipped_no_leg`), compute the revision exactly as the device would (`revisionOf`, or
 * `cancelRevisionOf` for a `Canceled` leg), and push when it is not the device's `sent_rev`.
 *
 * Two refinements keep "a revision the device will hold" true over a PARTIAL payload (the
 * provider sends only the flight items that changed):
 *  - a device registered with an `arr` whose arrival sector is absent from this payload keeps the
 *    arrival half it already knows (from `sent_rev`), since the device's own fetch would still
 *    find that sector;
 *  - a revision that differs from `sent_rev` only where the provider states nothing (a field the
 *    payload leaves undefined) is not a change the device would ever apply (the client's
 *    `tuplesEqual` skips provider-undefined fields), so it is `skipped_same_rev`, not pushed.
 *
 * @param {FlightLeg[]} legs
 * @param {Array<{ sk: string, date: string, dep: string, arr?: string, sent_rev: string }>} devices
 * @param {string} flight  The watched (marketing) number, the partition key: the copy names it,
 *                         never the operating leg's own number.
 * @returns {{ pushes: Array<{ device: object, rev: string, change: object }>,
 *   skipped_same_rev: number, skipped_no_leg: number }}
 */
export function planPushes(legs, devices, flight) {
  const pushes = [];
  let skippedSameRev = 0;
  let skippedNoLeg = 0;
  for (const device of devices) {
    const sel = legForCodes(legs, {
      dep: device.dep,
      arr: device.arr,
      date: device.date,
      rev: device.sent_rev,
    });
    if (!sel) {
      skippedNoLeg += 1;
      continue;
    }
    const known = parseRevision(device.sent_rev);
    const tuple = tupleFromLeg(sel.leg, sel.arrivalLeg);
    if (device.arr && sel.arrivalLeg === null) {
      for (const f of ARRIVAL_FIELDS) {
        if (known.tuple[f] !== undefined) tuple[f] = known.tuple[f];
      }
    }
    const cancelled = sel.leg.status === 'Canceled';
    const rev = cancelled ? cancelRevisionOf(tuple) : revisionOf(tuple);

    const was = {};
    for (const f of TUPLE_FIELDS) {
      const now = revisionForm(f, tuple[f]);
      if (now !== undefined && now !== known.tuple[f]) was[f] = known.tuple[f] ?? '';
    }
    const newlyCancelled = cancelled && !known.cancelled;
    if (rev === device.sent_rev || (!newlyCancelled && Object.keys(was).length === 0)) {
      skippedSameRev += 1;
      continue;
    }
    pushes.push({
      device,
      rev,
      change: {
        flight,
        date: tuple.departureDate ?? device.date,
        cancelled,
        airline: sel.leg.airline?.name,
        now: tuple,
        was,
      },
    });
  }
  return { pushes, skipped_same_rev: skippedSameRev, skipped_no_leg: skippedNoLeg };
}
