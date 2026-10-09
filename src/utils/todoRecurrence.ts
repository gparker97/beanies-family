import type {
  RecurrenceRule,
  TodoItem,
  TodoRepeat,
  TodoRepeatLogEntry,
  UpdateTodoInput,
  UUID,
} from '@/types/models';
import { resolveTodoRule, type ResolvedRule } from '@/services/recurrence/adapters';
import {
  firstDueOnOrAfter,
  nextDueAfter,
  occurrencesInRange,
} from '@/services/recurrence/recurrenceEngine';
import { isOccurrence } from '@/services/recurrence/cadence';
import { extractDatePart } from '@/utils/date';

/**
 * Repeating to-dos (#123): ONE rolling record whose `dueDate` follows a rule. Pure: no store,
 * no clock (every "today" is passed in), no logging beyond `resolveTodoRule`'s own report of
 * a corrupt stored rule. Every function reads the schedule through `resolveTodoRule`, so a
 * malformed `repeat` behaves as "not repeating" everywhere at once.
 *
 * Invariants (see the plan, "Important Notes & Caveats"):
 *   - The anchor is FIXED: it is the picker's start date when the rule was set and is never
 *     moved by a roll. Only `startRepeat` writes it.
 *   - On a repeating to-do `dueDate` has three writers: `startRepeat`, `advanceRepeat` and
 *     `rollOverdue`. Every value they write is an occurrence of the rule.
 *   - A "missed" occurrence is DERIVED on read (`recentOccurrences`), never written, and never
 *     predates `seriesStart`.
 *   - `repeatLog` keeps the newest `REPEAT_LOG_KEEP` entries, keyed by `date`.
 */

/** How many handled occurrences a repeating to-do keeps. */
export const REPEAT_LOG_KEEP = 12;

type RepeatFields = Pick<TodoItem, 'repeat'>;

/** Does this to-do carry a usable repeat rule? */
export function isRepeating(todo: RepeatFields): boolean {
  return resolveTodoRule(todo) !== null;
}

/** Was this to-do made (and is it maintained) by a responsibility card's reminder? */
export function isCardTodo(todo: Pick<TodoItem, 'cardId'>): boolean {
  return !!todo.cardId;
}

/** What a person may do to a to-do. The ONE place these rules live (UI hiding + store refusal). */
export interface TodoCapabilities {
  editTitle: boolean;
  editAssignee: boolean;
  editDueDate: boolean;
  editDueTime: boolean;
  editRepeat: boolean;
  someday: boolean;
  delete: boolean;
  skip: boolean;
}

/**
 * The capability table:
 *   - card-made: title, assignee, due time, repeat and delete are the card's (off);
 *   - repeating (and card-made, which always repeats): due date and someday are off, because
 *     only the roll may move the date and someday would clear it;
 *   - skip is on only for an open repeating to-do.
 */
export function todoCapabilities(
  todo: Pick<TodoItem, 'repeat' | 'cardId' | 'completed'>
): TodoCapabilities {
  const card = isCardTodo(todo);
  const repeating = isRepeating(todo);
  const scheduled = repeating || card;
  return {
    editTitle: !card,
    editAssignee: !card,
    editDueDate: !scheduled,
    editDueTime: !card,
    editRepeat: !card,
    someday: !scheduled,
    delete: !card,
    skip: repeating && !todo.completed,
  };
}

const laterOf = (a: string, b: string): string => (a > b ? a : b);

/**
 * The date a series (re)starts from: the later of the to-do's due date (today when it has
 * none) and today. It is BOTH the picker's `start-date` in the drawer and the anchor
 * `setRepeat` stores, so what the picker showed is what is saved.
 */
export function repeatStartDate(todo: Pick<TodoItem, 'dueDate'>, todayYmd: string): string {
  const due = todo.dueDate ? extractDatePart(todo.dueDate) : '';
  return laterOf(due || todayYmd, todayYmd);
}

/** The fields a series start writes. */
export interface StartedRepeat {
  repeat: TodoRepeat;
  dueDate: string;
  repeatLog: TodoRepeatLogEntry[];
}

/**
 * The ONE place a series starts (form create, drawer turn-on or cadence change, card engine).
 * The anchor is `startYmd` exactly; `dueDate` is the first occurrence on or after both the
 * anchor and today (the anchor itself when the rule has none). `repeatLog` keeps
 * `existingLog`, or is seeded as `[]` so a concurrent first append merges. Returns null for a
 * rule or start date the engine cannot use (reported once by `resolveTodoRule`): a caller
 * then writes no repeat rather than a corrupt one.
 */
