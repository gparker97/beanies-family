// Pure formatter: a beanies activity → the Google event description body.
//
// Google events have only date/time/title/description, so beanies' richer fields
// (who's going, pickup/drop-off, instructor, fees, notes) are packed into a clean,
// human-readable description block (#32 Requirement 3), followed by a "Synced from
// beanies.family" marker + a deep link back into the app (Requirement 4).
//
// SECURITY GUARD (#32 Pass 4): the description carries ONLY user-authored activity
// fields + the marker + the deep link. NOTHING system-generated (tokens, internal
// ids beyond the deep link, flags) is ever emitted. `notes`/`instructorContact`
// are user-authored free-text and acceptable — the user owns the target calendar.

import type { FamilyActivity } from '@/types/models';
import { normalizeAssignees } from '@/utils/assignees';
import { entityDeepLink } from '@/utils/entityDeepLink';

export interface EventDescriptionContext {
  /** Resolve a member id → display name (returns undefined for unknown ids). */
  memberName: (memberId: string) => string | undefined;
  /** App origin for the deep link, e.g. `https://app.beanies.family` (caller supplies `location.origin`). */
  appOrigin: string;
}

const MARKER = 'Synced from beanies.family';

/** Build an absolute in-app URL for "open this activity in beanies". */
function activityAppUrl(activityId: string, appOrigin: string): string {
  const { path, query } = entityDeepLink('activity', activityId);
  const qs = new URLSearchParams(query).toString();
  const origin = appOrigin.replace(/\/$/, '');
  return qs ? `${origin}${path}?${qs}` : `${origin}${path}`;
}

/** Resolve a list of member ids to a comma-joined name string (skips unknowns). */
function names(ids: string[], resolve: (id: string) => string | undefined): string {
  return ids
    .map(resolve)
    .filter((n): n is string => !!n && n.trim().length > 0)
    .join(', ');
}

/**
 * Format the description body. Pure. Lines are only added for fields that are
 * present, so a sparse activity yields a short description (just the marker + link).
 */
export function buildEventDescription(
  activity: FamilyActivity,
  ctx: EventDescriptionContext
): string {
  const { memberName, appOrigin } = ctx;
  const lines: string[] = [];

  const attending = names(normalizeAssignees(activity), memberName);
  if (attending) lines.push(`Who's going: ${attending}`);

  if (activity.dropoffMemberId) {
    const n = memberName(activity.dropoffMemberId);
    if (n) lines.push(`Drop-off: ${n}`);
  }
  if (activity.pickupMemberId) {
    const n = memberName(activity.pickupMemberId);
    if (n) lines.push(`Pick-up: ${n}`);
  }

  if (activity.instructorName) {
    const contact = activity.instructorContact ? ` (${activity.instructorContact})` : '';
    lines.push(`Instructor: ${activity.instructorName}${contact}`);
  }

  if (typeof activity.feeAmount === 'number' && activity.feeAmount > 0) {
    const currency = activity.feeCurrency ? ` ${activity.feeCurrency}` : '';
    const schedule =
      activity.feeSchedule && activity.feeSchedule !== 'none' ? ` (${activity.feeSchedule})` : '';
    lines.push(`Cost: ${activity.feeAmount}${currency}${schedule}`);
  }

  if (activity.notes && activity.notes.trim()) {
    if (lines.length > 0) lines.push('');
    lines.push(activity.notes.trim());
  }

  // Marker + deep link, always last, separated by a blank line.
  if (lines.length > 0) lines.push('');
  lines.push(MARKER);
  lines.push(activityAppUrl(activity.id, appOrigin));

  return lines.join('\n');
}

export const SYNCED_MARKER = MARKER;
