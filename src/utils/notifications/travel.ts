/**
 * Live flight checks (#143): the bell's travel entries, derived from departure occurrences.
 *
 *   travel-departure  one per timed departure, at departure minus the device's travel lead
 *                     (the same moment, and the same id, as the OS reminder);
 *   travel-change     the airline moved a flight: `travel-change:<segmentId>:<liveRevision>`;
 *   travel-change     (cancellation) `travel-cancel:<segmentId>:<liveRevision>@<liveCancelledAt>`
 *                     (`occurrenceNotice`'s cancel identity), same kind.
 *
 * Exactly one change entry per revision: every id is keyed on the revision, never on
 * `liveAppliedAt`, so two devices that applied the same change a few seconds apart still agree.
 * A change replaces nothing in the bell: the departure entry is a reminder, the change a fact.
 *
 * Pure and total (a malformed occurrence is skipped). `deriveNotifications` calls it once.
 */
import type {
  FamilyMember,
  LanguageCode,
  SegmentLiveState,
  SupportedTravelType,
} from '@/types/models';
import type { AppNotification } from '@/types/notifications';
import type { TranslateFn } from '@/utils/format';
import type { TravelSegmentOccurrence } from '@/utils/vacation';
import { isFlightType } from '@/utils/travelCodes';
import { classifyAudience } from '@/utils/audience';
import { formatNameList } from '@/utils/assignees';
import { resolveSegmentTravellers } from '@/utils/segmentTravellers';
import { DEFAULT_TRAVEL_LEADS, localDateTime, minusMinutes } from '@/utils/reminderSchedule';
import { isChangeRecipient } from '@/utils/flightStatus/audience';
import {
  flightLabel,
  noticeRevision,
  occurrenceNotice,
} from '@/utils/flightStatus/occurrenceNotice';

// OS travel-departure reminder AND the bell's departure entry share this id (one per segment
// departure occurrence; the date keeps it stable across reschedules).
export const travelReminderId = (segmentId: string, occurrenceDate: string): string =>
  `travel-reminder:${segmentId}:${occurrenceDate}`;
export const travelChangeId = (segmentId: string, revision: string): string =>
  `travel-change:${segmentId}:${revision}`;
export const travelCancelId = (segmentId: string, revision: string): string =>
  `travel-cancel:${segmentId}:${revision}`;

/** The bell/OS id of the notice a segment carries right now (`noticeRevision`), or null. The
 *  device-side dismissal is keyed on it, so it shares the "what counts as new" rule. */
export function liveNoticeId(segmentId: string, live: SegmentLiveState | undefined): string | null {
  const key = noticeRevision(live);
  if (!key) return null;
  return key.kind === 'cancelled'
    ? travelCancelId(segmentId, key.revision)
    : travelChangeId(segmentId, key.revision);
}

export interface TravelNotificationContext {
  viewer: FamilyMember;
  resolveMember: (id: string) => FamilyMember | undefined;
  t: TranslateFn;
  lang?: LanguageCode;
  /** Fully-resolved device lead per travel type (`settingsStore.travelReminderLeads`). */
  leads: Partial<Record<SupportedTravelType, number>>;
  /** The deriver's own gate: the trigger has passed and is inside the rolling window. */
  inWindow: (triggerMs: number) => boolean;
  isRead: (id: string) => boolean;
}

function departureEntry(
  o: TravelSegmentOccurrence,
  ctx: TravelNotificationContext
): AppNotification | null {
  if (!o.time) return null;
  const travellers = resolveSegmentTravellers(o.travellerIds, o.tripAssigneeIds);
  const audience = classifyAudience([...travellers], ctx.viewer, ctx.resolveMember);
  if (audience.kind === 'hidden') return null;
  const at = localDateTime(o.date, o.time);
  if (!at) return null;
  const lead = ctx.leads[o.transportType] ?? DEFAULT_TRAVEL_LEADS[o.transportType];
  const trigger = minusMinutes(at, lead);
  if (!ctx.inWindow(trigger.getTime())) return null;
  const id = travelReminderId(o.segmentId, o.date);
  const subtitle = [
    isFlightType(o.transportType) ? flightLabel(o) : '',
    audience.kind === 'forChild' ? formatNameList(audience.childNames) : '',
  ]
    .filter(Boolean)
    .join(' · ');
  return {
    id,
    kind: 'travel-departure',
    title: o.title,
    subtitle: subtitle || undefined,
    occurredAt: trigger.toISOString(),
    eventDate: o.date,
    eventTime: o.time,
    route: '/travel',
    query: { vacation: o.vacationId },
    sourceId: o.segmentId,
    occurrenceDate: o.date,
    read: ctx.isRead(id),
  };
}

function noticeEntry(
  o: TravelSegmentOccurrence,
  ctx: TravelNotificationContext
): AppNotification | null {
  const notice = occurrenceNotice(ctx.t, o, ctx.lang);
  if (!notice || !isChangeRecipient(ctx.viewer, o)) return null;
  if (!ctx.inWindow(notice.atMs)) return null;
  const id =
    notice.kind === 'cancelled'
      ? travelCancelId(o.segmentId, notice.revision)
      : travelChangeId(o.segmentId, notice.revision);
  const at = new Date(notice.atMs);
  return {
    id,
    kind: 'travel-change',
    title: notice.message,
    subtitle: notice.was || undefined,
    occurredAt: at.toISOString(),
    eventDate: o.date,
    eventTime: o.time,
    route: '/travel',
    query: { vacation: o.vacationId },
    sourceId: o.segmentId,
    occurrenceDate: o.date,
    read: ctx.isRead(id),
  };
}

/** Departure reminders and airline-change notices for `occurrences` (departure sides only). */
export function deriveTravelNotifications(
  occurrences: readonly TravelSegmentOccurrence[],
  ctx: TravelNotificationContext
): AppNotification[] {
  const out: AppNotification[] = [];
  for (const o of occurrences) {
    try {
      if (o.kind !== 'departure') continue;
      const dep = departureEntry(o, ctx);
      if (dep) out.push(dep);
      const change = noticeEntry(o, ctx);
      if (change) out.push(change);
    } catch (err) {
      console.warn(`[deriveTravelNotifications] skipped occurrence ${o?.segmentId ?? '?'}:`, err);
    }
  }
  return out;
}
