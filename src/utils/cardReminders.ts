/**
 * Card reminders (#123 Phase B): the pure engine that turns a Who Owns What card's reminders
 * into rolling to-dos, plus the two pure helpers the card editor uses to build a reminder.
 *
 * Pure: no store, no clock (every "today" is passed in), no logging beyond `startRepeat`'s
 * own report of a corrupt rule. The orchestrator (`composables/useCardReminders`) guards,
 * calls this, and writes the diff through `todoStore`.
 *
 * Rules that live here and nowhere else:
 *   - ONE to-do per (card, part) with a reminder, a holder, and a kept card. Its id is
 *     DETERMINISTIC (`cardTodoId`), so two adult devices converge on one record.
 *   - The card OWNS the fields in `CARD_MANAGED_FIELDS` (title, assignee, due time, repeat,
 *     open state). The diff (`reconcileCardTodos`) and the orchestrator's watch key
 *     (`cardRemindersKey`) are both built from that one table, so a managed field cannot be
 *     patched without also being watched. `dueDate` (the store's roll), `description` and
 *     `repeatLog` (the family's) are deliberately NOT managed and never written here, except
 *     that a repeat change or a reopen re-dates the to-do.
 *   - Nothing locale-dependent is generated: the title is the stored `say`.
 *
 * Dependency direction (one-way): this module reads the deck's resolved types; the deck,
 * its builders and its store never import this module or any to-do code.
 */
import type {
  CardReminder,
  CreateTodoInput,
  RecurrenceRule,
  TodoItem,
  UpdateTodoInput,
} from '@/types/models';
import { cadenceKey, cadenceOf, cadenceToRule, ruleKey } from '@/services/recurrence/cadence';
import { firstDueOnOrAfter, isRuleComplete } from '@/services/recurrence/recurrenceEngine';
import { normalizeAssignees, toAssigneePayload } from '@/utils/assignees';
import { isCardTodo, rollOverdue, startRepeat } from '@/utils/todoRecurrence';
import { MAIN_PART_KEY, type ResolvedCard } from '@/utils/responsibilityDeck';

/** The to-do id for one card part's reminder. The ONE place this id is built. */
export function cardTodoId(cardId: string, partKey: string): string {
  return `card-${cardId}-${partKey}`;
}

/** A to-do the cards want to exist, ready for `todoStore.createTodos` (it carries its id). */
export type DesiredCardTodo = CreateTodoInput & {
  id: string;
  cardId: string;
  cardPartKey: string;
  dueDate: string;
  repeat: NonNullable<TodoItem['repeat']>;
};

/** The fields a managed-field fingerprint reads (shared by desired and existing to-dos). */
type CardTodoFields = Pick<
  TodoItem,
  'title' | 'assigneeIds' | 'assigneeId' | 'dueTime' | 'repeat' | 'completed' | 'someday'
>;

/** One field the card owns on its to-do. */
export interface CardManagedField {
  field: 'title' | 'assignee' | 'dueTime' | 'repeat' | 'completed' | 'someday';
  /** A canonical string for this field's value, the unit of both the diff and the watch key. */
  value(todo: CardTodoFields): string;
  /** Does `existing` already carry `desired`'s value for this field? */
  equals(desired: CardTodoFields, existing: CardTodoFields): boolean;
  /** The patch that puts `desired`'s value on the to-do. */
  patch(desired: DesiredCardTodo): UpdateTodoInput;
}

function managed(
  field: CardManagedField['field'],
  value: CardManagedField['value'],
  patch: CardManagedField['patch']
): CardManagedField {
  return { field, value, equals: (d, e) => value(d) === value(e), patch };
}

/** A stored repeat's identity, safe on a malformed record (any client may have written it). */
function repeatValue(repeat: TodoItem['repeat']): string {
  const rule = repeat?.rule as RecurrenceRule | undefined;
  if (!rule || !isRuleComplete(rule)) return repeat ? 'invalid' : '';
  return `${ruleKey(rule)}|${String(repeat?.anchor ?? '')}`;
}

