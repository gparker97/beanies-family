/**
 * Live flight checks, Phase 2 (#143, ADR-046): the PURE decisions behind this device's flight
 * alert registrations with the `flight-status` Lambda. The store makes the calls these
 * return and adds nothing (the `window.ts` shape): no Pinia, no I/O, no logging.
 *
 *   desiredAlerts    which flights this device should be registered for right now;
 *   diffAlerts       the subscribe / unsubscribe calls that move the registered set there;
 *   registrationRev  the revision a registration tells the server this device already knows;
 *   pushCovered      whether a push was the notice for a revision (the local OS notice is
 *                    then suppressed, `flightStatusStore.noticeFirstSeen`). Only a CONFIRMED
 *                    registration (the server answered `ready`) counts as evidence.
 *
 * `rev` is the evidence both ends read. The server seeds `sent_rev` from it, so it never
 * pushes a revision this device knows; and while it differs from the segment's
 * `liveRevision`, the server was told this device did NOT know that revision, so the push it
 * sent was the notice. The server's leg choice and revision are restated in
 * `infrastructure/lambda/flight-status/schedule.mjs` and pinned by `scheduleParity.test.ts`.
 */
import type { AlertRegistration, FlightCheck } from '@/types/flightStatus';
import type { UUID, VacationTravelSegment } from '@/types/models';
import { isChangeRecipient, type ChangeAudienceMember } from './audience';
import { normaliseFlightNumber } from './flightNumber';
import { revisionOf, tupleFromLeg } from './schedule';
import { cancelRevisionOf, usableCheck } from './verify';
import { flightTiming } from './window';

/** Alert calls (subscribe + unsubscribe) per run at most; the rest wait for the next trigger
 *  (the `MAX_FETCHES_PER_RUN` pattern). */
export const MAX_ALERT_CALLS_PER_RUN = 8;

const DAY_MS = 86_400_000;

/** What the device tells the server; `confirmed` is what the server said back, so it is
 *  device state and never part of a spec or the request body. */
type RegistrationFields = Omit<AlertRegistration, 'confirmed'>;

/** One registration the device wants: what the server is told, keyed by segment. */
export interface AlertSpec extends RegistrationFields {
  segmentId: string;
}

/** What an unsubscribe names: the server item is flight + date + push token. */
export interface AlertKey {
  segmentId: string;
  flight: string;
  date: string;
  token: string;
}

/** A flight segment in an upcoming trip, with the trip's travellers (the recipient rule). */
export interface AlertCandidate {
  segment: VacationTravelSegment;
  tripAssigneeIds: UUID[];
}

/** The device facts `desiredAlerts` needs beside the candidates and their checks. */
export interface AlertContext {
  nowMs: number;
  /** `flightStatusStore.alertsEnabled`: the device switch AND the plan gate. */
  alertsEnabled: boolean;
  /** This device's member; null before the family has loaded (nothing is desired). */
  currentMember: ChangeAudienceMember | null;
  /** The entitlement's alert token, or null (none, or rejected by the server this session). */
  alertToken: string | null;
  /** The family home zone, for the check window (`flightTiming`). */
  homeZone: string;
}

/**
 * The token's expiry in epoch ms, from its `v1.<exp>.<sig>` shape (`exp` in epoch seconds);
 * null when the token is not that shape. Only the server verifies the signature: this is the
 * device's "do not even ask with an expired token" check.
 */
export function alertTokenExpiry(token: string | null): number | null {
  const m = /^v1\.(\d{1,12})\.[A-Za-z0-9_-]+$/.exec(token ?? '');
  return m ? Number(m[1]) * 1000 : null;
}

/**
 * The revision this device's PLAN holds for the segment: its `liveRevision` when it carries
 * one (the last applied provider tuple, a cancel marker included), else the matched leg's own
 * (`cancelRevisionOf` for a `Canceled` leg). A device that may not write keeps saying "I know
 * the old one" until the change syncs in, which is exactly the suppression evidence.
 */
export function registrationRev(
  seg: Pick<VacationTravelSegment, 'liveRevision'>,
  check: Pick<FlightCheck, 'leg' | 'arrivalLeg'> & { leg: NonNullable<FlightCheck['leg']> }
): string {
  if (seg.liveRevision) return seg.liveRevision;
  const tuple = tupleFromLeg(check.leg, check.arrivalLeg);
  return check.leg.status === 'Canceled' ? cancelRevisionOf(tuple) : revisionOf(tuple);
}

