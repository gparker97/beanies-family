/**
 * Live flight checks (#143): WHEN a flight is checked. Pure, no logging, no store access.
 *
 * ONE departure-instant rule (`departureInstant`) feeds both the check window and the
 * per-flight interval ladder, so the two can never disagree on when a flight leaves. The
 * store evaluates `pickFlightRefresh` per candidate when a run starts, so most requests are
 * cheap skips (`fresh` is the commonest); the weather `pickWeatherRefresh` shape.
 *
 * Freshness is by TIME (`now - checkedAt < minIntervalMs`), over the segment's USABLE check
 * only (`usableCheck` in `verify.ts`): a check whose flight or date no longer fits the
 * segment (a hand edit to another day) is "no check" here, so the next run fetches the new
 * day. An apply that moves `departureDate` writes the leg's own date, which still fits, so
 * the store's own write is never a refetch. A SUPERSEDED check (`isSuperseded`: it would
 * write over a plan record another device wrote) is its own input, `superseded`, never
 * inferred from a missing check: it is fetched once, in the window or out of it.
 */
import type { FlightCheck } from '@/types/flightStatus';
import type { VacationTravelSegment } from '@/types/models';
import { wallClockInZone } from '@/utils/timeZone';
import { datePart, hhmm, parseUtcMs, splitLocal } from './schedule';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/** The window opens this long before scheduled departure (Requirement 3). */
export const WINDOW_OPENS_BEFORE_MS = 72 * HOUR_MS;
/** ...and closes this long after arrival: the scheduled one, or the airline's later estimate. */
export const WINDOW_CLOSES_AFTER_MS = 2 * HOUR_MS;
/**
 * How far past its scheduled arrival a delayed flight's estimate may hold the window open. A
 * flight delayed for hours is exactly when the people meeting it need the checks, but an
 * estimate is vendor data: one absurd value must not keep a flight being checked for days.
 */
export const MAX_DELAY_EXTENSION_MS = 24 * HOUR_MS;
/** The store's visible-tab poll. Each tick only asks; `minIntervalMs` decides. */
export const FLIGHT_POLL_MS = 15 * MINUTE_MS;

/** The per-flight floors: 6 h when more than 24 h out, 30 min inside 24 h, 10 min inside 3 h. */
export const INTERVAL_FAR_MS = 6 * HOUR_MS;
export const INTERVAL_DAY_MS = 30 * MINUTE_MS;
export const INTERVAL_NEAR_MS = 10 * MINUTE_MS;
/**
 * The floors while a flight is only still in its window because the airline's estimate is later
 * than the schedule (a long delay), from the time left before the estimate: hourly when it is
 * more than 3 h off, every 30 min inside 3 h, and the near floor from 1 h before it (the
 * approach, the landing and the belt). The wait can last many hours and each check may be a
 * provider call against the daily cap, so it is only as fast as the landing is near.
 */
export const INTERVAL_OVERDUE_FAR_MS = HOUR_MS;
export const INTERVAL_OVERDUE_MS = 30 * MINUTE_MS;
/**
 * The floor for a check the person asked for ("Check now"): a flight inside its window is
 * asked again once its last answer is this old, whatever the automatic floor says. Only ever
 * LOWERS a floor (inside 3 h the automatic one is already tighter than most taps), and changes
 * nothing else: the window, the backoff and every refusal apply to a tap exactly as to a tick,
 * so a tap can never spend more than one provider call per flight per five minutes.
 */
export const MANUAL_CHECK_FLOOR_MS = 5 * MINUTE_MS;

type TimedSegment = Pick<
  VacationTravelSegment,
  'departureDate' | 'departureTime' | 'arrivalDate' | 'arrivalTime'
>;

/** The stored date's `YYYY-MM-DD` (`datePart`, the tuple rule), only when it is one. */
function ymd(value: string | undefined): string | undefined {
  const d = datePart(value);
  return d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : undefined;
}

/**
 * The instant a wall-clock `YYYY-MM-DD` + `HH:mm` names in `zone`. Two correction passes
 * settle any offset, DST edges included (a skipped wall time lands on the next valid one).
 * Null for a malformed date or an unknown zone (`wallClockInZone` throws on those).
 */
