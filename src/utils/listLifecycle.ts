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
import type { UIStringKey } from '@/services/translation/uiStrings';
import { resolveListRule } from '@/services/recurrence/adapters';
import { firstDueOnOrAfter, isResetDue } from '@/services/recurrence/recurrenceEngine';
import { addDaysYmd } from '@/utils/date';
import {
  plateOf,
  showDateOf,
  showFromTag,
  showRuleLabel,
  showRuleOf,
  type PlateClock,
  type ShowSubject,
  type TodoPlate,
} from '@/utils/todoPlate';

/** A recurring (schedule-driven, auto-resetting) list. */
export function isRecurring(list: Pick<FamilyList, 'lifecycle'>): boolean {
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

/** A list as a show subject (`utils/todoPlate`), plus which round its items belong to. */
export interface ListSubject extends ShowSubject {
  kind: 'list';
  /**
   * Do the list's items, as they stand, belong to the day asked about? True for a one-off; for
   * a repeating list on the day its round began (its real reset day), or under Every Day
   * (`now`) on a day before the first reset after the cycle start (the round in progress).
   * False otherwise: the day belongs to a later round, whose items untick on its reset.
   */
  liveRound: boolean;
}

/**
 * A list as the show rule reads it, on day `todayYmd`. One-off: its `dueDate`. Repeating: its
 * due day is its reset day (plan 2026-10-28): today when the round began today (or tomorrow,
 * stamped by a device in a time zone ahead), otherwise the next reset on or after today
 * (`nextListResetOnOrAfter`). Null for a repeating list with no
 * resolvable reset day (no cadence, no baseline): it never comes due, so it reads as
 * `waiting`. The lead clamp takes the cadence from `resolveListRule`, never `list.cadence`: a
 * list made repeating by the lifecycle flip stores `frequency` only. Pure.
 */
export function listSubject(list: FamilyList, todayYmd: string): ListSubject | null {
  const fields = {
    kind: 'list' as const,
    showFrom: list.showFrom,
    showOn: list.showOn,
    showLeadDays: list.showLeadDays,
  };
  if (!isRecurring(list)) {
    const due = list.dueDate?.slice(0, 10);
    return { ...fields, dueDate: due, repeating: false, cadence: null, liveRound: true };
  }
  const start = cycleStartOf(list);
  // The round began today, or on a device whose day is already ahead of this one (a family
  // across time zones: a device past midnight stamps its own date, which is tomorrow here).
  // Either way the reset has run and the items are the round in progress, so it is due today.
  // Bounded to one day, the most a time-zone skew can put it ahead: a start further out (a bad
  // stamp, a clock set wrong) reads as waiting for its next reset after that start.
  const began = !!start && (start === todayYmd || start === addDaysYmd(todayYmd, 1));
  const due = began ? todayYmd : nextListResetOnOrAfter(list, todayYmd);
  if (!due) return null;
  const subject: ListSubject = {
    ...fields,
    dueDate: due,
    repeating: true,
    cadence: resolveListRule(list)?.rule ?? null,
    liveRound: began,
  };
  if (!subject.liveRound && start && due > todayYmd && showRuleOf(subject).kind === 'now') {
    subject.liveRound = due === nextListResetOnOrAfter(list, start);
  }
  return subject;
}

/** The plate for a list subject; `waiting` when there is none (no resolvable reset day). */
function plateOfList(subject: ListSubject | null, clock: PlateClock): TodoPlate {
  return subject ? plateOf(subject, clock) : 'waiting';
}

/**
 * Where a list sits on the clock's day: the to-do date rule over `listSubject`. A repeating
 * list is never `overdue` (its due day is today or later). Pure: it runs in computeds and once
 * per widget day.
 */
export function listPlate(list: FamilyList, clock: PlateClock): TodoPlate {
  return plateOfList(listSubject(list, clock.ymd), clock);
}

/**
 * The "N left" the briefing and the widget share: the open items while the subject's day
 * belongs to the live round (`liveRound`), otherwise every item (a later round, whose items
 * untick on its reset).
 */
export function listRemaining(list: FamilyList, subject: ListSubject): number {
  return subject.liveRound ? listProgress(list).open : list.items.length;
}

/** The clock for a day: lists carry no due time, so the minute never matters. */
const dayClock = (ymd: string): PlateClock => ({ ymd, hhmm: '00:00' });

/**
 * The "Shows from ..." tag for a list that is not showing yet (its plate is `waiting`), or null
 * when it already shows or has no day to show on. The one source for the Lists page tile and
 * the drawer's meta band. A one-off reads as the to-do tag does ("Shows on the due date", "Shows
 * from {date}"); a repeating list has no due date anywhere in its UI, so it names the actual day
 * it next shows (its next reset day, less any Days Before lead): "Shows from {date}".
 */
export function listShowLabel(
  list: FamilyList,
  todayYmd: string,
  t: (key: UIStringKey) => string
): string | null {
  const subject = listSubject(list, todayYmd);
  if (!subject?.dueDate || plateOf(subject, dayClock(todayYmd)) !== 'waiting') return null;
  if (subject.repeating) {
    const show = showDateOf(subject);
    return show ? showFromTag(show, t) : null;
  }
  return showRuleLabel(showRuleOf(subject), subject.dueDate, todayYmd, t) || null;
}

/**
 * The due state for the Lists page's shelf, tile and nav badge: an exact mapping of
 * `listPlate` (`overdue` → `'overdue'`, `today` → `'today'`, `undated` → `'noDue'`,
 * `upcoming` and `waiting` → null). A repeating list is `'today'` only on the day its round
 * began (`liveRound`) and while it has open items: a finished round is off the plate the way a
 * finished one-off is filed (a repeating list is never filed, so the check lives here; caught
 * in the browser walk, 2026-10-28), and a reset day whose reset has not run yet is not.
 */
export function isListDue(list: FamilyList, todayStr: string): ListDueState | null {
  const subject = listSubject(list, todayStr);
  switch (plateOfList(subject, dayClock(todayStr))) {
    case 'overdue':
      return 'overdue';
    case 'today':
      if (!subject?.repeating) return 'today';
      return subject.liveRound && listProgress(list).open > 0 ? 'today' : null;
    case 'undated':
      return 'noDue';
    default:
      return null; // upcoming, or waiting to show
  }
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