export function startRepeat(
  rule: RecurrenceRule,
  startYmd: string,
  todayYmd: string,
  existingLog?: TodoRepeatLogEntry[]
): StartedRepeat | null {
  const resolved = resolveTodoRule({ repeat: { rule, anchor: startYmd } });
  if (!resolved) return null;
  return {
    repeat: { rule: resolved.rule, anchor: resolved.anchor },
    dueDate: firstDueOnOrAfter(resolved.rule, resolved.anchor, todayYmd) ?? resolved.anchor,
    repeatLog: existingLog ?? [],
  };
}

/** The stored due date as YYYY-MM-DD, or '' when absent or unparseable. */
function dueYmd(todo: Pick<TodoItem, 'dueDate'>): string {
  return todo.dueDate ? extractDatePart(todo.dueDate) : '';
}

/**
 * One entry per date, the first in list order winning (the worker's duplicate-key heal rule).
 * Two devices that both handle the same occurrence offline each insert an entry for its date,
 * and the merged list keeps both until the next write to the log heals it.
 *
 * The tie-break is list position, never `outcome` or `at`: when one device records Done and
 * another Skipped for the same date, whichever entry Automerge orders first wins on every
 * device. That converges, but a person's just-recorded outcome can flip after a sync. A
 * deliberate residual (see the plan, "No missed writes"); changing it means changing the
 * worker's array heal rule too.
 */
function uniqueLog(log: readonly TodoRepeatLogEntry[] | undefined): TodoRepeatLogEntry[] {
  const seen = new Set<string>();
  return (log ?? []).filter((e) => !seen.has(e.date) && !!seen.add(e.date));
}

/** A log after one write, and how many entries the cap dropped from it. */
interface LoggedEntry {
  log: TodoRepeatLogEntry[];
  /** Entries trimmed by `REPEAT_LOG_KEEP` only (not duplicates collapsed or a same-date replace). */
  trimmed: number;
}

/** `log` with `entry` replacing any entry on the same date, oldest first, trimmed to the cap. */
function withLogEntry(
  log: readonly TodoRepeatLogEntry[] | undefined,
  entry: TodoRepeatLogEntry
): LoggedEntry {
  const merged = [...uniqueLog(log).filter((e) => e.date !== entry.date), entry];
  merged.sort((a, b) => a.date.localeCompare(b.date));
  const kept = merged.slice(-REPEAT_LOG_KEEP);
  return { log: kept, trimmed: merged.length - kept.length };
}

/** A roll's patch, plus how many log entries the cap trimmed (for the `rolled` telemetry). */
export interface RepeatRoll {
  patch: UpdateTodoInput;
  trimmed: number;
}

/**
 * Handle the current occurrence (`done` or `skipped`) and move to the next one. The current
 * occurrence is `dueDate`, or the first occurrence on or after today when it is missing. The
 * patch carries the new `dueDate` (`nextDueAfter` the current one, from the fixed anchor) and
 * the log with the entry added and trimmed; `trimmed` counts the entries the cap dropped.
 * `'series-ended'` when the rule has no next occurrence (the caller completes the to-do
 * normally); null when the to-do does not repeat.
 */
export function advanceRepeat(
  todo: Pick<TodoItem, 'repeat' | 'dueDate' | 'repeatLog'>,
  outcome: TodoRepeatLogEntry['outcome'],
  by: UUID | undefined,
  nowIso: string,
  todayYmd: string
): RepeatRoll | 'series-ended' | null {
  const resolved = resolveTodoRule(todo);
  if (!resolved) return null;
  const current = currentOccurrence(todo, resolved, todayYmd);
  if (!current) return 'series-ended';
  const next = nextDueAfter(resolved.rule, resolved.anchor, current);
  if (!next) return 'series-ended';
  const entry: TodoRepeatLogEntry = { date: current, outcome, at: nowIso, ...(by ? { by } : {}) };
  const { log, trimmed } = withLogEntry(todo.repeatLog, entry);
  return { patch: { dueDate: next, repeatLog: log }, trimmed };
}

/** The occurrence being handled: `dueDate`, or the first one on or after today when missing. */
function currentOccurrence(
  todo: Pick<TodoItem, 'dueDate'>,
  { rule, anchor }: ResolvedRule,
  todayYmd: string
): string | null {
  return dueYmd(todo) || firstDueOnOrAfter(rule, anchor, todayYmd);
}

/**
 * Skipping the LAST occurrence (`advanceRepeat` said `'series-ended'`): the to-do completes
 * with that occurrence logged as `skipped`, and with no `completedBy`, because nobody did it
 * (the Completed row must not read "Done by"). The entry is left out only when there is no
 * occurrence to name (no due date and none on or after today).
 */
