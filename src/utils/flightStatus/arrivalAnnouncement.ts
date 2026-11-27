/**
 * Live flight checks (#143): a family flight home, as the people at home are told about it.
 *
 * ONE decision feeds three surfaces, so they cannot disagree about who hears about which
 * flight, or when it lands:
 *   - the daily briefing's arrival row (`arrivalRow` in `composables/criticalItems/travelRows.ts`);
 *   - the OS reminder `lead` minutes before landing (`buildArrivalReminders`,
 *     `composables/useScheduledReminders.ts`);
 *   - the bell entry at the same moment (`arrivalEntry`, `utils/notifications/travel.ts`).
 * The reminder and the bell read one reactive list (`composables/useArrivalAnnouncements.ts`).
 *
 * Who: everyone who is not on the flight and is not a pet, for a flight that is a traveller's
 * way home (`ctx.homecomingFor`, the rule in `utils/homecoming.ts`), not cancelled. When: the
 * airline's estimate while a live check carries one, else the plan (`resolveArrival`).
 *
 * Pure, and plain data only (nothing that moves on every check, such as `checkedAt`), so the
 * list keeps its identity between checks that bring no new estimate.
 */
import type { FamilyMember } from '@/types/models';
import type { FlightVerification } from '@/types/flightStatus';
import type { TravelSegmentOccurrence } from '@/utils/vacation';
import { airportCode, isFlightType } from '@/utils/travelCodes';
import { formatNameList } from '@/utils/assignees';
import { entityDeepLink, type DeepLink } from '@/utils/entityDeepLink';
import { resolveSegmentTravellers } from '@/utils/segmentTravellers';
import { localDateTime, minusMinutes } from '@/utils/reminderSchedule';
import { resolveArrival } from './schedule';
import { flightLabel, noticeRevision } from './occurrenceNotice';

/** What every surface says about one flight home. */
export interface ArrivalAnnouncement {
  segmentId: string;
  vacationId: string;
  /** "Jill and Sam": the people coming home (never the whole family). */
  names: string;
  /** How many people `names` names (picks the verb's number). */
  count: number;
  /** When it lands, airport wall clock: `YYYY-MM-DD` and `HH:mm`. */
  date: string;
  time: string;
  /** The plan's time, set only when the estimate is used and differs from it. */
  scheduledTime?: string;
  /** The airline's estimate supplied the time ("lands at"), else the plan did ("is scheduled
   *  to land at"). */
  estimated: boolean;
  /** The check window has closed (it reads Arrived, or 2 hours have passed since scheduled
   *  arrival): no reminder is armed and the bell entry leaves. The briefing row stays. */
  over: boolean;
  /** "SQ318" (`flightLabel`). */
  flight: string;
  /** The arrival airport's code (`airportCode`), raw. */
  airport: string;
  /** The arrival terminal, raw (the airline's while a live check carries one). */
  terminal?: string;
}

export interface ArrivalContext {
  viewer: FamilyMember;
  members: readonly FamilyMember[];
  resolveMember: (id: string) => FamilyMember | undefined;
  /** The travellers for whom this flight is the one home (`vacationStore.homecomingFor`). */
  homecomingFor: (segmentId: string) => readonly string[];
  /** The flight-status store's per-segment view model (undefined for an unknown segment). */
  verificationFor: (segmentId: string) => FlightVerification | undefined;
}

/** "Jill and Sam" for the people on the flight, or null when it is the whole family. */
export function travellerNames(
  ids: readonly string[],
  ctx: Pick<ArrivalContext, 'members' | 'resolveMember'>
): { names: string | null; count: number } {
  const people = ids
    .map((id) => ctx.resolveMember(id))
    .filter((m): m is FamilyMember => !!m && !m.isPet);
  const everyone = ctx.members.filter((m) => !m.isPet);
  if (people.length === 0 || everyone.every((m) => people.some((p) => p.id === m.id))) {
    return { names: null, count: everyone.length };
  }
  return { names: formatNameList(people.map((m) => m.name)), count: people.length };
}

/**
 * The announcement of `o` (a departure occurrence) to `ctx.viewer`, or null: not a flight, a
 * pet viewer, a viewer on the flight, nobody coming home on it, a cancelled flight (on the
 * plan, or known on this device only), or no resolvable arrival.
 */
export function arrivalAnnouncement(
  o: TravelSegmentOccurrence,
  ctx: ArrivalContext
): ArrivalAnnouncement | null {
  if (!isFlightType(o.transportType)) return null;
  if (ctx.viewer.isPet) return null;
  if (resolveSegmentTravellers(o.travellerIds, o.tripAssigneeIds).includes(ctx.viewer.id)) {
    return null;
  }
  const who = travellerNames(ctx.homecomingFor(o.segmentId), ctx);
  if (who.names === null) return null;
  const v = ctx.verificationFor(o.segmentId);
  if (noticeRevision(o.live)?.kind === 'cancelled' || v?.state === 'cancelled') return null;
  const arrival = resolveArrival(o.schedule, v?.live?.estimatedArrival);
  if (!arrival) return null;
  // Like the time: the airline's terminal wins while a live check carries one (a change this
  // device has seen may not be written to the plan yet, e.g. on a view-only device).
  const terminal =
    (v?.live ? v.provider?.arrivalTerminal : undefined) ?? o.schedule?.arrivalTerminal;
  return {
    segmentId: o.segmentId,
    vacationId: o.vacationId,
    names: who.names,
    count: who.count,
    date: arrival.date,
    time: arrival.time,
    ...(arrival.scheduledTime !== undefined ? { scheduledTime: arrival.scheduledTime } : {}),
    estimated: arrival.estimated,
    over: v?.reason === 'past',
    flight: flightLabel(o),
    airport: airportCode(o.arrivalAirport),
    ...(terminal !== undefined ? { terminal } : {}),
  };
}

/**
 * When the reminder fires and the bell entry appears: `lead` minutes before landing, the
 * landing wall clock read in the DEVICE zone (as a departure reminder is). Null for a date or
 * time `localDateTime` cannot read; both callers then skip it.
 */
export function arrivalFireAt(
  a: Pick<ArrivalAnnouncement, 'date' | 'time'>,
  lead: number
): Date | null {
  const at = localDateTime(a.date, a.time);
  return at ? minusMinutes(at, lead) : null;
}

/** The trip in Travel Plans, opened on this flight's card (the row, the reminder and the bell). */
export function arrivalLink(a: Pick<ArrivalAnnouncement, 'vacationId' | 'segmentId'>): DeepLink {
  return entityDeepLink('vacation', a.vacationId, { segment: a.segmentId });
}

/**
 * The announcements in `occurrences` (any range; departure occurrences only). Total: each
 * occurrence is mapped on its own, and one that throws is skipped (and told to `onSkipped`, so
 * the caller reports it), never dropping the others.
 */
export function arrivalAnnouncements(
  occurrences: readonly TravelSegmentOccurrence[],
  ctx: ArrivalContext,
  onSkipped?: (o: TravelSegmentOccurrence, err: unknown) => void
): ArrivalAnnouncement[] {
  const out: ArrivalAnnouncement[] = [];
  for (const o of occurrences) {
    try {
      if (o?.kind !== 'departure') continue;
      const a = arrivalAnnouncement(o, ctx);
      if (a) out.push(a);
    } catch (err) {
      console.warn(
        `[arrivalAnnouncements] skipped the arrival of occurrence ${o?.segmentId ?? '?'}:`,
        err
      );
      onSkipped?.(o, err);
    }
  }
  return out;
}
