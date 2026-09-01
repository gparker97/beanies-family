/**
 * Snapshotting a recurring list's finished cycle.
 *
 * `reconcileRecurringLists` resets a recurring list in place — unchecks every item and
 * bumps `lastResetDate` — so before this existed the previous cycle was simply
 * overwritten. The app could answer "what is outstanding today" and nothing else.
 *
 * Pure and Vue-free by design: no store, no clock, no `Date.now()`. Everything takes the
 * day as a parameter, so the boundary behaviour is testable rather than only observable
 * in December.
 */
import { listProgress } from '@/utils/listLifecycle';
import type { FamilyList, ListCycle, ListCycleMark } from '@/types/models';

/**
 * `${listId}:${endedOn}` — deterministic on purpose.
 *
 * Re-running the rollover overwrites rather than duplicating, and two devices waking at
 * the same midnight converge on one record instead of two. Never parse it back: `listId`
 * and `endedOn` are stored as their own fields precisely so nothing has to.
 */
export const cycleId = (listId: string, endedOn: string): string => `${listId}:${endedOn}`;

/**
 * Build the snapshot from a list AS IT IS, before the reset.
 *
 * @returns `null` when there is nothing worth remembering — a recurring list with no
 *   items at all. "0 of 0" is noise, not history. (A cycle where nothing was *ticked* is
 *   very much archived: "0 of 5" on a Tuesday is what a parent is looking for.)
 */
export function buildCycleSnapshot(
  list: FamilyList,
  endedOn: string,
  nowIso: string
): ListCycle | null {
  if (!list.items.length) return null;

  const items: ListCycleMark[] = list.items.map((item) => ({
    title: item.title,
    done: item.completed,
    // Only on a done item — an unticked row has nobody to name, and an `undefined` key
    // would have to be stripped before it reached Automerge anyway.
    ...(item.completed && item.completedBy ? { by: item.completedBy } : {}),
  }));

  const { done, total } = listProgress(list);

  return {
    id: cycleId(list.id, endedOn),
    listId: list.id,
    // The reset cursor is the only boundary the recurrence engine exposes, and it is the
    // honest one: a list unopened for a week yields ONE cycle spanning the whole gap
    // rather than five fabricated daily ones.
    startedOn: (list.lastResetDate ?? endedOn).slice(0, 10),
    endedOn,
    // Denormalised so renaming a list does not retroactively rename its history, and so
    // the archive still renders after the parent list is deleted.
    title: list.title,
    emoji: list.emoji,
    category: list.category,
    ownerId: list.ownerId,
    done,
    total,
    items,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

// ── Retention ────────────────────────────────────────────────────────────────
//
// This half DELETES a family's history, automatically and irreversibly, unattended on a
// background wake. The upside is bounded (a few hundred KB of RAM and a browsable shelf);
// the downside, if it misfires, is not. Everything below is shaped by that asymmetry.
//
// Note deletion does NOT shrink the `.beanpod`: Automerge history is permanent (ADR-032),
// so a delete is another op. What it buys is memory, shelf usability, and not holding
// onto family data longer than needed. Never present it as reclaiming space.

/** Three months. The ONE retention knob; a future "keep longer" setting replaces this. */
export const CYCLE_KEEP_DAYS = 90;

/**
 * Ceiling on a single sweep. Steady-state churn for the heaviest family modelled is ~3.3
 * cycles/day, so this is a two-week backlog cushion — and it bounds the blast radius of
 * any single bad decision, plus the size of one `Automerge.change` on a low-end phone.
 */
export const MAX_SWEEP_DELETES = 50;

/** A forward clock jump larger than this is not trusted; the sweep skips that run. */
export const MAX_TRUSTED_CLOCK_JUMP_DAYS = 7;

/**
 * Hotfix kill switch: flip to `false` and ship to stop every device deleting history.
 *
 * A compile-time constant on purpose, and honestly labelled as one — it is a ONE-LINE
 * RELEASE, not a runtime lever. `src/config/flags.ts` is the runtime system, but its
 * per-browser localStorage override reaches one browser and its committed state still
 * requires a release, so it would buy nothing here while implying a fleet switch that
 * does not exist. If a data-loss report ever arrives, the answer is this line and a
 * deploy, not a redesign under pressure.
 */
export const CYCLE_SWEEP_ENABLED = true;

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** `todayYmd` minus `days`, as a ymd string. Local-time, no UTC drift. */
function shiftYmd(todayYmd: string, days: number): string {
  const d = new Date(`${todayYmd}T00:00:00`);
  d.setDate(d.getDate() + days);
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/**
 * Is this date usable AND strictly older than the cutoff?
 *
 * Returns false — i.e. KEEP — for anything missing, empty, malformed or in the future. A
 * plain string compare would treat `''` as older than any cutoff, which is exactly how a
 * partially-loaded or hand-edited record would silently lose a family's history.
 */
function isExpiredDate(value: string | undefined, cutoff: string, todayYmd: string): boolean {
  const ymd = value?.slice(0, 10);
  if (!ymd || !YMD.test(ymd)) return false;
  if (ymd > todayYmd) return false; // a clock artefact, not expired data
  return ymd < cutoff;
}

/**
 * Which stored cycles have expired.
 *
 * PURE, and the argument list is the point: the ONLY inputs are the cycles and today. No
 * lists, no store, no clock, no other collection. An earlier draft also pruned "orphans"
 * whose parent list was gone, which read `lists` — meaning any state with an empty or
 * partially-loaded lists collection would have marked EVERY cycle for deletion. Keep this
 * signature at two parameters.
 *
 * A cycle expires only when BOTH its `endedOn` and its `createdAt` are expired. Both come
 * from the same device clock so this is not a wrong-clock guard; it is a malformed-record
 * guard — a record with one truncated date is still provably un-expired by the other.
 */
export function expiredCycleIds(cycles: readonly ListCycle[], todayYmd: string): string[] {
  if (!YMD.test(todayYmd)) return [];
  const cutoff = shiftYmd(todayYmd, -CYCLE_KEEP_DAYS);
  return cycles
    .filter(
      (c) =>
        isExpiredDate(c.endedOn, cutoff, todayYmd) && isExpiredDate(c.createdAt, cutoff, todayYmd)
    )
    .sort((a, b) => a.endedOn.localeCompare(b.endedOn)) // oldest first
    .slice(0, MAX_SWEEP_DELETES)
    .map((c) => c.id);
}