export function skipLastOccurrence(
  todo: Pick<TodoItem, 'repeat' | 'dueDate' | 'repeatLog'>,
  by: UUID | undefined,
  nowIso: string,
  todayYmd: string
): UpdateTodoInput {
  const resolved = resolveTodoRule(todo);
  const current = resolved ? currentOccurrence(todo, resolved, todayYmd) : null;
  const entry: TodoRepeatLogEntry | null = current
    ? { date: current, outcome: 'skipped', at: nowIso, ...(by ? { by } : {}) }
    : null;
  return {
    completed: true,
    completedBy: undefined,
    completedAt: nowIso,
    ...(entry ? { repeatLog: withLogEntry(todo.repeatLog, entry).log } : {}),
  };
}

/** The first occurrence from `fromYmd` (inclusive) that is not already logged. */
function firstUnlogged(
  { rule, anchor }: ResolvedRule,
  fromYmd: string | null,
  logged: ReadonlySet<string>
): string | null {
  let date = fromYmd;
  // Each step consumes one logged date, so this ends within `logged.size` steps.
  while (date && logged.has(date)) date = nextDueAfter(rule, anchor, date);
  return date;
}

/**
 * The clock-driven roll and the self-heal for what a merge, a race or an old client can leave.
 * A `dueDate` that is missing, before today, or not an occurrence of the rule moves to the
 * first occurrence on or after today; one whose occurrence is already logged moves past every
 * logged occurrence. Null when the date is already right, the to-do is completed or does not
 * repeat, or the rule has no occurrence left (the to-do then stays put as a normal overdue
 * to-do). Writes no log entry: a missed occurrence is derived on read.
 */
export function rollOverdue(
  todo: Pick<TodoItem, 'repeat' | 'dueDate' | 'repeatLog' | 'completed'>,
  todayYmd: string
): UpdateTodoInput | null {
  if (todo.completed) return null;
  const resolved = resolveTodoRule(todo);
  if (!resolved) return null;
  const due = dueYmd(todo);
  const dueIsCurrent =
    !!due && due >= todayYmd && isOccurrence(resolved.rule, resolved.anchor, due);
  const from = dueIsCurrent ? due : firstDueOnOrAfter(resolved.rule, resolved.anchor, todayYmd);
  const logged = new Set((todo.repeatLog ?? []).map((e) => e.date));
  const target = firstUnlogged(resolved, from, logged);
  if (!target || target === due) return null;
  return { dueDate: target };
}

/**
 * The first day a "missed" occurrence may be derived from: the later of the anchor and the
 * day the to-do was created (local). Without the `createdAt` bound, a to-do made long after
 * its rule's anchor (a card reminder dealt months later, an overdue to-do turned repeating)
 * would open with a strip of phantom misses. Null when the to-do does not repeat.
 */
export function seriesStart(todo: Pick<TodoItem, 'repeat' | 'createdAt'>): string | null {
  const resolved = resolveTodoRule(todo);
  if (!resolved) return null;
  const created = todo.createdAt ? extractDatePart(todo.createdAt) : '';
  return laterOf(resolved.anchor, created);
}

/** One Recent chip: a stored entry, or a derived miss. */
export type RecentOccurrence = TodoRepeatLogEntry | { date: string; outcome: 'missed' };

/**
 * The newest `n` handled or missed occurrences, newest first (`n` clamped to
 * `REPEAT_LOG_KEEP`). Stored entries are merged with the occurrences between `seriesStart`
 * and the current `dueDate` (exclusive) that have no entry, which read as missed. Exact up to
 * the cap: every entry is an occurrence date, so the newest `n` occurrences are always
 * covered by the newest `REPEAT_LOG_KEEP` entries and trimming never invents a miss.
 */
export function recentOccurrences(
  todo: Pick<TodoItem, 'repeat' | 'dueDate' | 'repeatLog' | 'createdAt'>,
  n: number
): RecentOccurrence[] {
  const resolved = resolveTodoRule(todo);
  const start = seriesStart(todo);
  const limit = Math.max(0, Math.min(Math.floor(n), REPEAT_LOG_KEEP));
  if (!resolved || !start || limit === 0) return [];
  const log = uniqueLog(todo.repeatLog);
  const logged = new Set(log.map((e) => e.date));
  const end = dueYmd(todo);
  const missed: RecentOccurrence[] =
    end && end > start
      ? occurrencesInRange(resolved.rule, resolved.anchor, start, end)
          .filter((date) => date < end && !logged.has(date))
          .map((date) => ({ date, outcome: 'missed' as const }))
      : [];
  return [...log, ...missed].sort((a, b) => b.date.localeCompare(a.date)).slice(0, limit);
}
