/**
 * Live flight checks (#143): what a flight's check MEANS, and what it writes.
 *
 * `deriveVerification` is the state machine of plan Requirements 4-8, pure, so the chip, band,
 * notice, briefing and bell agree on every device. `shouldApply` / `planChange` / `revertPlan`
 * are the only places a segment patch is decided; the store performs them through
 * `vacationStore.updateSegment` and adds nothing. No mode flags: `shouldApply` is the
 * idempotency predicate, `planChange` always builds the full patch for what it is given.
 *
 * Six states, everywhere:
 *   not-live     non-flight segment types (trains, ferries, cruises...).
 *   unavailable  with a reason (or none = the first check has not answered yet).
 *   cancelled    the live leg says `Canceled`; with no check on this device, the synced
 *                cancel marker (`isCancelRevision(liveRevision)`) while `status` is `pending`.
 *   conflict     a provider tuple exists, its revision is the one recorded, and the segment
 *                disagrees with it: a manual edit (or "Put it back") after an apply. Never
 *                derived without a provider tuple, never shown as a fake tick.
 *   changed      an airline change, with `applied`:
 *                  true   it was applied (`liveAppliedAt`), the segment agrees with the
 *                         provider, and the flight has not left; `was` is the `liveWas` tuple;
 *                  false  the provider differs and its revision is NOT the one recorded: this
 *                         device has not written it (the write failed, or this member may not
 *                         edit trips); `was` is the plan's values of the moved fields.
 *   verified     the segment agrees with the provider.
 */
import type {
  FlightCheck,
  FlightCheckFailure,
  FlightLeg,
  FlightLiveInfo,
  FlightVerification,
  ScheduleTuple,
} from '@/types/flightStatus';
import type { LanguageCode, VacationTravelSegment } from '@/types/models';
import type { TranslateFn } from '@/utils/format';
import { isFlightType } from '@/utils/travelCodes';
import { arrivalDayOffset } from '@/utils/vacation';
import { normaliseFlightNumber } from './flightNumber';
import {
  TUPLE_FIELDS,
  diffTuple,
  revisionOf,
  splitLocal,
  tupleFromLeg,
  tupleFromSegment,
  tupleFromWas,
  tuplesEqual,
} from './schedule';
import { airlineName, cancelNoteLine, changeNoteLine, fillNoteLine, localYmd } from './copy';

/** A partial segment, as `vacationStore.updateSegment` merges it. */
export type SegmentPatch = Partial<VacationTravelSegment>;

/** The device facts `deriveVerification` needs beside the segment and its cache entries. */
export interface VerifyContext {
  nowMs: number;
  /** From `flightTiming` (`utils/flightStatus/window.ts`): now is inside the check window. */
  inWindow: boolean;
  /** ISO; set only before the window opens ("Checks from <date>"). */
  opensAt?: string;
  /** The window has closed (or the leg `Arrived`). */
  past: boolean;
  /** Scheduled departure has passed: `changed` ends here. */
  departed: boolean;
  /** The device's Live Flight Checks switch. */
  enabled: boolean;
  /** The family's plan includes live checks. */
  entitled: boolean;
  /** The flight-status endpoint is configured in this build. */
  configured: boolean;
  online: boolean;
}

/** The translator + language the notes lines are written in (`planChange` only). */
export interface PatchCopy {
  t: TranslateFn;
  lang?: LanguageCode;
}

/**
 * The cached check, when it still answers THIS segment's question; else undefined (treated as
 * no check everywhere: `deriveVerification`, the store's refresh decision, "Use the
 * airline's"). It must have queried the segment's current flight number, AND be about the
 * segment's current day: the day it queried (`check.date`) or the matched leg's own local
 * departure day. A hand edit to another day therefore drops it and the next run fetches the
 * new day; an apply writes the leg's day, and "Put it back" restores the queried day, so
 * neither drops it (no refetch loop, and the Conflict stays visible).
 */
