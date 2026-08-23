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
import { isResetDue } from '@/services/recurrence/recurrenceEngine';

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
  return { total, done, pct: total ? Math.round((done / total) * 100) : 0 };
}

export type ListDueState = 'overdue' | 'today' | 'noDue';

/**
 * The single due-state rule, mirroring `isTodoOverdue` / the to-do briefing
 * gating. Returns `null` for a future-dated list ("not on the plate yet") and
 * for any recurring list (the schedule, not a due date, drives those).
 */
export function isListDue(list: FamilyList, todayStr: string): ListDueState | null {
  if (isRecurring(list)) return null;
  if (!list.dueDate) return 'noDue';
  const due = list.dueDate.slice(0, 10);
  if (due < todayStr) return 'overdue';
  if (due === todayStr) return 'today';
  return null; // future-dated
}

/**
 * "On the plate now" — overdue or due today. False for recurring, undated, and
 * future-dated lists (`isListDue` returns `null`/`'noDue'`), so it cleanly drives
 * both the due-soon shelf and the nav attention badge from one rule.
 */
export function isDueSoon(list: FamilyList, todayStr: string): boolean {
  const due = isListDue(list, todayStr);
  return due === 'overdue' || due === 'today';
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