/** The segment's departure date (`YYYY-MM-DD`), or null. */
function dayOf(seg: Pick<VacationTravelSegment, 'departureDate'>): string | null {
  const day = seg.departureDate?.trim().slice(0, 10);
  return day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}

/**
 * True when a registered `flight` + `date` still names this segment's flight: the same
 * normalised number, departing within a day of the registered date. A day either way, not
 * equality, because the server can select an off-date leg too (`legForCodes`: one departing
 * within 12 h of the departure the device knows): an airline retime that moves the flight past
 * midnight is still pushed to the registration made for the old day, so it must still count as it.
 */
export function sameFlightDay(
  registered: Pick<AlertRegistration, 'flight' | 'date'>,
  seg: Pick<VacationTravelSegment, 'airline' | 'flightNumber' | 'departureDate'>
): boolean {
  const number = normaliseFlightNumber(seg.airline, seg.flightNumber);
  const day = dayOf(seg);
  if (!number || !day || number.query !== registered.flight) return false;
  const a = Date.parse(`${registered.date}T00:00:00Z`);
  const b = Date.parse(`${day}T00:00:00Z`);
  return !Number.isNaN(a) && Math.abs(a - b) <= DAY_MS;
}

/**
 * The registrations this device should hold, by segment id. A candidate is desired only when
 * all six hold (plan requirement 15):
 *   (i)   now is inside its check window (72 h before departure to 2 h after arrival);
 *   (ii)  it has a normalised flight number and a date;
 *   (iii) alerts are on (`alertsEnabled`);
 *   (iv)  this device's member receives its change notice (`isChangeRecipient`);
 *   (v)   an unexpired alert token is held;
 *   (vi)  this device holds a usable matched leg with a departure code (a flight this device
 *         could not match, the server cannot match either).
 * The push token is NOT a condition: the reconcile acquires one when this is non-empty.
 */
export function desiredAlerts(
  candidates: readonly AlertCandidate[],
  checks: Readonly<Record<string, FlightCheck>>,
  ctx: AlertContext
): Map<string, AlertSpec> {
  const out = new Map<string, AlertSpec>();
  const expiry = alertTokenExpiry(ctx.alertToken);
  const member = ctx.currentMember;
  if (!ctx.alertsEnabled || !member || expiry === null || expiry <= ctx.nowMs) return out;
  for (const c of candidates) {
    const seg = c.segment;
    const number = normaliseFlightNumber(seg.airline, seg.flightNumber);
    const date = dayOf(seg);
    const check = usableCheck(seg, checks[seg.id]);
    const leg = check?.leg;
    const dep = leg?.departure.iata;
    if (!number || !date || !check || !leg || !dep) continue;
    if (!flightTiming(seg, check, ctx.homeZone, ctx.nowMs).inWindow) continue;
    if (
      !isChangeRecipient(member, {
        travellerIds: seg.travellerIds,
        tripAssigneeIds: c.tripAssigneeIds,
      })
    ) {
      continue;
    }
    // The provider's own arrival code for the sector this device matched: absent `arrivalLeg`
    // is the leg itself, `null` is "no sector reaches the booking's arrival" (no arrival half).
    const arrivalSector = check.arrivalLeg === undefined ? leg : check.arrivalLeg;
    const arr = arrivalSector?.arrival.iata;
    out.set(seg.id, {
      segmentId: seg.id,
      flight: number.query,
      date,
      dep,
      ...(arr ? { arr } : {}),
      rev: registrationRev(seg, { leg, arrivalLeg: check.arrivalLeg }),
    });
  }
  return out;
}

/** The registered set as the device record holds it: entries plus the ONE token. */
export interface RegisteredAlerts {
  alerts: Readonly<Record<string, AlertRegistration>>;
  pushToken: string | null;
}

export interface AlertPlan {
  subscribe: AlertSpec[];
  unsubscribe: AlertKey[];
  /** Calls left for a later run by the cap. */
  overCap: number;
  /** Desired registrations held identical and confirmed (no call needed). */
  unchanged: number;
  /**
   * Kept subscribes that re-ask an identical but unconfirmed registration. Counted from the
   * kept totals (room left after unsubscribes goes to fresh subscribes first, then re-asks),
   * so it does not depend on the order of the `subscribe` array.
   */
  reconfirm: number;
  /**
   * The push token differs from the one the registrations were made under (or none was
   * recorded): every registration is replaced. The store adopts the new token BEFORE the calls
   * (forgetting the old registrations, which `unsubscribe` names under the old token).
   */
  retoken: boolean;
}

