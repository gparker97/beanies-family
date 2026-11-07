/**
 * Live flight checks (#143): today's departures as daily-briefing rows.
 *
 * One row per departure per day, for the people it concerns:
 *   - a plain row ("Everyone flies at 17:00 today") for a timed departure, audience by
 *     `classifyAudience` on the segment's resolved travellers, like an activity;
 *   - when the airline changed or cancelled the flight, THE CHANGE ROW REPLACES the plain row
 *     (never both), and it goes to `isChangeRecipient`s: every adult, plus a travelling child.
 *     The two rows differ by icon and caption only, because the toast paints every row on the
 *     same accent surface.
 *
 * Pure (the `buildCardBriefingRows` precedent): `useCriticalItems` calls it once and stamps the
 * hide key on the result like any other row.
 */
import type { FamilyMember, LanguageCode } from '@/types/models';
import type { FlightVerification } from '@/types/flightStatus';
import type { TranslateFn } from '@/utils/format';
import type { TravelSegmentOccurrence } from '@/utils/vacation';
import { transportEmoji } from '@/utils/vacation';
import { isFlightType } from '@/utils/travelCodes';
import { classifyAudience } from '@/utils/audience';
import { formatNameList } from '@/utils/assignees';
import { fillTemplate } from '@/utils/fillTemplate';
import { resolveSegmentTravellers } from '@/utils/segmentTravellers';
import { checkedAgo, departureRowMessage, terminalLabel } from '@/utils/flightStatus/copy';
import { isChangeRecipient } from '@/utils/flightStatus/audience';
import {
  CHANGE_NEWS_MS,
  flightLabel,
  occurrenceNotice,
  type OccurrenceNotice,
} from '@/utils/flightStatus/occurrenceNotice';
import type { CriticalItem } from '@/composables/useCriticalItems';

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
}

/** "Jill and Sam" for the people on the flight, or null when it is the whole family. */
function travellerNames(
  ids: readonly string[],
  ctx: TravelRowsContext
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

/** The caption: "SQ318 · Terminal 3 · Checked 12 min ago · Gate B12", or "... · Not checked live". */
function plainCaption(o: TravelSegmentOccurrence, ctx: TravelRowsContext): string {
  const parts: string[] = [];
  const isFlight = isFlightType(o.transportType);
  if (isFlight) parts.push(flightLabel(o));
  const terminal = terminalLabel(ctx.t, o.schedule?.terminal);
  if (terminal) parts.push(terminal);
  const v = isFlight ? ctx.verificationFor(o.segmentId) : undefined;
  if (v && v.state !== 'not-live' && v.state !== 'unavailable' && v.checkedAt !== undefined) {
    parts.push(checkedAgo(ctx.t, v.checkedAt, ctx.nowMs));
    if (v.live?.gate)
      parts.push(fillTemplate(ctx.t('nook.criticalTravelGate'), { gate: v.live.gate }));
  } else {
    parts.push(ctx.t('flightChecks.chip.notLive'));
  }
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
    route: { path: '/travel', query: { vacation: o.vacationId } },
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
    route: { path: '/travel', query: { vacation: o.vacationId } },
  };
}

/**
 * The rows for `occurrences` (any range; only today's departures are used).
 * Total: one malformed occurrence is skipped, never aborts the briefing.
 */
export function buildTravelBriefingRows(
  occurrences: readonly TravelSegmentOccurrence[],
  ctx: TravelRowsContext
): CriticalItem[] {
  const out: CriticalItem[] = [];
  for (const o of occurrences) {
    try {
      if (o.kind !== 'departure' || o.date !== ctx.today) continue;
      const notice = occurrenceNotice(ctx.t, o, ctx.lang);
      const news =
        notice !== null &&
        (notice.kind === 'cancelled' || ctx.nowMs - notice.atMs <= CHANGE_NEWS_MS);
      const row =
        news && isChangeRecipient(ctx.viewer, o)
          ? noticeRow(o, notice, ctx)
          : news
            ? null // a child who is not on this flight hears nothing about it
            : plainRow(o, ctx);
      if (row) out.push(row);
    } catch (err) {
      console.warn(`[travelBriefingRows] skipped occurrence ${o?.segmentId ?? '?'}:`, err);
    }
  }
  return out;
}
