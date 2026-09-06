/**
 * Who in the family last opened beanies on a build that predates the lineage
 * guard? A READING for the compaction notice, the confirm and the completion
 * toast. NOTHING REFUSES ON IT.
 *
 * It used to be a gate: compaction refused until every recently active member
 * had logged in on a guard-honouring build. That gate could not verify what it
 * asked. `lineageEpoch` is written on the MEMBER row at login, so once Sam
 * signs in once on a current build, Sam passes forever, and Sam's old tablet
 * is still a hazard the reading cannot see. Its instruction, "open beanies on
 * every device you use it on", was unverifiable and, for a normal family,
 * impossible. The structural protection is the file format now: a compacted
 * pod is a 5.0 file, which a pre-guard build refuses at parse (ADR-036
 * addendum). What this reading can still do honestly is name the PEOPLE whose
 * last login was on an older version, so the owner is told who will be cut off
 * until they update, before and after compacting.
 *
 * PURE, members in, names out, and SHARED by all three consumers so they
 * cannot disagree about who is behind.
 *
 * ⚠️ POSITIVE EVIDENCE ONLY. "Anyone on an old build" can never match, because
 * an old build writes no marker at all; so a member is named when they are
 * recently active and no guard-honouring build has stamped their row. It
 * self-clears the moment that person opens a current build.
 *
 * ⚠️ RECENTLY ACTIVE, not "every member ever". The window is compared at DATE
 * granularity. A member who has never signed in has no value and is not
 * counted: a child's account created but never opened must not be named.
 *
 * ⚠️ NAMES, NEVER A VERSION. `appVersion` is written by the same login stamp as
 * `lineageEpoch`, so it is ABSENT on exactly the members this can name.
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

/** Date-only comparison, because `lastLoginAt` is date-only. */
function withinWindow(lastLoginAt: ISODateString | undefined, today: Date, days: number): boolean {
  if (!lastLoginAt) return false;
  const then = Date.parse(`${lastLoginAt.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(then)) return false;
  const now = Date.parse(`${today.toISOString().slice(0, 10)}T00:00:00Z`);
  // ⚠️ BOUNDED ON BOTH SIDES. A device with a badly-skewed clock writes a
  // FUTURE date, and a one-sided test reads that as "recently active" for as
  // long as the skew lasts — so a retired tablet dated 2030 would block its
  // family for years, with the refusal naming someone whose device no longer
  // exists. A future date is not evidence of anything.
  const age = now - then;
  return age >= 0 && age <= days * 86_400_000;
}

/**
 * The people being waited on, as one readable string.
 *
 * ⚠️ ONE IMPLEMENTATION. The refusal toast and the standing Settings notice
 * render the same list, and a family seeing two spellings of one fact is how
 * they conclude the app is guessing. Comma-joined rather than "A and B",
 * because the conjunction is English and this renders inside translated copy.
 */
export function formatNames(names: readonly string[]): string {
  return names.join(', ');
}

/** The names of recently active members whose last login predates the guard. */
export function membersOnOlderVersions(
  members: readonly FamilyMember[],
  opts: { today?: Date; requiredEpoch?: number; windowDays?: number } = {}
): string[] {
  const today = opts.today ?? new Date();
  const required = opts.requiredEpoch ?? REQUIRED_EPOCH;
  const windowDays = opts.windowDays ?? SOAK_WINDOW_DAYS;

  const behind = members
    .filter((m) => withinWindow(m.lastLoginAt, today, windowDays))
    .filter((m) => (m.lineageEpoch ?? 0) < required)
    .map((m) => m.name);

  return behind;
}

/**
 * Has any member's device reported that the pod is too large to open?
 *
 * A real failure outranks the size heuristic — the family whose tablet cannot
 * open the file is due regardless of what the byte threshold says.
 */
export function anyDeviceReportedTooLarge(
  members: readonly FamilyMember[],
  opts: { today?: Date; windowDays?: number } = {}
): boolean {
  // ⚠️ BOUNDED, like the soak window. A bare truthiness scan latches forever:
  // a tablet that ran out of memory in March, was replaced in April, and whose
  // row still carries the stamp would keep telling the owner in 2027 that
  // compacting "will fix that for them" — inviting a one-way,
  // history-destroying migration that would now free nothing. Compaction also
  // clears the stamps it resolves; this is the second belt.
  const today = opts.today ?? new Date();
  const windowDays = opts.windowDays ?? SOAK_WINDOW_DAYS;
  return members.some((m) => withinWindow(m.podTooLargeSeenAt, today, windowDays));
}