function sameRegistration(a: RegistrationFields, b: RegistrationFields): boolean {
  return (
    a.flight === b.flight &&
    a.date === b.date &&
    a.dep === b.dep &&
    a.arr === b.arr &&
    a.rev === b.rev
  );
}

/**
 * The calls that move `registered` to `desired`, unsubscribes first, at most `max` in all.
 *  - Normal: subscribe every desired spec not registered or registered differently (a new
 *    `rev`, other provider codes); unsubscribe every registration no longer desired, and the
 *    old flight + date of one whose flight or date changed (the server key moved).
 *  - An identical but UNCONFIRMED registration (the server answered `pending` or something
 *    unreadable) is re-asked every run until it answers `ready`, after the fresh subscribes.
 *  - `retoken` (a new push token): unsubscribe every registration under the OLD token and
 *    subscribe every desired spec under the new one.
 *  - No push token: no subscribes (the run registers nothing); unsubscribes still go, under
 *    the token they were registered with.
 * Unsubscribes come first so a full cap still clears what is gone before adding; whatever the
 * cap leaves is still desired-but-unregistered (or registered-but-unwanted) and the next run
 * picks it up. The one exception is `retoken`: its old-token unsubscribes are forgotten with
 * the old registrations, so those beyond the cap are left to the server's TTL; that needs more
 * than `max` flights registered at once.
 */
export function diffAlerts(
  desired: ReadonlyMap<string, AlertSpec>,
  registered: RegisteredAlerts,
  pushToken: string | null,
  max: number = MAX_ALERT_CALLS_PER_RUN
): AlertPlan {
  const retoken = pushToken !== null && registered.pushToken !== pushToken;
  const oldToken = registered.pushToken;
  const unsubscribe: AlertKey[] = [];
  const fresh: AlertSpec[] = [];
  const reask: AlertSpec[] = [];
  for (const [segmentId, reg] of Object.entries(registered.alerts)) {
    const want = desired.get(segmentId);
    const keyMoved = !want || want.flight !== reg.flight || want.date !== reg.date;
    if (oldToken !== null && (retoken || keyMoved)) {
      unsubscribe.push({ segmentId, flight: reg.flight, date: reg.date, token: oldToken });
    }
  }
  if (pushToken !== null) {
    for (const spec of desired.values()) {
      const reg = registered.alerts[spec.segmentId];
      if (retoken || !reg || !sameRegistration(reg, spec)) fresh.push(spec);
      else if (!reg.confirmed) reask.push(spec);
    }
  }
  const unchanged = pushToken === null ? 0 : desired.size - fresh.length - reask.length;
  const calls = unsubscribe.length + fresh.length + reask.length;
  const cap = Math.max(0, Math.floor(max));
  const unsubKept = unsubscribe.slice(0, cap);
  const room = cap - unsubKept.length;
  const freshKept = Math.min(fresh.length, room);
  const reaskKept = Math.min(reask.length, room - freshKept);
  const subKept = [...fresh.slice(0, freshKept), ...reask.slice(0, reaskKept)];
  return {
    subscribe: subKept,
    unsubscribe: unsubKept,
    overCap: calls - unsubKept.length - subKept.length,
    unchanged,
    reconfirm: reaskKept,
    retoken,
  };
}

/**
 * Was the push the notice for the segment's current revision? True when this device holds a
 * registration for the segment's current flight (`sameFlightDay`) whose `rev` is NOT
 * `liveRevision`: the server was told this device did not know that revision, so it pushed
 * it. False with no registration, a registration for another flight or day, the same `rev`
 * (the device knew it when it registered: no push was owed), or no revision at all. An
 * unconfirmed registration is not evidence: the server may hold no subscription for the number.
 */
export function pushCovered(
  alert: AlertRegistration | undefined,
  seg: Pick<VacationTravelSegment, 'airline' | 'flightNumber' | 'departureDate'>,
  liveRevision: string | undefined
): boolean {
  if (!alert?.confirmed || !liveRevision) return false;
  return sameFlightDay(alert, seg) && alert.rev !== liveRevision;
}