export function usableCheck(
  seg: Pick<VacationTravelSegment, 'airline' | 'flightNumber' | 'departureDate'>,
  check: FlightCheck | undefined
): FlightCheck | undefined {
  if (!check) return undefined;
  const number = normaliseFlightNumber(seg.airline, seg.flightNumber);
  const day = seg.departureDate?.trim().slice(0, 10);
  if (!number || check.flight !== number.query || !day) return undefined;
  if (check.date === day) return check;
  const legDay = check.leg ? splitLocal(check.leg.departure.scheduledLocal)?.date : undefined;
  return legDay === day ? check : undefined;
}

/** The provider's schedule as cached: `arrivalLeg` absent = `leg`, null = no arrival half. */
export function providerTuple(
  check: Pick<FlightCheck, 'leg' | 'arrivalLeg'>
): ScheduleTuple | null {
  return check.leg ? tupleFromLeg(check.leg, check.arrivalLeg) : null;
}

/** The leg the arrival half comes from (`leg` when absent; null = unknown). */
function arrivalSide(leg: FlightLeg, arrivalLeg: FlightLeg | null | undefined): FlightLeg | null {
  return arrivalLeg === undefined ? leg : arrivalLeg;
}

function compact<T extends object>(o: T): T {
  const out = {} as T;
  for (const [k, v] of Object.entries(o)) {
    if (v !== undefined && v !== '') (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

/** Display-only live details from the cached legs. Never written to the pod. */
function liveInfo(check: FlightCheck, leg: FlightLeg): FlightLiveInfo | undefined {
  const arr = arrivalSide(leg, check.arrivalLeg);
  const live = compact<FlightLiveInfo>({
    gate: leg.departure.gate?.trim(),
    desk: leg.departure.checkInDesk?.trim(),
    belt: arr?.arrival.baggageBelt?.trim(),
    estimatedDeparture: leg.departure.revisedLocal,
    estimatedArrival: arr?.arrival.revisedLocal,
    status: leg.status,
    operatedAs: check.operatedAs,
  });
  return Object.keys(live).length > 0 ? live : undefined;
}

/**
 * The verification for one segment on this device. `check`/`failure` are this device's cache
 * entries for the segment (undefined when there are none).
 *
 * A check is ignored (the provider tuple is then unknown) when live checks are off for this
 * device (unentitled, disabled, not configured) or when it is not `usableCheck` for the
 * segment (another flight number, another day). With no usable provider tuple the state falls
 * back to the SYNCED fields alone, so a second device shows what the first applied before its
 * own first fetch: `cancelled` (the cancel marker + `pending`), `changed` (`liveAppliedAt`,
 * not departed, and the segment still differs from `liveWas`), else `unavailable`.
 */
export function deriveVerification(
  seg: VacationTravelSegment,
  check: FlightCheck | undefined,
  failure: FlightCheckFailure | undefined,
  ctx: VerifyContext
): FlightVerification {
  if (!isFlightType(seg.type)) return { state: 'not-live' };

  const mine = tupleFromSegment(seg);
  // A flight that is over is over, first: no cancelled / changed / conflict news (and no
  // chip, `hasFlightChip`) for last week's flight, whatever the leg or the synced fields say.
  if (ctx.past) return { state: 'unavailable', mine, reason: 'past' };

  const was = tupleFromWas(seg.liveWas);
  const number = normaliseFlightNumber(seg.airline, seg.flightNumber);
  const gate: FlightVerification['reason'] = !ctx.entitled
    ? 'unentitled'
    : !ctx.enabled
      ? 'disabled'
      : !ctx.configured
        ? 'not_configured'
        : undefined;
  const usable = gate === undefined ? usableCheck(seg, check) : undefined;

  // ── A provider tuple exists: the live leg decides. ─────────────────────────
  if (usable?.leg) {
    const leg = usable.leg;
    const provider = tupleFromLeg(leg, usable.arrivalLeg);
    const base: FlightVerification = {
      state: 'verified',
      checkedAt: usable.checkedAt,
      provider,
      mine,
      ...(liveInfo(usable, leg) ? { live: liveInfo(usable, leg) } : {}),
    };
    if (leg.status === 'Canceled') {
      // The family re-booked after this cancellation was recorded: their choice stands, and
      // the disagreement is the Conflict (with `live.status: 'Canceled'` for the notice copy).
      const recorded = isCancelRevision(seg.liveRevision);
      if (recorded && seg.status !== 'pending') return { ...base, state: 'conflict' };
      return { ...base, state: 'cancelled', applied: recorded };
    }
    if (!tuplesEqual(mine, provider)) {
      // The recorded revision, edited away from by hand (or "Put it back"): the Conflict.
      if (revisionOf(provider) === seg.liveRevision) {
        return { ...base, state: 'conflict', applied: false };
      }
      // Not recorded yet (a failed write, or this member may not edit trips). Values the
      // booking never had (a terminal published later) are a quiet fill, never announced, so
      // they alone leave the chip `verified`. A real move is `changed` with `applied: false`:
      // never a Conflict the family did not cause, never a fake tick.
      const { changed } = diffTuple(mine, provider);
      if (changed.length === 0) return { ...base, applied: false };
      // `was` in the `liveWas` shape: the plan's values of the fields the airline moved.
      const planned: ScheduleTuple = {};
      for (const f of changed) planned[f] = mine[f];
      return { ...base, state: 'changed', applied: false, was: planned };
    }
    if (seg.liveAppliedAt && !ctx.departed && was) {
      return { ...base, state: 'changed', applied: true, was };
    }
    return { ...base, applied: true };
  }

  // ── No provider tuple: the synced fields alone. ────────────────────────────
  if (isCancelRevision(seg.liveRevision) && seg.status === 'pending') {
    return { state: 'cancelled', mine };
  }
  if (seg.liveAppliedAt && !ctx.departed && was && !tuplesEqual(mine, was)) {
    return { state: 'changed', mine, was };
  }

  const unavailable = (reason?: FlightVerification['reason']): FlightVerification => ({
    state: 'unavailable',
    mine,
    ...(reason ? { reason } : {}),
  });
  if (gate) return unavailable(gate);
  // A check needs a carrier + digits AND a date; a booking missing either reads the same.
  if (!number || !seg.departureDate) return unavailable('no_flight_number');
  if (!ctx.inWindow) {
    return ctx.opensAt
      ? { ...unavailable('before_window'), opensAt: ctx.opensAt }
      : unavailable('before_window');
  }
  if (usable) return unavailable(usable.miss ?? 'no_match');
  if (!ctx.online) return unavailable('offline');
  if (failure) return unavailable('failed');
  // Inside the window, online, never answered: the first check is on its way.
  return unavailable();
}

// ── Writes ───────────────────────────────────────────────────────────────────

/** Appended to the revision when a cancellation is recorded, so "cancelled" and "running on
 *  this schedule" are different revisions. A PERSISTED value (inside `liveRevision`). */
export const CANCELLED_REVISION_SUFFIX = '|cancelled';

/** The `liveRevision` a recorded cancellation of this schedule writes. */
export function cancelRevisionOf(provider: ScheduleTuple): string {
  return revisionOf(provider) + CANCELLED_REVISION_SUFFIX;
}

/**
 * The provider statuses that FIRMLY say the flight is running. Only these clear a recorded
 * cancellation (the reinstatement write). `CanceledUncertain`, `Unknown` and `Diverted` are
 * display-only and leave the marker, so a Canceled → CanceledUncertain → Canceled flap is
 * recorded once, not three times.
 */
const FIRM_RUNNING_STATUSES: ReadonlySet<string> = new Set([
  'Expected',
  'EnRoute',
  'CheckIn',
  'Boarding',
  'GateClosed',
  'Departed',
  'Delayed',
  'Approaching',
  'Arrived',
]);

/**
 * Is a cancellation recorded on this segment (its `liveRevision` carries the cancel marker)?
 * THE answer to "is this flight cancelled" from the synced fields, everywhere (verification,
 * briefing, bell, OS notice). `liveCancelledAt` is only the timestamp for copy: it stays set
 * after a reinstatement, while the marker does not.
 */
export function isCancelRevision(rev?: string): boolean {
  return rev?.endsWith(CANCELLED_REVISION_SUFFIX) ?? false;
}

/**
 * Should this device write the matched leg into the segment? The idempotency predicate:
 *  - a firm cancellation (`Canceled`) when no cancellation is recorded (`isCancelRevision`):
 *    keyed on the cancel FACT, not the schedule, so a cancelled flight whose listing drifts
 *    (a terminal dropped, a time edited) is never recorded twice, and a family that re-marks
 *    the flight booked while the airline still says Canceled keeps it booked (a Conflict,
 *    never flipped back);
 *  - a reinstated flight whose stored revision is still a cancel marker: the plain revision
 *    is written, so a LATER cancellation of it is recorded again. Only a FIRM running status
 *    (`FIRM_RUNNING_STATUSES`) reinstates; any other status leaves the marker and writes
 *    nothing;
 *  - otherwise the segment differs from the provider AND the provider's revision is not the
 *    one already applied. A first check on a flight that already matches writes nothing; a
 *    second device that sees the same change sees `liveRevision` equal and writes nothing; a
 *    manual edit after an apply (revision equal) is a Conflict, never overwritten.
 */
export function shouldApply(
  seg: VacationTravelSegment,
  leg: FlightLeg,
  arrivalLeg?: FlightLeg | null
): boolean {
  const provider = tupleFromLeg(leg, arrivalLeg);
  if (leg.status === 'Canceled') return !isCancelRevision(seg.liveRevision);
  if (isCancelRevision(seg.liveRevision)) return FIRM_RUNNING_STATUSES.has(leg.status);
  return !tuplesEqual(tupleFromSegment(seg), provider) && revisionOf(provider) !== seg.liveRevision;
}

function appendNote(notes: string | undefined, line: string): string {
  const existing = notes?.trimEnd();
  return existing ? `${existing}\n${line}` : line;
}

/** `arrivesNextDay` (a legacy shadow) re-derived from the patched dates, only when it moves. */
function withArrivesNextDay(seg: VacationTravelSegment, patch: SegmentPatch): SegmentPatch {
  if (patch.departureDate === undefined && patch.arrivalDate === undefined) return patch;
  const next = arrivalDayOffset({ ...seg, ...patch }) >= 1;
  return next === !!seg.arrivesNextDay ? patch : { ...patch, arrivesNextDay: next };
}

/**
 * The patch that writes the matched leg into the segment. Only ever called after
 * `shouldApply` or from "Use the airline's" (`takeAirline`).
 *
 *  - Cancellation: `status: 'pending'`, `liveCancelledAt`, the cancel revision, a notes line.
 *  - Change (some field the segment held differs): every changed and filled field, the
 *    revision, `liveWas` (the prior values of those fields + `at`), `liveAppliedAt`, the notes
 *    line "Changed on 12 Dec: Was 17:00 from Terminal 2", `arrivesNextDay` re-derived.
 *  - Quiet fill (the airline only published values the segment never had, e.g. a terminal):
 *    those fields, the revision and a notes line; NO `liveWas` and NO `liveAppliedAt`, so no
 *    notice, no strike-out, the chip stays `verified`.
 *
 * A provider-undefined field is never written. The terminal is written as the provider spells
 * it. `sortDate` is `vacationStore.updateSegment`'s rule, never set here.
 */
export function planChange(
  seg: VacationTravelSegment,
  leg: FlightLeg,
  arrivalLeg: FlightLeg | null | undefined,
  nowMs: number,
  copy: PatchCopy
): SegmentPatch {
  const provider = tupleFromLeg(leg, arrivalLeg);
  const revision = revisionOf(provider);
  const at = new Date(nowMs).toISOString();
  const today = localYmd(nowMs);
  const airline = airlineName(copy.t, leg.airline?.name ?? seg.airline);

  if (leg.status === 'Canceled') {
    return {
      status: 'pending',
      liveCancelledAt: at,
      liveRevision: cancelRevisionOf(provider),
      notes: appendNote(seg.notes, cancelNoteLine(copy.t, airline, today, copy.lang)),
    };
  }

  const mine = tupleFromSegment(seg);
  const { changed, filled } = diffTuple(mine, provider);
  const values: SegmentPatch = {};
  for (const f of [...changed, ...filled]) values[f] = provider[f];

  if (changed.length > 0) {
    const liveWas: NonNullable<VacationTravelSegment['liveWas']> = { at };
    for (const f of changed) liveWas[f] = mine[f];
    return withArrivesNextDay(seg, {
      ...values,
      liveRevision: revision,
      liveWas,
      liveAppliedAt: at,
      notes: appendNote(seg.notes, changeNoteLine(copy.t, liveWas, today, copy.lang)),
    });
  }

  if (filled.length > 0) {
    return withArrivesNextDay(seg, {
      ...values,
      liveRevision: revision,
      notes: appendNote(
        seg.notes,
        fillNoteLine(copy.t, filled, provider, airline, today, copy.lang)
      ),
    });
  }

  // Already equal: at most the revision is recorded (never reached through `shouldApply`).
  return seg.liveRevision === revision ? {} : { liveRevision: revision };
}

/**
 * "Use the airline's" over a Conflict whose airline change is ALREADY recorded (the revision
 * matches, so `shouldApply` is false): write the airline's schedule fields back, and
 * `arrivesNextDay` when the dates move, and nothing else. No notes line and no `live*` key:
 * the original apply wrote both, and rewriting them made "Put it back" → "Use the airline's"
 * → repeat append one identical notes line per cycle and restamp `liveAppliedAt` (which drives
 * the change notices). The live keys staying as they were is what returns the card to Changed.
 *
 * A re-booked flight the airline still lists as `Canceled` (the other Conflict) takes the
 * airline's word as the status flip alone; its cancellation was recorded once already.
 * A provider-undefined field is never written (the `diffTuple` rule).
 */
export function takeProviderPatch(
  seg: VacationTravelSegment,
  leg: FlightLeg,
  arrivalLeg?: FlightLeg | null
): SegmentPatch {
  if (leg.status === 'Canceled') return seg.status === 'pending' ? {} : { status: 'pending' };
  const provider = tupleFromLeg(leg, arrivalLeg);
  const { changed, filled } = diffTuple(tupleFromSegment(seg), provider);
  const patch: SegmentPatch = {};
  for (const f of [...changed, ...filled]) patch[f] = provider[f];
  return withArrivesNextDay(seg, patch);
}

/**
 * "Put it back": restore the `liveWas` values, and nothing else (the live keys stay, so the
 * segment now differs from the provider while the revision matches: the Conflict rule shows
 * it, with no second mechanism). `arrivesNextDay` follows the restored dates. A segment with
 * no `liveWas` gets an empty patch.
 */
export function revertPlan(seg: VacationTravelSegment): SegmentPatch {
  const was = seg.liveWas;
  if (!was) return {};
  const patch: SegmentPatch = {};
  for (const f of TUPLE_FIELDS) if (was[f] !== undefined) patch[f] = was[f];
  return withArrivesNextDay(seg, patch);
}

function wallMinutes(local: string | undefined): number | null {
  const s = splitLocal(local);
  if (!s) return null;
  const [y, m, d] = s.date.split('-').map(Number);
  const [h, mi] = s.time.split(':').map(Number);
  return Date.UTC(y!, m! - 1, d!, h!, mi!) / 60_000;
}

/**
 * Minutes the departure estimate runs past the schedule (negative = early), from the same
 * airport's two local times; null without an estimate. Display-only (the delay notice).
 */
export function delayMinutes(leg: FlightLeg): number | null {
  const scheduled = wallMinutes(leg.departure.scheduledLocal);
  const revised = wallMinutes(leg.departure.revisedLocal);
  return scheduled === null || revised === null ? null : revised - scheduled;
}
