// Beanie Lists (#33) — the ONE home for lifecycle semantics.
//
// `FamilyList` carries two completion vocabularies on one flat interface
// (one-off filing vs. recurring cadence). To stop `lifecycle === …` checks
// scattering across the store, page, tile, modal, briefing, and notifications,
// every lifecycle-conditional read goes through the pure predicates here. A
// future cadence change (e.g. a 4th frequency) is then a one-file edit.
//
// All helpers are pure, Vue-free, and timezone-correct via `YYYY-MM-DD` string
// math (never `new Date()` / `Date.now()`), so they are trivially unit-testable
// and safe to call from date-dependent code that reads `useToday`.

import type { FamilyList } from '@/types/models';
import { resolveListRule } from '@/services/recurrence/adapters';
import { firstDueOnOrAfter, isResetDue } from '@/services/recurrence/recurrenceEngine';
import { addDaysYmd } from '@/utils/date';

/** A recurring (schedule-driven, auto-resetting) list. */
export function isRecurring(list: FamilyList): boolean {
  return list.lifecycle === 'recurring';
}

/** "In the Completed area" — only one-off lists are ever filed away. */
export function isFiled(list: FamilyList): boolean {
  return !isRecurring(list) && list.completed;
}

export interface ListProgress {
  total: number;
  done: number;
  /** Items still unticked (`total - done`); the one "N left" for the briefing, widget, reminders and bell. */
  open: number;
  /** Completed percentage 0–100, `0` for an empty list (never `NaN`). */
  pct: number;
}

/**
 * Item progress for a list — the single source for the tile + linked-list embed
 * bars (both render it on lists mid-edit, so the empty case must be 0, not NaN).
 */
export function listProgress(list: FamilyList): ListProgress {
  const total = list.items.length;
  const done = list.items.filter((i) => i.completed).length;
  return { total, done, open: total - done, pct: total ? Math.round((done / total) * 100) : 0 };
}

export type ListDueState = 'overdue' | 'today' | 'noDue';

/** Date part of a recurring list's current cycle start; null for a one-off or a never-stamped list. */
function cycleStartOf(list: FamilyList): string | null {
  return isRecurring(list) ? (list.lastResetDate?.slice(0, 10) ?? null) : null;
}

/**
 * The single due-state rule, mirroring `isTodoOverdue` / the to-do briefing
 * gating. Returns `null` for a future-dated list ("not on the plate yet") and
 * for a repeating list between resets. A repeating list is `'today'` on the day
 * its current round began (`lastResetDate`), never overdue and never `'noDue'`.
 */
export function isListDue(list: FamilyList, todayStr: string): ListDueState | null {
  if (isRecurring(list)) {
    // A repeating list is on the plate on the day its round began (greg, 2026-10-28):
    // same treatment as a one-off reaching its due date. Never overdue, never "noDue".
    // A finished round is off the plate the way a finished one-off is filed: a one-off
    // leaves `activeLists` when every item is ticked, but a repeating list is never filed,
    // so the open-items check has to live here or the shelf and badge keep nagging about a
    // routine that is already done for today (caught in the browser walk, 2026-10-28).
    return cycleStartOf(list) === todayStr && listProgress(list).open > 0 ? 'today' : null;
  }
  if (!list.dueDate) return 'noDue';
  const due = list.dueDate.slice(0, 10);
  if (due < todayStr) return 'overdue';
  if (due === todayStr) return 'today';
  return null; // future-dated
}

/**
 * "On the plate now" — overdue or due today. False for undated and future-dated
 * lists and for a repeating list between resets (`isListDue` returns
 * `null`/`'noDue'`), so it cleanly drives both the due-soon shelf and the nav
 * attention badge from one rule.
 */
export function isDueSoon(list: FamilyList, todayStr: string): boolean {
  const due = isListDue(list, todayStr);
  return due === 'overdue' || due === 'today';
}

/**
 * The first day on or after `ymd` that this recurring list is scheduled to reset, from
 * the engine's anchor schedule (the same schedule `computeRecurringReset` consults).
 * Never a day on or before the current cycle start: that reset has already happened, and
 * answering it again would put a finished round back on the plate (the widget asks this
 * for the real today too). `null` for a one-off list, a recurring list with no cadence
 * (already reported once by `resolveListRule`), one with no `lastResetDate` baseline
 * (never resets), or an unparseable anchor (the engine's generator bails on a NaN anchor).
 * Pure.
 */
export function nextListResetOnOrAfter(list: FamilyList, ymd: string): string | null {
  const start = cycleStartOf(list);
  const resolved = start ? resolveListRule(list) : null;
  if (!start || !resolved) return null;
  const from = ymd > start ? ymd : addDaysYmd(start, 1);
  return firstDueOnOrAfter(resolved.rule, resolved.anchor, from);
}

// (#70) `mondayOf` / `monthKey` — the old per-frequency reset switch — moved to
// `listLifecycle.test.ts` as the PARITY ORACLE. The engine now decides the
// boundary; the test asserts it reproduces the legacy rule exactly, so deleting
// the implementation here does not destroy the thing that proves it correct.

export interface RecurringResetResult {
  /** True when a new period has started since `lastResetDate`. */
  shouldReset: boolean;
  /** The value to stamp into `lastResetDate` (today's date when resetting; the
   * existing baseline otherwise). Stamping `todayStr` keeps a second same-day
   * run a no-op (idempotent). */
  nextResetDate: string;
}

/**
 * Decide whether a recurring list should auto-reset (uncheck all items) given
 * the current local day. Pure — no Vue, no `Date.now()`. A list with no
 * `lastResetDate` baseline never resets (the store stamps it on create), so a
 * freshly-seeded recurring list keeps its starter items until its first real
 * period boundary.
 */
export function computeRecurringReset(list: FamilyList, todayStr: string): RecurringResetResult {
  const last = list.lastResetDate?.slice(0, 10);
  // Both guards preserved verbatim (#70): a non-recurring list, or one with no
  // `lastResetDate` baseline, never resets. `resolveListRule` returns null for a
  // recurring list with neither cadence nor frequency, which subsumes the old
  // `!list.frequency` check without defaulting anything to weekly.
  const resolved = isRecurring(list) && last ? resolveListRule(list) : null;
  if (!resolved || !last) {
    return { shouldReset: false, nextResetDate: last ?? todayStr };
  }

  // The engine decides the boundary. `anchor` (creation) and the `last` cursor
  // stay separate, so a cycle never re-anchors on a missed reset — an
  // every-2-weeks list left unopened past its due day does not drift forward.
  const shouldReset = isResetDue(resolved.rule, resolved.anchor, last, todayStr);
  return { shouldReset, nextResetDate: shouldReset ? todayStr : last };
}
