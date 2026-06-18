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
import { parseLocalDate, toDateInputValue } from '@/utils/date';

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

/** The Monday (ISO week start) of the week containing `ymd`, as `YYYY-MM-DD`. */
function mondayOf(ymd: string): string {
  const d = parseLocalDate(ymd.slice(0, 10));
  const dow = d.getDay(); // 0=Sun..6=Sat
  const daysSinceMonday = (dow + 6) % 7;
  d.setDate(d.getDate() - daysSinceMonday);
  return toDateInputValue(d);
}

/** `YYYY-MM` of `ymd` — the calendar-month key. */
function monthKey(ymd: string): string {
  return ymd.slice(0, 7);
}

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
  if (!isRecurring(list) || !list.frequency || !last) {
    return { shouldReset: false, nextResetDate: last ?? todayStr };
  }

  let shouldReset = false;
  switch (list.frequency) {
    case 'daily':
      shouldReset = todayStr > last;
      break;
    case 'weekly':
      shouldReset = mondayOf(todayStr) > mondayOf(last);
      break;
    case 'monthly':
      shouldReset = monthKey(todayStr) > monthKey(last);
      break;
  }
  return { shouldReset, nextResetDate: shouldReset ? todayStr : last };
}
