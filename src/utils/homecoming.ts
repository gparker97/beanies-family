/**
 * The homecoming rule: which flight in a trip is each traveller's flight home, so the daily
 * briefing can tell the people at home when they land (`travelRows.ts`, the arrival row).
 *
 * Nothing in a trip says "this is the flight home", so it is inferred per traveller from the
 * trip's flights that have a departure date, in departure order (`departureSortKey`, airport
 * wall clock; ties keep array order). With first flight `F`, last `L` and `n` flights, `L` is
 * the traveller's flight home when any of:
 *   1. `n >= 2` and `L` lands at the airport `F` left from (codes compared case-insensitively,
 *      both non-empty; a name-only airport is compared as typed, so it rarely matches and the
 *      next two rules decide);
 *   2. `L` is typed `flight_return`;
 *   3. `L` is the only flight the traveller has in the trip.
 *      Its type is not consulted: a flight added by hand as one-way is always typed
 *      `flight_outbound` whichever way it goes, and nothing can change the type afterwards.
 * So an outbound one-way also gets a landing row; the row can be dismissed. A traveller with
 * any flight that has no departure date yet gets none: that flight could come after the
 * others, so the last one is unknown. A segment whose
 * `travellerIds` is an empty array belongs to nobody.
 *
 * Pure and total: missing fields read as empty (`airportCode` gives '' for undefined).
 */
import type { UUID, VacationTravelSegment } from '@/types/models';
import { airportCode, isFlightType } from '@/utils/travelCodes';
import { resolveSegmentTravellers } from '@/utils/segmentTravellers';
import { datePart, departureSortKey } from '@/utils/flightStatus/schedule';

/** Per segment id, the travellers for whom that flight is the one home. A segment that is
 *  nobody's flight home has no entry. */
export function homecomingTravellers(
  segments: readonly VacationTravelSegment[],
  tripAssigneeIds: UUID[]
): Map<string, UUID[]> {
  const allFlights = segments.filter((s) => isFlightType(s.type));
  /** Every flight a member is on, dated or not: an undated one makes the order unknown. */
  const flightCount = new Map<UUID, number>();
  for (const seg of allFlights) {
    for (const id of new Set(resolveSegmentTravellers(seg.travellerIds, tripAssigneeIds))) {
      flightCount.set(id, (flightCount.get(id) ?? 0) + 1);
    }
  }
  const flights = allFlights
    .filter((s) => !!datePart(s.departureDate))
    // `Array.prototype.sort` is stable, so equal keys keep their array order.
    .sort((a, b) => departureSortKey(a).localeCompare(departureSortKey(b)));

  const byMember = new Map<UUID, VacationTravelSegment[]>();
  for (const seg of flights) {
    for (const id of new Set(resolveSegmentTravellers(seg.travellerIds, tripAssigneeIds))) {
      const list = byMember.get(id);
      if (list) list.push(seg);
      else byMember.set(id, [seg]);
    }
  }

  const out = new Map<string, UUID[]>();
  for (const [member, list] of byMember) {
    // An undated flight could come after every dated one: the order is unknown, so nobody is
    // told this traveller is landing home.
    if (flightCount.get(member) !== list.length) continue;
    const first = list[0]!;
    const last = list[list.length - 1]!;
    const from = airportCode(first.departureAirport).toUpperCase();
    const to = airportCode(last.arrivalAirport).toUpperCase();
    const home =
      (list.length >= 2 && from !== '' && to === from) ||
      last.type === 'flight_return' ||
      list.length === 1;
    if (!home) continue;
    const ids = out.get(last.id);
    if (ids) ids.push(member);
    else out.set(last.id, [member]);
  }
  return out;
}
