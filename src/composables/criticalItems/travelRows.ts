/**
 * Live flight checks (#143): today's departures and homecoming arrivals as daily-briefing rows.
 *
 * Each departure occurrence gives up to two rows, each built on its own (`departureRow`,
 * `arrivalRow`), so a throw in one never drops the other:
 *   - on its departure day, a plain row ("Everyone flies at 17:00 today") for a timed
 *     departure, audience by `classifyAudience` on the segment's resolved travellers, like an
 *     activity; when the airline changed or cancelled the flight, THE CHANGE ROW REPLACES the
 *     plain row (never both), and it goes to `isChangeRecipient`s: every adult, plus a
 *     travelling child. The two rows differ by icon and caption only, because the toast paints
 *     every row on the same accent surface;
 *   - on its arrival day, for a flight home (`ctx.homecomingFor`, the rule in
 *     `utils/homecoming.ts`), an arrival row ("Jill lands at 12:40am") to everyone who is not
 *     on the flight and is not a pet; an arrival before `EARLY_ARRIVAL_BEFORE` also shows the
 *     day before ("Jill lands tonight at 12:40am"). Built from the DEPARTURE occurrence, which
 *     carries the schedule, whatever day it departed (`travelRowsRange` fetches far enough
 *     back). Who and when is `arrivalAnnouncement`'s decision, shared with the arrival reminder
 *     and bell entry; the device's "Family Flight Arrivals" switch (`ctx.arrivals`) gates all
 *     three.
 * Every row opens the trip on that flight (`flightRoute`).
 *
 * Pure (the `buildCardBriefingRows` precedent): `useCriticalItems` calls it once and stamps the
 * hide key on the result like any other row. A skipped row is reported through `ctx.onSkipped`.
 */
import type { FamilyMember, LanguageCode } from '@/types/models';
import type { FlightVerification } from '@/types/flightStatus';
import type { TranslateFn } from '@/utils/format';
import type { TravelSegmentOccurrence } from '@/utils/vacation';
import { transportEmoji } from '@/utils/vacation';
import { airportCode, isFlightType } from '@/utils/travelCodes';
import { classifyAudience } from '@/utils/audience';
import { formatNameList } from '@/utils/assignees';
import { fillTemplate } from '@/utils/fillTemplate';
import { resolveSegmentTravellers } from '@/utils/segmentTravellers';
import { addDaysYmd } from '@/utils/flightStatus/schedule';
import {
  arrivalPlace,
  arrivalRowMessage,
  checkedAgo,
  clockTime,
  departureRowMessage,
  placeTerminal,
  terminalLabel,
  terminalRoute,
} from '@/utils/flightStatus/copy';
import { isChangeRecipient } from '@/utils/flightStatus/audience';
import {
  CHANGE_NEWS_MS,
  flightLabel,
  occurrenceNotice,
  type OccurrenceNotice,
} from '@/utils/flightStatus/occurrenceNotice';
import {
  arrivalAnnouncement,
  arrivalLink,
  travellerNames,
} from '@/utils/flightStatus/arrivalAnnouncement';
import { travelArrivalId } from '@/utils/notifications/travel';
import type { CriticalItem } from '@/composables/useCriticalItems';

/** How many days before today a departure is fetched: a flight across the date line can land
 *  two calendar days after it leaves. */
export const ARRIVAL_LOOKBACK_DAYS = 2;
/** An arrival before this (airport wall clock) also shows the evening before, as "tonight". */
const EARLY_ARRIVAL_BEFORE = '06:00';
/** A "tonight" row's sort time (`CriticalItem.time` is sort and key only, never shown). */
const TONIGHT_SORT_TIME = '23:59';

/**
 * The occurrence range the builder needs for `today`: departures from `ARRIVAL_LOOKBACK_DAYS`
 * back (landing today) to tomorrow (landing early tomorrow, a "tonight" row). Just today when
 * `today` is not a `YYYY-MM-DD`, so an undefined bound never reaches the store's filter.
 */
export function travelRowsRange(today: string): { from: string; to: string } {
  const from = addDaysYmd(today, -ARRIVAL_LOOKBACK_DAYS);
  const to = addDaysYmd(today, 1);
  return from !== undefined && to !== undefined ? { from, to } : { from: today, to: today };
}

/** Which of a flight's two rows: named in a skip report (function names are minified). */
export type TravelRowKind = 'departure' | 'arrival';