export function zonedInstant(date: string, time: string, zone: string): number | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const t = /^(\d{2}):(\d{2})$/.exec(time);
  if (!d || !t) return null;
  const target = Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]), Number(t[1]), Number(t[2]));
  if (Number.isNaN(target)) return null;
  let guess = target;
  try {
    for (let i = 0; i < 2; i++) {
      const seen = wallClockInZone(new Date(guess), zone);
      const s = /^(\d{4})-(\d{2})-(\d{2})$/.exec(seen.ymd);
      const st = /^(\d{2}):(\d{2})$/.exec(seen.hhmm);
      if (!s || !st) return null;
      const seenMs = Date.UTC(
        Number(s[1]),
        Number(s[2]) - 1,
        Number(s[3]),
        Number(st[1]),
        Number(st[2])
      );
      guess += target - seenMs;
    }
  } catch {
    return null;
  }
  return guess;
}

/** The cached leg is the segment's flight on the segment's CURRENT date: a leg cached before a
 *  family member moved the booking to another day says nothing about the new day. */
function cachedLegFits(seg: TimedSegment, check: FlightCheck | undefined): boolean {
  const legDate = splitLocal(check?.leg?.departure.scheduledLocal)?.date;
  return !!legDate && legDate === ymd(seg.departureDate);
}

/**
 * When the flight leaves, the single rule: the cached leg's `scheduledUtc` when a fitting
 * check exists (the airport's own zone, exact); else the segment's departure date + time read
 * in the family home zone; else that date at 00:00 home zone (Requirement 3 admits date-only
 * flights). Null without a departure date.
 */
export function departureInstant(
  seg: TimedSegment,
  check: FlightCheck | undefined,
  homeZone: string
): number | null {
  if (cachedLegFits(seg, check)) {
    const utc = parseUtcMs(check!.leg!.departure.scheduledUtc);
    if (utc !== null) return utc;
  }
  const date = ymd(seg.departureDate);
  if (!date) return null;
  return zonedInstant(date, hhmm(seg.departureTime) ?? '00:00', homeZone);
}

/**
 * When the flight lands: the cached arrival sector's `scheduledUtc` when a fitting check
 * exists; else the segment's arrival date (or the departure date) + arrival time in the home
 * zone; else null (the window then closes on the departure instant).
 */
export function arrivalInstant(
  seg: TimedSegment,
  check: FlightCheck | undefined,
  homeZone: string
): number | null {
  if (cachedLegFits(seg, check)) {
    const arrivalLeg = check!.arrivalLeg === undefined ? check!.leg : check!.arrivalLeg;
    const utc = parseUtcMs(arrivalLeg?.arrival.scheduledUtc);
    if (utc !== null) return utc;
  }
  const time = hhmm(seg.arrivalTime);
  const date = ymd(seg.arrivalDate) ?? ymd(seg.departureDate);
  if (!time || !date) return null;
  return zonedInstant(date, time, homeZone);
}

/** A flight that will not land: its last estimate must not hold the window open. */
const isCancelled = (status: string | undefined): boolean =>
  status === 'Canceled' || status === 'CanceledUncertain';

/**
 * When the airline now expects the flight to land, from a fitting cached check: the arrival
 * sector's `revisedLocal` (a wall clock WITH its offset, so it is an instant); or, when only
 * the departure has been revised (the usual state of a flight delayed on the ground), the
 * scheduled arrival moved by the departure's delay.
 *
 * Null without a fitting check, for a cancelled flight, without any estimate, for a value that
 * names no zone, or when the arrival sector carries no `scheduledUtc`: the estimate is then
 * compared with nothing from the same leg (the segment's own arrival time is read in the home
 * zone, and that gap would look like a delay).
 */
export function estimatedArrivalInstant(
  seg: TimedSegment,
  check: FlightCheck | undefined
): number | null {
  if (!cachedLegFits(seg, check)) return null;
  const leg = check!.leg!;
  const arrivalLeg = check!.arrivalLeg === undefined ? leg : check!.arrivalLeg;
  if (!arrivalLeg || isCancelled(leg.status) || isCancelled(arrivalLeg.status)) return null;
  const scheduled = parseUtcMs(arrivalLeg.arrival.scheduledUtc);
  if (scheduled === null) return null;
  const revised = parseUtcMs(arrivalLeg.arrival.revisedLocal);
  if (revised !== null) return revised;
  const departs = parseUtcMs(leg.departure.scheduledUtc);
  const departsRevised = parseUtcMs(leg.departure.revisedLocal);
  if (departs === null || departsRevised === null || departsRevised <= departs) return null;
  return scheduled + (departsRevised - departs);
}

/**
 * The arrival the window closes on: the scheduled one, or the airline's estimate when that is
 * later, held to `MAX_DELAY_EXTENSION_MS` past the schedule. An estimate EARLIER than the
 * schedule never closes the window sooner (the leg reading Arrived does that).
 */
