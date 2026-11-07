/**
 * Live flight checks (#143): the client-side types. Type-only module (erased under node
 * type-stripping, so Spike 0 can import the utils that use it).
 *
 * `FlightLeg` mirrors the `flight-status` Lambda's normalised answer
 * (`infrastructure/lambda/flight-status/providers/aerodatabox.mjs` `mapLeg`). The client never
 * sees vendor fields; a provider swap changes the Lambda, not this shape.
 */

import type { RemoteFetchErrorCode, RemoteFetchFailure } from './remoteFetch';

/**
 * The provider's flight status, passed through verbatim from AeroDataBox's `FlightStatus` enum.
 * Spellings to confirm in Spike 0 from a real answer: note `Canceled` (one L) and
 * `CanceledUncertain`. A value outside this list is still passed through, so consumers compare
 * by equality and never switch exhaustively.
 *
 * - `Canceled`: the only status that writes to the pod (segment → `pending`).
 * - `CanceledUncertain`, `Diverted`: display-only.
 * - `Arrived`: the flight is past; its cache entry is dropped.
 */
export type FlightLegStatus =
  | 'Unknown'
  | 'Expected'
  | 'EnRoute'
  | 'CheckIn'
  | 'Boarding'
  | 'GateClosed'
  | 'Departed'
  | 'Delayed'
  | 'Approaching'
  | 'Arrived'
  | 'Canceled'
  | 'Diverted'
  | 'CanceledUncertain';

/** `IsCodeshared` = the queried number is a marketing number; the leg is still the schedule. */
export type FlightCodeshareStatus = 'Unknown' | 'IsOperator' | 'IsCodeshared';

/** One side (departure or arrival) of a leg. Times are the vendor strings, unparsed. */
interface FlightLegSideBase {
  /** IATA airport code; absent for a few small fields the vendor knows only by ICAO. */
  iata?: string;
  icao?: string;
  name?: string;
  /** IANA zone of the airport, e.g. "Asia/Singapore". */
  timeZone?: string;
  /** Scheduled wall-clock time at the airport with its offset, e.g. "2026-12-13 23:05+08:00".
   *  Absent only for an `Unknown` leg with no schedule (the matcher drops those). */
  scheduledLocal?: string;
  /** Scheduled instant in UTC, e.g. "2026-12-13 15:05Z". */
  scheduledUtc?: string;
  /** Latest estimate (display-only, never written to the pod). */
  revisedLocal?: string;
  terminal?: string;
  gate?: string;
  /** Vendor data-quality flags, e.g. ["Basic", "Live"]. */
  quality: string[];
}

export interface FlightLegDeparture extends FlightLegSideBase {
  checkInDesk?: string;
}

export interface FlightLegArrival extends FlightLegSideBase {
  baggageBelt?: string;
}

/** One normalised leg as the `flight-status` Lambda returns it. Cargo legs never arrive here. */
export interface FlightLeg {
  /** The vendor's flight number, which may carry a space ("SQ 318"). */
  number: string;
  airline?: { name?: string; iata?: string; icao?: string };
  status: FlightLegStatus | (string & {});
  codeshareStatus: FlightCodeshareStatus | (string & {});
  isCargo: boolean;
  lastUpdatedUtc?: string;
  departure: FlightLegDeparture;
  arrival: FlightLegArrival;
}

/**
 * The comparable schedule of one flight: wall-clock local to each airport, never converted
 * through the device zone. `terminal` is the departure terminal (arrival terminal is not stored
 * on a segment). On a PROVIDER tuple a field may be undefined (no published terminal, an
 * unmatched multi-stop arrival half); such a field is never compared and never written.
 */
export interface ScheduleTuple {
  departureDate?: string;
  departureTime?: string;
  terminal?: string;
  arrivalDate?: string;
  arrivalTime?: string;
}