/**
 * The fields the card owns, with an `equals` each. `reconcileCardTodos` walks this table to
 * build its patches and `cardRemindersKey` fingerprints the same table, so adding a managed
 * field here is the whole change. A repeat change and a reopen both re-date the to-do to the
 * desired first occurrence (`reconcileCardTodos` then steps past any already-logged date).
 * `someday` is managed because an old client's "Track as someday" clears the due date, and
 * the store's roll never touches a someday to-do.
 */
export const CARD_MANAGED_FIELDS: readonly CardManagedField[] = [
  managed(
    'title',
    (t) => t.title ?? '',
    (d) => ({ title: d.title })
  ),
  managed(
    'assignee',
    (t) => normalizeAssignees(t).join(','),
    (d) => toAssigneePayload(normalizeAssignees(d))
  ),
  managed(
    'dueTime',
    (t) => t.dueTime ?? '',
    // `undefined` clears a stored time (the reminder went all-day).
    (d) => ({ dueTime: d.dueTime })
  ),
  managed(
    'repeat',
    (t) => repeatValue(t.repeat),
    (d) => ({ repeat: d.repeat, dueDate: d.dueDate })
  ),
  managed(
    'completed',
    (t) => (t.completed ? '1' : '0'),
    (d) => ({
      completed: false,
      completedBy: undefined,
      completedAt: undefined,
      dueDate: d.dueDate,
    })
  ),
  managed(
    'someday',
    (t) => (t.someday ? '1' : '0'),
    (d) => ({ someday: undefined, dueDate: d.dueDate })
  ),
];

/**
 * The to-dos the deck wants: one per part of a KEPT card that has both a holder and a
 * (valid, resolved) reminder. A skipped or unsorted card, a part with nobody, and a part
 * without a reminder produce none. The title is the stored `say`; the series starts from the
 * reminder's own anchor, so every device derives the same rule and the same first date.
 */
export function computeDesiredCardTodos(
  cards: readonly ResolvedCard[],
  todayYmd: string,
  createdBy: string
): DesiredCardTodo[] {
  const out: DesiredCardTodo[] = [];
  for (const card of cards) {
    if (card.state?.status !== 'kept') continue;
    for (const part of card.parts) {
      const reminder = part.reminder;
      if (!reminder || !part.holderId) continue;
      // Null only for a rule the engine cannot use (reported once by `startRepeat`).
      const started = startRepeat(cadenceToRule(reminder.cadence), reminder.anchor, todayYmd);
      if (!started) continue;
      const todo: DesiredCardTodo = {
        id: cardTodoId(card.id, part.key),
        title: reminder.say,
        ...toAssigneePayload([part.holderId]),
        dueDate: started.dueDate,
        repeat: started.repeat,
        repeatLog: started.repeatLog,
        completed: false,
        createdBy,
        cardId: card.id,
        cardPartKey: part.key,
      };
      if (reminder.time) todo.dueTime = reminder.time;
      out.push(todo);
    }
  }
  return out;
}

export interface CardTodoDiff {
  toCreate: DesiredCardTodo[];
  toPatch: { id: string; patch: UpdateTodoInput }[];
  toRemove: string[];
}

/** The patch that brings `existing` back to what the card says, or null when it already does. */
function managedPatch(
  desired: DesiredCardTodo,
  existing: TodoItem,
  todayYmd: string
): UpdateTodoInput | null {
  const patch: UpdateTodoInput = {};
  for (const f of CARD_MANAGED_FIELDS) {
    if (!f.equals(desired, existing)) Object.assign(patch, f.patch(desired));
  }
  if (!Object.keys(patch).length) return null;
  if (patch.dueDate) {
    // A re-dated to-do never lands on an occurrence its log already handled.
    const rolled = rollOverdue(
      {
        repeat: patch.repeat ?? existing.repeat,
        dueDate: patch.dueDate,
        repeatLog: existing.repeatLog,
        completed: false,
      },
      todayYmd
    );
    if (rolled?.dueDate) patch.dueDate = rolled.dueDate;
  }
  return patch;
}