export function windowArrival(arrivalMs: number | null, estimateMs: number | null): number | null {
  if (arrivalMs === null || estimateMs === null || estimateMs <= arrivalMs) return arrivalMs;
  return Math.min(estimateMs, arrivalMs + MAX_DELAY_EXTENSION_MS);
}

export interface CheckWindow {
  /** Now is inside [departure - 72 h, arrival + 2 h]. */
  inWindow: boolean;
  /** The window has closed: the flight is over. */
  past: boolean;
  /** Epoch ms the window opens; set only while it has not opened yet ("Checks from <date>"). */
  opensAt?: number;
  /** Epoch ms the window closes. */
  closesAt: number;
}

/**
 * The check window: 72 h before scheduled departure to 2 h after arrival (`flightTiming` passes
 * `windowArrival`: the schedule, or a later estimate). An
 * unknown arrival (or one before departure, a data error) closes on the departure instant.
 */
export function checkWindow(
  departureMs: number,
  arrivalMs: number | null,
  nowMs: number
): CheckWindow {
  const opens = departureMs - WINDOW_OPENS_BEFORE_MS;
  const closesAt = Math.max(departureMs, arrivalMs ?? departureMs) + WINDOW_CLOSES_AFTER_MS;
  if (nowMs < opens) return { inWindow: false, past: false, opensAt: opens, closesAt };
  if (nowMs > closesAt) return { inWindow: false, past: true, closesAt };
  return { inWindow: true, past: false, closesAt };
}

/** The floor while a delayed flight is held in its window by its estimate (see the constants). */
export function overdueIntervalMs(estimateMs: number, nowMs: number): number {
  const left = estimateMs - nowMs;
  if (left > 3 * HOUR_MS) return INTERVAL_OVERDUE_FAR_MS;
  if (left > HOUR_MS) return INTERVAL_OVERDUE_MS;
  return INTERVAL_NEAR_MS;
}

/** The per-flight floor between two checks, from the time left before departure. */
export function minIntervalMs(departureMs: number, nowMs: number): number {
  const left = departureMs - nowMs;
  if (left > 24 * HOUR_MS) return INTERVAL_FAR_MS;
  if (left > 3 * HOUR_MS) return INTERVAL_DAY_MS;
  return INTERVAL_NEAR_MS;
}

export interface FlightTiming {
  departureMs: number | null;
  arrivalMs: number | null;
  inWindow: boolean;
  /** Window closed (2 h after the scheduled arrival, or after a later estimate), or the cached
   *  leg reports `Arrived`. */
  past: boolean;
  /** Scheduled departure has passed (drives the end of the `changed` notice). */
  departed: boolean;
  opensAt?: number;
  minIntervalMs: number;
}

/**
 * Everything the store and `deriveVerification` need about one flight's timing, from the one
 * departure rule. No departure date → not in window, not past, the far interval (the store's
 * candidates always have a date; this is the total answer for any flight segment).
 */
export function flightTiming(
  seg: TimedSegment,
  check: FlightCheck | undefined,
  homeZone: string,
  nowMs: number
): FlightTiming {
  const departureMs = departureInstant(seg, check, homeZone);
  const arrivalMs = arrivalInstant(seg, check, homeZone);
  if (departureMs === null) {
    return {
      departureMs,
      arrivalMs,
      inWindow: false,
      past: false,
      departed: false,
      minIntervalMs: INTERVAL_FAR_MS,
    };
  }
  // A delayed flight stays in its window until 2 h after the airline's estimate: the people
  // meeting it need the estimate, the belt and "Arrived" most when the wait is long.
  const landsMs = windowArrival(arrivalMs, estimatedArrivalInstant(seg, check));
  const w = checkWindow(departureMs, landsMs, nowMs);
  const arrived = cachedLegFits(seg, check) && check?.leg?.status === 'Arrived';
  const past = w.past || arrived;
  // In the window only thanks to the estimate: the scheduled window would have closed by now.
  const overdue =
    !past && nowMs > Math.max(departureMs, arrivalMs ?? departureMs) + WINDOW_CLOSES_AFTER_MS;
  return {
    departureMs,
    arrivalMs,
    inWindow: w.inWindow && !past,
    past,
    departed: nowMs >= departureMs,
    ...(w.opensAt !== undefined ? { opensAt: w.opensAt } : {}),
    minIntervalMs:
      overdue && landsMs !== null
        ? overdueIntervalMs(landsMs, nowMs)
        : minIntervalMs(departureMs, nowMs),
  };
}

/** Why a flight was not fetched this run, checked in this order. Rides `detail` (histogram). */
export type FlightSkipReason =
  | 'halted'
  | 'unentitled'
  | 'disabled'
  | 'not_configured'
  | 'offline'
  | 'no_flight_number'
  | 'past'
  | 'out_of_window'
  | 'backoff'
  | 'fresh';

