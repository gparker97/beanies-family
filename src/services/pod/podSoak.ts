/**
 * Has every family member's device seen a build that honours the lineage guard?
 *
 * PURE — members in, a verdict out. No stores, no I/O, no mocks needed to test
 * it, and SHARED by the pre-compaction gate and the completion message so the
 * two can never disagree about who is behind. A second implementation of "who
 * has not caught up" is how a gate and a message drift into contradicting each
 * other in front of a user.
 *
 * ⚠️ POSITIVE EVIDENCE ONLY. The tempting shape — "refuse while any device is
 * on an old build" — can NEVER match, because an old build writes no marker at
 * all. So the gate requires a marker from every recently-active member, and
 * absence refuses. It self-heals the moment that person opens a current build.
 *
 * ⚠️ RECENTLY ACTIVE, not "every member ever". `lastLoginAt` is DATE-ONLY, so
 * the window is compared at date granularity, and a member who has never logged
 * in has no value and is correctly not counted — a child's account created but
 * never opened must not block their family forever.
 */
import type { FamilyMember, ISODateString } from '@/types/models';

/** How recently a member must have signed in to count as active. */
export const SOAK_WINDOW_DAYS = 30;

/**
 * The lineage generation a device must have seen to be trusted with a
 * compaction. `1` is the guard's first release: any build that writes an epoch
 * at all honours the guard, so the value is about future generations rather
 * than this one.
 */
export const REQUIRED_EPOCH = 1;

export interface SoakVerdict {
  /** Every recently-active member is on a guard-honouring build. */
  ok: boolean;
  /** Those who are not, by name, for a message that can be acted on. */
  behind: string[];
}

/** Date-only comparison, because `lastLoginAt` is date-only. */
function withinWindow(lastLoginAt: ISODateString | undefined, today: Date, days: number): boolean {
  if (!lastLoginAt) return false;
  const then = Date.parse(`${lastLoginAt.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(then)) return false;
  const now = Date.parse(`${today.toISOString().slice(0, 10)}T00:00:00Z`);
  return now - then <= days * 86_400_000;
}

export function evaluateSoak(
  members: readonly FamilyMember[],
  opts: { today?: Date; requiredEpoch?: number; windowDays?: number } = {}
): SoakVerdict {
  const today = opts.today ?? new Date();
  const required = opts.requiredEpoch ?? REQUIRED_EPOCH;
  const windowDays = opts.windowDays ?? SOAK_WINDOW_DAYS;

  const behind = members
    .filter((m) => withinWindow(m.lastLoginAt, today, windowDays))
    .filter((m) => (m.lineageEpoch ?? 0) < required)
    .map((m) => m.name);

  return { ok: behind.length === 0, behind };
}

/**
 * Has any member's device reported that the pod is too large to open?
 *
 * A real failure outranks the size heuristic — the family whose tablet cannot
 * open the file is due regardless of what the byte threshold says.
 */
export function anyDeviceReportedTooLarge(members: readonly FamilyMember[]): boolean {
  return members.some((m) => !!m.podTooLargeSeenAt);
}