export interface TravelRowsContext {
  /** Local calendar day, `YYYY-MM-DD`. */
  today: string;
  nowMs: number;
  viewer: FamilyMember;
  members: readonly FamilyMember[];
  resolveMember: (id: string) => FamilyMember | undefined;
  t: TranslateFn;
  lang?: LanguageCode;
  /** The flight-status store's per-segment view model (undefined for an unknown segment). */
  verificationFor: (segmentId: string) => FlightVerification | undefined;
  /** The travellers for whom this flight is the one home (`vacationStore.homecomingFor`). */
  homecomingFor: (segmentId: string) => readonly string[];
  /** This device's "Family Flight Arrivals" switch (`settingsStore.familyArrivalAlerts`):
   *  off, no arrival row. */
  arrivals: boolean;
  /** Told about each row the builder had to skip (it threw). The caller reports it. */
  onSkipped?: (o: TravelSegmentOccurrence, err: unknown, row: TravelRowKind) => void;
}

/** The trip in Travel Plans, opened on this flight's card (`arrivalLink`, so the arrival
 *  reminder and bell entry open the same place). */
function flightRoute(o: TravelSegmentOccurrence): CriticalItem['route'] {
  return arrivalLink(o);
}

/**
 * The caption's live part: "Checked 12 min ago" plus the caller's already formatted `detail`
 * (the gate for a departure, the belt for an arrival), or "Not checked live".
 */
function liveCaptionParts(
  v: FlightVerification | undefined,
  ctx: TravelRowsContext,
  detail?: string
): string[] {
  if (v && v.state !== 'not-live' && v.state !== 'unavailable' && v.checkedAt !== undefined) {
    const checked = checkedAgo(ctx.t, v.checkedAt, ctx.nowMs);
    return detail ? [checked, detail] : [checked];
  }
  return [ctx.t('flightChecks.chip.notLive')];
}

/**
 * The caption: "SQ318 · SIN Terminal 3 → LHR Terminal 2 · Checked 12 min ago · Gate B12", or
 * "... · Not checked live". A flight's terminals are each tied to their airport (a terminal
 * with no airport entered is omitted, never shown bare); any other kind keeps its one terminal.
 */
function plainCaption(o: TravelSegmentOccurrence, ctx: TravelRowsContext): string {
  const parts: string[] = [];
  const isFlight = isFlightType(o.transportType);
  if (isFlight) parts.push(flightLabel(o));
  const terminal = isFlight
    ? terminalRoute([
        placeTerminal(ctx.t, airportCode(o.departureAirport), o.schedule?.terminal),
        placeTerminal(ctx.t, airportCode(o.arrivalAirport), o.schedule?.arrivalTerminal),
      ])
    : terminalLabel(ctx.t, o.schedule?.terminal);
  if (terminal) parts.push(terminal);
  const v = isFlight ? ctx.verificationFor(o.segmentId) : undefined;
  const gate = v?.live?.gate
    ? fillTemplate(ctx.t('nook.criticalTravelGate'), { gate: v.live.gate })
    : undefined;
  parts.push(...liveCaptionParts(v, ctx, gate));
  return parts.join(' · ');
}

function noticeRow(
  o: TravelSegmentOccurrence,
  notice: OccurrenceNotice,
  ctx: TravelRowsContext
): CriticalItem {
  const parts = [notice.kind === 'cancelled' ? ctx.t('flightChecks.chip.cancelled') : notice.was];
  return {
    id: `travel-${notice.kind}:${o.segmentId}:${notice.revision}`,
    type: 'travel',
    message: notice.message,
    caption: [notice.flight, ...parts].filter(Boolean).join(' · '),
    icon: notice.kind === 'cancelled' ? '🚫' : '🔄',
    time: o.time ?? '',
    completable: false,
    route: flightRoute(o),
  };
}

function plainRow(o: TravelSegmentOccurrence, ctx: TravelRowsContext): CriticalItem | null {
  if (!o.time) return null;
  const travellers = resolveSegmentTravellers(o.travellerIds, o.tripAssigneeIds);
  const audience = classifyAudience([...travellers], ctx.viewer, ctx.resolveMember);
  if (audience.kind === 'hidden') return null;
  const who =
    audience.kind === 'forChild'
      ? { names: formatNameList(audience.childNames), count: audience.childNames.length }
      : audience.kind === 'assignee'
        ? travellerNames(travellers, ctx)
        : { names: null, count: 0 };
  return {
    id: `travel-departure:${o.segmentId}`,
    type: 'travel',
    message: departureRowMessage(ctx.t, {
      names: who.names,
      count: who.count,
      time: o.time,
      isFlight: isFlightType(o.transportType),
    }),
    caption: plainCaption(o, ctx),
    icon: transportEmoji(o.transportType, 'departure'),
    time: o.time,
    completable: false,
    route: flightRoute(o),
  };
}