export type FlightRefreshDecision =
  | { action: 'skip'; reason: FlightSkipReason }
  | { action: 'fetch'; reason: 'no-check' | 'stale' | 'entry' | 'superseded' };

export interface FlightRefreshInput {
  /** Sign-out is under way (`haltForSignOut`). */
  halted: boolean;
  /** The family's plan includes live checks (`flightStatusStore.isEntitled`). */
  entitled: boolean;
  /** The device's Live Flight Checks switch. */
  enabled: boolean;
  /** `VITE_FLIGHT_STATUS_URL` and its key are set. */
  configured: boolean;
  online: boolean;
  /** `normaliseFlightNumber` found a carrier + digits. */
  hasFlightNumber: boolean;
  /** From `flightTiming`. */
  past: boolean;
  inWindow: boolean;
  nowMs: number;
  /** `checkedAt` of this device's last USABLE answer for the flight (`usableCheck`), or null:
   *  an answer for another flight number or another day, or a superseded one, counts as none.
   *  Never read for a superseded flight (`superseded` decides first). */
  lastCheckedAt: number | null;
  /** From `flightTiming` (`minIntervalMs`). */
  minIntervalMs: number;
  /** Epoch ms before which a failure's backoff holds (0 when none). */
  backoffUntil: number;
  /** The person tapped "Check now" for this flight: the freshness floor is at most
   *  `MANUAL_CHECK_FLOOR_MS`. Nothing else changes. */
  manual?: boolean;
  /** This device has already issued an out-of-window check for this segment's CURRENT
   *  question (`entryChecked` stamp equals `entryQuestion`). Inert inside the window. */
  entryDone: boolean;
  /** This device's cached answer for the flight would write over a plan record it has not
   *  seen beside it (`isSuperseded` in `verify.ts`): asked again once, past the entry stamp and
   *  the freshness floor, never past a device gate or the failure backoff. */
  superseded: boolean;
}

/** The refresh decision for one flight. Skip reasons are checked in `FlightSkipReason` order:
 *  the device-wide gates first, then the flight's own.
 *
 * Out of the window a flight is fetched ONCE per question (`'entry'`: its number, day and
 * airports as entered), so a typo or an already-moved schedule shows up when the flight is
 * typed, not three days before departure. The stamp (`entryDone`) is the only out-of-window
 * gate: not the trigger kind (`segment-changed` also fires on every doc load), not the clock,
 * and not `lastCheckedAt` (a usable `no_match` answer must not block a re-ask once the
 * question changes). The decision lives here so `backoff` and the stamp are one ordering.
 *
 * A superseded answer (`superseded`) is asked again as `'superseded'`, in the window or out of
 * it, whatever the stamp or `lastCheckedAt` say (out of the window with no stamp yet it goes as
 * the `'entry'` it already is). The store sets an out-of-window one aside when it is issued, so
 * a refetch that fails is not asked again; a fresh answer remembers the record, so one foreign
 * write costs one fetch. */
export function pickFlightRefresh(input: FlightRefreshInput): FlightRefreshDecision {
  if (input.halted) return { action: 'skip', reason: 'halted' };
  if (!input.entitled) return { action: 'skip', reason: 'unentitled' };
  if (!input.enabled) return { action: 'skip', reason: 'disabled' };
  if (!input.configured) return { action: 'skip', reason: 'not_configured' };
  if (!input.online) return { action: 'skip', reason: 'offline' };
  if (!input.hasFlightNumber) return { action: 'skip', reason: 'no_flight_number' };
  if (input.past) return { action: 'skip', reason: 'past' };
  if (!input.inWindow && input.entryDone && !input.superseded) {
    return { action: 'skip', reason: 'out_of_window' };
  }
  if (input.nowMs < input.backoffUntil) return { action: 'skip', reason: 'backoff' };
  if (!input.inWindow) return { action: 'fetch', reason: input.entryDone ? 'superseded' : 'entry' };
  if (input.superseded) return { action: 'fetch', reason: 'superseded' };
  if (input.lastCheckedAt === null) return { action: 'fetch', reason: 'no-check' };
  const floor = input.manual
    ? Math.min(input.minIntervalMs, MANUAL_CHECK_FLOOR_MS)
    : input.minIntervalMs;
  if (input.nowMs - input.lastCheckedAt < floor) {
    return { action: 'skip', reason: 'fresh' };
  }
  return { action: 'fetch', reason: 'stale' };
}