/** The latest provider answer for one segment, held in the per-device cache. Never synced. */
export interface FlightCheck {
  v: 1;
  segmentId: string;
  /** The query sent, e.g. "SQ318". */
  flight: string;
  /** The departure date queried, YYYY-MM-DD. */
  date: string;
  /** Epoch ms (the weather cache's `fetchedAt` convention). */
  checkedAt: number;
  /** The matched leg, or null when the provider answered but nothing matched. */
  leg: FlightLeg | null;
  /** Multi-stop numbers only, with `pickLeg`'s semantics so the provider tuple's arrival half
   *  is rebuilt from the cache exactly as it was matched: absent = `leg` itself; a later sector
   *  whose arrival is the booking's; `null` = no returned sector reaches the booking's arrival
   *  code, so the arrival half stays undefined (never compared, never written). */
  arrivalLeg?: FlightLeg | null;
  /** `none` when nothing matched (`leg` is null). The AI residue arm (plan Requirement 10)
   *  would add `'ai'`; it is not built (Spike 0 has not shown an `ambiguous` booking). */
  match: 'deterministic' | 'none';
  /** Why `leg` is null: the provider returned no legs (`no_coverage`), or legs of which none
   *  is the booked flight (`no_match`, including `pickLeg` → `ambiguous`). */
  miss?: 'no_coverage' | 'no_match';
  /** "BA12" when the provider answered the marketing number with the operating flight. */
  operatedAs?: string;
}

/** Why a flight shows `unavailable`. `before_window` carries `opensAt`. A verification with
 *  `state: 'unavailable'` and NO reason is a flight inside its window whose first check on this
 *  device has not answered yet (seconds, on open). */
export type FlightUnavailableReason =
  | 'before_window'
  | 'no_coverage'
  | 'no_match'
  | 'offline'
  | 'no_flight_number'
  | 'unentitled'
  | 'disabled'
  | 'not_configured'
  | 'failed'
  /** The check window has closed (2 h after scheduled arrival, or the leg `Arrived`). */
  | 'past';

export type FlightVerificationState =
  'verified' | 'changed' | 'conflict' | 'cancelled' | 'unavailable' | 'not-live';

/** Display-only live details from the device cache. Never written to the pod. */
export interface FlightLiveInfo {
  gate?: string;
  belt?: string;
  desk?: string;
  estimatedDeparture?: string;
  estimatedArrival?: string;
  status?: string;
  operatedAs?: string;
}

/** What the card, chip, band and notices render for one segment. Six states everywhere. */
export interface FlightVerification {
  state: FlightVerificationState;
  /** Epoch ms of the last successful check on this device. */
  checkedAt?: number;
  reason?: FlightUnavailableReason;
  /** ISO; when the check window opens ("Checks from <date>"). */
  opensAt?: string;
  /** The values before the last airline change; set only when `changed`. From `liveWas` when
   *  the change is in the plan, else (`applied: false`) the plan's values of the moved fields. */
  was?: ScheduleTuple;
  /**
   * Set when a provider answer is in hand: does the plan already carry the airline's word?
   * `true` when the segment agrees with the provider tuple (or a cancellation is recorded);
   * `false` when it does not, which for `changed` means an airline change this device has
   * not written (the write failed, or this member may not edit trips): the notice says so
   * and offers no buttons. Undefined without a provider answer (the synced-fields fallback).
   */
  applied?: boolean;
  /** THIS device tapped "Got it" on the notice for the current revision: the sentence block
   *  folds away, the chip and the struck-out values stay, and the chip reopens it. Device
   *  state (`flightStatusStore.dismissNotice`), never synced; a new revision is a new notice. */
  dismissed?: boolean;
  live?: FlightLiveInfo;
  /** The airline's schedule, when a check exists. */
  provider?: ScheduleTuple;
  /** The segment's own schedule. */
  mine?: ScheduleTuple;
}

/** Every way a flight-status call can fail on the client. `not_configured` never enters the
 *  backoff ladder; it is a refresh skip reason logged once. */
export type FlightStatusErrorCode = RemoteFetchErrorCode | 'not_configured';

/** The per-segment failure record (weather's backoff shape). */
export type FlightCheckFailure = RemoteFetchFailure<FlightStatusErrorCode>;