/** The departure day's row: the airline's change or cancellation, else the plain row. */
function departureRow(o: TravelSegmentOccurrence, ctx: TravelRowsContext): CriticalItem | null {
  if (o.date !== ctx.today) return null;
  const notice = occurrenceNotice(ctx.t, o, ctx.lang);
  const news =
    notice !== null && (notice.kind === 'cancelled' || ctx.nowMs - notice.atMs <= CHANGE_NEWS_MS);
  return news && isChangeRecipient(ctx.viewer, o)
    ? noticeRow(o, notice, ctx)
    : news
      ? null // a child who is not on this flight hears nothing about it
      : plainRow(o, ctx);
}

/**
 * The arrival row of a flight home, to the people at home: "Jill lands at 12:40am" on the
 * arrival day, "Jill lands tonight at 12:40am" the day before an arrival before
 * `EARLY_ARRIVAL_BEFORE`. Who and when: `arrivalAnnouncement` (the airline's estimate wins over
 * the plan while a live check carries one; none for anyone on the flight, a pet, a flight that
 * is nobody's way home, or a cancelled flight). None at all with the device's switch off.
 * Caption: "SQ318 · SIN Terminal 1 · Checked 12 min ago · Belt 7 · Scheduled 12:40am".
 */
function arrivalRow(o: TravelSegmentOccurrence, ctx: TravelRowsContext): CriticalItem | null {
  if (!ctx.arrivals) return null;
  const arrival = arrivalAnnouncement(o, ctx);
  if (!arrival) return null;
  const v = ctx.verificationFor(o.segmentId);
  const tomorrow = addDaysYmd(ctx.today, 1);
  const when =
    arrival.date === ctx.today
      ? 'today'
      : tomorrow !== undefined && arrival.date === tomorrow && arrival.time < EARLY_ARRIVAL_BEFORE
        ? 'tonight'
        : null;
  if (when === null) return null;
  const belt = v?.live?.belt
    ? fillTemplate(ctx.t('nook.criticalTravelBelt'), { belt: v.live.belt })
    : undefined;
  const parts = [
    arrival.flight,
    // The airport always shows, with its terminal when one is known.
    arrivalPlace(ctx.t, arrival),
    ...liveCaptionParts(v, ctx, belt),
    arrival.scheduledTime !== undefined
      ? fillTemplate(ctx.t('flightChecks.row.scheduled'), {
          time: clockTime(arrival.scheduledTime),
        })
      : '',
  ];
  return {
    id: travelArrivalId(o.segmentId),
    type: 'travel',
    message: arrivalRowMessage(ctx.t, {
      names: arrival.names,
      count: arrival.count,
      time: arrival.time,
      wording: when,
    }),
    caption: parts.filter(Boolean).join(' · '),
    icon: transportEmoji(o.transportType, 'arrival'),
    time: when === 'today' ? arrival.time : TONIGHT_SORT_TIME,
    completable: false,
    route: flightRoute(o),
  };
}

const ROW_BUILDERS = [
  { row: 'departure', build: departureRow },
  { row: 'arrival', build: arrivalRow },
] as const satisfies readonly { row: TravelRowKind; build: typeof departureRow }[];

/**
 * The rows for `occurrences` (any range; departure occurrences only: the departure row on its
 * own day, the arrival row on the arrival day, see `travelRowsRange`).
 * Total: each row is built on its own, and one that throws is skipped (and told to
 * `ctx.onSkipped`), never dropping the flight's other row or aborting the briefing.
 */
export function buildTravelBriefingRows(
  occurrences: readonly TravelSegmentOccurrence[],
  ctx: TravelRowsContext
): CriticalItem[] {
  const out: CriticalItem[] = [];
  for (const o of occurrences) {
    if (o?.kind !== 'departure') continue;
    for (const { row, build } of ROW_BUILDERS) {
      try {
        const item = build(o, ctx);
        if (item) out.push(item);
      } catch (err) {
        console.warn(
          `[travelBriefingRows] skipped the ${row} row for occurrence ${o?.segmentId ?? '?'}:`,
          err
        );
        ctx.onSkipped?.(o, err, row);
      }
    }
  }
  return out;
}