/**
 * Diff the desired card to-dos against the card to-dos that exist (`isCardTodo`, completed
 * included): create the missing ones, patch the managed fields that drifted (field by field,
 * from `CARD_MANAGED_FIELDS`), and remove every card to-do no card wants any more. Identical
 * inputs give an empty diff.
 */
export function reconcileCardTodos(
  desired: readonly DesiredCardTodo[],
  existingCardTodos: readonly TodoItem[],
  todayYmd: string
): CardTodoDiff {
  const existingById = new Map(existingCardTodos.filter(isCardTodo).map((t) => [t.id, t]));
  const wanted = new Set(desired.map((d) => d.id));
  const diff: CardTodoDiff = { toCreate: [], toPatch: [], toRemove: [] };
  for (const d of desired) {
    const existing = existingById.get(d.id);
    if (!existing) {
      diff.toCreate.push(d);
      continue;
    }
    const patch = managedPatch(d, existing, todayYmd);
    if (patch) diff.toPatch.push({ id: d.id, patch });
  }
  for (const id of existingById.keys()) {
    if (!wanted.has(id)) diff.toRemove.push(id);
  }
  return diff;
}

function fingerprint(todo: CardTodoFields & { id: string }): string {
  return [todo.id, ...CARD_MANAGED_FIELDS.map((f) => f.value(todo))].join('\u0001');
}

/**
 * The orchestrator's single watch source: the managed-field fingerprints of both sides,
 * order-independent. It changes exactly when the diff could: a reminder or holder change, a
 * card to-do deleted, completed or edited elsewhere. A `dueDate` change alone (the store's
 * roll) or a new day leaves it unchanged.
 */
export function cardRemindersKey(
  desired: readonly DesiredCardTodo[],
  existingCardTodos: readonly TodoItem[]
): string {
  const side = (todos: readonly (CardTodoFields & { id: string })[]) =>
    todos.map(fingerprint).sort().join('\u0002');
  return `${side(desired)}\u0003${side(existingCardTodos.filter(isCardTodo))}`;
}

/** `'split'` when any desired to-do belongs to a split card's part, else `'single'`. */
export function cardRemindersKind(desired: readonly DesiredCardTodo[]): 'single' | 'split' {
  return desired.some((d) => d.cardPartKey !== MAIN_PART_KEY) ? 'split' : 'single';
}

/**
 * The card editor picker's start date: the reminder's next occurrence on or after today, or
 * today for a new reminder. It is also the anchor `buildCardReminder` stores on a cadence
 * change, so what the picker showed is what is saved.
 */
export function reminderStartDate(reminder: CardReminder | null, todayYmd: string): string {
  if (!reminder) return todayYmd;
  return firstDueOnOrAfter(cadenceToRule(reminder.cadence), reminder.anchor, todayYmd) ?? todayYmd;
}

/**
 * The reminder the editor saves. `say` is trimmed and falls back to `fallbackSay` (the card's
 * name) so it is always stored; the anchor is kept while the cadence is unchanged and becomes
 * `startYmd` (the picker's start date, `reminderStartDate`) when it changes. Components never
 * compute anchors themselves.
 */
export function buildCardReminder(
  prev: CardReminder | null,
  input: { say: string; rule: RecurrenceRule; time?: string | null },
  fallbackSay: string,
  startYmd: string
): CardReminder {
  const cadence = cadenceOf(input.rule);
  const keepAnchor = prev && cadenceKey(prev.cadence) === cadenceKey(cadence);
  const out: CardReminder = {
    say: input.say.trim() || fallbackSay,
    cadence,
    anchor: keepAnchor ? prev.anchor : startYmd,
  };
  if (input.time) out.time = input.time;
  return out;
}
