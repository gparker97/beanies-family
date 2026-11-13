/**
 * "Who sees what" — the canonical audience classifier, extracted verbatim from
 * `useCriticalItems` so the daily briefing, the native OS reminders, AND the new
 * in-app notification deriver all share ONE rule (duplicating it would risk the
 * copies drifting). Pure: no Vue/store references — takes the viewer + a member
 * resolver. Locked by `utils/__tests__/audience.test.ts`.
 *
 * The rule:
 *   • You're directly assigned                  → 'assignee'.
 *   • No adult assigned, but ≥1 child is         → every adult sees it framed by
 *     the child's name ('forChild'); the assigned child sees it as their own
 *     ('assignee'); other children don't.
 *   • Nobody (resolvable, non-pet) is assigned   → everyone non-pet sees it
 *     ('unassigned') — also where truly-unassigned, all-stale-ID, and pet-only
 *     items land, all degrading gracefully.
 *   • Anything else                              → 'hidden' for this viewer.
 * Pets never get a briefing.
 *
 * The routine rule (greg, 2026-11-06; partially reverses #123's "adults see it too"):
 *   • A child's ROUTINE (a repeating to-do, which includes every card to-do, or a
 *     recurring list) is 'hidden' for adults while the child is on track. It turns
 *     back into 'forChild' once it is missed (the caller's own overdue predicate,
 *     passed in as `missed`) or when the item carries `notifyParents: true`.
 *   • One-offs, the child's own view, siblings and unassigned items are untouched.
 *   Consumers apply it through `classifyTodoAudience` / `gateTodoAudience` /
 *   `classifyListAudience` / `classifyChoreAudience` (#146, per bean); the gate itself stays private so no caller can hand-roll
 *   "is this a routine" (the two encodings are `isRepeating` and `isRecurring`).
 *   `isChildOnly` asks the same "child-only" question viewer-free, for the toggle UI.
 */
import { isAdultMember } from '@/composables/useMemberInfo';
import { listAssignees, normalizeAssignees } from '@/utils/assignees';
import { isFiled, isRecurring, listRemaining, listSubject } from '@/utils/listLifecycle';
import { isRepeating } from '@/utils/todoRecurrence';
import { isYmd, plateOf, todoPlate, type PlateClock, type ShownPlate } from '@/utils/todoPlate';
import type { BeanChoreDay } from '@/utils/chores';
import type {
  Chore,
  ChoreBlock,
  DutyCompletion,
  FamilyList,
  FamilyMember,
  ISODateString,
  TodoItem,
} from '@/types/models';

export type BriefingAudience =
  | { kind: 'assignee' }
  | { kind: 'forChild'; childNames: string[] }
  | { kind: 'unassigned' }
  | { kind: 'hidden' };

/** Check whether a duty has been completed for a given occurrence date. */
export function isDutyDone(completions: DutyCompletion[] | undefined, date: string): boolean {
  return completions?.some((c) => c.date === date) ?? false;
}

type Resolve = (id: string) => FamilyMember | undefined;

/** The ids that still resolve to a member (stale ids dropped). */
function resolveKnown(ids: readonly string[], resolveMember: Resolve): FamilyMember[] {
  return ids.map(resolveMember).filter((m): m is FamilyMember => m !== undefined);
}

/** No adult among `known`, at least one non-pet: the shape `classifyAudience` calls `forChild`. */
function childrenAmong(known: readonly FamilyMember[]): FamilyMember[] {
  return known.some(isAdultMember) ? [] : known.filter((m) => !m.isPet);
}

export function classifyAudience(
  assigneeIds: string[],
  viewer: FamilyMember,
  resolveMember: Resolve
): BriefingAudience {
  const known = resolveKnown(assigneeIds, resolveMember);
  if (known.some((m) => m.id === viewer.id)) return { kind: 'assignee' };
  if (known.some(isAdultMember)) return { kind: 'hidden' }; // a parent owns it → only assignees see it
  const kids = childrenAmong(known); // already non-adult — any adult would have returned above
  if (kids.length > 0) {
    return isAdultMember(viewer)
      ? { kind: 'forChild', childNames: kids.map((m) => m.name) }
      : { kind: 'hidden' }; // other children don't get this kid's item
  }
  return viewer.isPet ? { kind: 'hidden' } : { kind: 'unassigned' }; // none / all-stale / pet-only
}

/**
 * Who may change "Keep Parents Posted": a grown-up only. It is the parents' oversight setting,
 * so a child with edit rights must not be able to switch it off (code review, 2026-11-06).
 * The ONE rule for both stores' refusal and the toggles' visibility.
 */
export function canSetNotifyParents(viewer: FamilyMember | null | undefined): boolean {
  return !!viewer && isAdultMember(viewer);
}

/**
 * Does a toggle about parents apply to this item? The same "child-only" rule as
 * `classifyAudience`'s `forChild` branch, asked without a viewer (shared helpers, so the two
 * cannot drift; locked by an equivalence test).
 */
export function isChildOnly(ids: readonly string[], resolveMember: Resolve): boolean {
  return childrenAmong(resolveKnown(ids, resolveMember)).length > 0;
}

interface RoutineFacts {
  /** A repeating to-do or a recurring list. */
  routine: boolean;
  /** Already overdue by the caller's own predicate. */
  missed: boolean;
  /** The item's `notifyParents` flag (strictly `true`). */
  notifyParents: boolean;
}

/**
 * PRIVATE. Parents follow a child's ROUTINE only once it is missed, or when the item asks them to
 * (`notifyParents`). One-offs, the child's own view, siblings and unassigned items are untouched.
 * greg, 2026-11-06. Partially reverses #123's "adults see it too".
 */
function gateRoutine(audience: BriefingAudience, f: RoutineFacts): BriefingAudience {
  if (audience.kind !== 'forChild' || !f.routine || f.missed || f.notifyParents) return audience;
  return { kind: 'hidden' };
}

type RoutineTodo = Pick<TodoItem, 'repeat' | 'notifyParents'>;
type RoutineList = Pick<FamilyList, 'lifecycle' | 'notifyParents'>;

/** The routine gate over an audience the caller already classified (one resolve per to-do). */
export function gateTodoAudience(
  audience: BriefingAudience,
  todo: RoutineTodo,
  missed: boolean
): BriefingAudience {
  return gateRoutine(audience, {
    routine: isRepeating(todo),
    missed,
    notifyParents: todo.notifyParents === true,
  });
}

/** `classifyAudience` for a to-do, with the routine gate applied. */
export function classifyTodoAudience(
  todo: RoutineTodo & Pick<TodoItem, 'assigneeIds' | 'assigneeId'>,
  viewer: FamilyMember,
  resolveMember: Resolve,
  missed: boolean
): BriefingAudience {
  return gateTodoAudience(
    classifyAudience(normalizeAssignees(todo), viewer, resolveMember),
    todo,
    missed
  );
}

/**
 * Where a to-do sits on the clock's day and who sees it there: the ONE rule the daily briefing
 * and the widget's to-dos share. null when it is not showing yet (`waiting`) or is hidden from
 * this viewer. "Missed" (for the routine gate) is the plate being `overdue`, except on a
 * `projected` day (every widget day after today): a child's chore due today would otherwise
 * read as overdue on the days after it, and be shown to the parent there.
 */
export function classifyPlateTodo(
  todo: TodoItem,
  viewer: FamilyMember,
  resolveMember: Resolve,
  clock: PlateClock,
  projected = false
): { plate: ShownPlate; audience: BriefingAudience } | null {
  const plate = todoPlate(todo, clock);
  if (plate === 'waiting') return null;
  const audience = classifyTodoAudience(
    todo,
    viewer,
    resolveMember,
    !projected && plate === 'overdue'
  );
  return audience.kind === 'hidden' ? null : { plate, audience };
}

/**
 * `classifyAudience` over a Beanie List's assignees (`listAssignees`), with the routine gate
 * applied. List surfaces then gate on `ownerItemSurfaces`, not on "not hidden": a list whose
 * people no longer resolve must not land on every device as `unassigned`.
 */
export function classifyListAudience(
  list: RoutineList & Pick<FamilyList, 'ownerId' | 'assigneeIds'>,
  viewer: FamilyMember,
  resolveMember: Resolve,
  missed: boolean
): BriefingAudience {
  return gateRoutine(classifyAudience(listAssignees(list), viewer, resolveMember), {
    routine: isRecurring(list),
    missed,
    notifyParents: list.notifyParents === true,
  });
}

/**
 * `classifyAudience` for ONE bean's share of a chore (#146), with the routine gate applied (a
 * chore always repeats). Classified PER BEAN, `classifyAudience([beanId], ...)`, never over the
 * chore's whole `assigneeIds`: for a chore shared by a parent and a child the whole set is not
 * child-only, so the parent would see the child's share as `hidden`, and the child would see
 * the parent's as their own. Per bean: the bean always sees their own; a grown-up sees a
 * child's only when the chore keeps parents posted or `missed` (its block `ended` with it
 * undone); siblings and other grown-ups never.
 */
export function classifyChoreAudience(
  chore: Pick<Chore, 'notifyParents'>,
  beanId: string,
  viewer: FamilyMember,
  resolveMember: Resolve,
  missed: boolean
): BriefingAudience {
  return gateRoutine(classifyAudience([beanId], viewer, resolveMember), {
    routine: true,
    missed,
    notifyParents: chore.notifyParents === true,
  });
}

/** One bean's chore line, as a viewer may see it: the briefing's line and the widget's row. */
export interface ChoreLine {
  beanId: string;
  /** The block the line is about (see `choreLineFor`). */
  block: ChoreBlock;
  /** Counted over the chores in `block` that pass the gate for this viewer, never the rest. */
  left: number;
  total: number;
  done: number;
  /** `block` has ended with chores left: the line is about missed chores. */
  missed: boolean;
  /** The viewer is the bean ("You have ..."). */
  own: boolean;
}

/**
 * The ONE line a viewer may see for a bean's chore day (#146), shared by the daily briefing
 * and the widget so the two cannot drift. Each chore passes or fails `classifyChoreAudience`
 * (`ownerItemSurfaces`, so an unresolvable bean is nobody's line), with `missed` = its block
 * ended and it is undone. Only blocks that have started count (ended, now, or Anytime); a later
 * block is not yet anyone's business. The block, in order of preference:
 *   1. the earliest ended block with chores left (missed);
 *   2. the current block, with chores left;
 *   3. Anytime, with chores left;
 *   4. nothing left: the current block, else the latest started block with chores (a "Done"
 *      line, `left` 0).
 * null when no chore passes in any started block, so a bean with nothing today, or whose
 * chores this viewer may not follow, has no line. A fully done bean returns its "Done" line:
 * the widget shows it as "Done", the briefing shows no line for it (`left` 0).
 *
 * This is the first of `choreLinesFor`, the candidates in that order. The briefing walks the
 * candidates itself so a line the viewer hid for the day gives way to the next one.
 */
export function choreLineFor(
  day: BeanChoreDay,
  beanId: string,
  viewer: FamilyMember,
  resolveMember: Resolve
): ChoreLine | null {
  return choreLinesFor(day, beanId, viewer, resolveMember)[0] ?? null;
}

/**
 * Every line a viewer may see for a bean's chore day, best first (the order `choreLineFor`
 * documents): each ended block with chores left, then the current block and Anytime with chores
 * left, then the single "Done" fallback only when nothing is left anywhere. One entry per block.
 * A surface that can hide a line (the briefing's day dismissal) takes the first one it has not
 * hidden, so hiding the missed Morning line lets the Afternoon line through instead of blanking
 * the bean for the day.
 */
export function choreLinesFor(
  day: BeanChoreDay,
  beanId: string,
  viewer: FamilyMember,
  resolveMember: Resolve
): ChoreLine[] {
  const started = day.blocks
    .filter((b) => b.ended || b.isNow || b.block === 'anytime')
    .map((b) => {
      const shown = b.chores.filter((i) =>
        ownerItemSurfaces(
          classifyChoreAudience(i.chore, beanId, viewer, resolveMember, b.ended && !i.done)
        )
      );
      const done = shown.filter((i) => i.done).length;
      return { b, total: shown.length, done, left: shown.length - done };
    });
  // Anytime is never `ended` nor `isNow` (`choreDayFor`), so each block lands here at most once.
  const picks = [
    ...started.filter((s) => s.b.ended && s.left > 0),
    ...started.filter((s) => s.b.isNow && s.left > 0),
    ...started.filter((s) => s.b.block === 'anytime' && s.left > 0),
  ];
  if (picks.length === 0) {
    const done =
      started.find((s) => s.b.isNow && s.total > 0) ??
      [...started].reverse().find((s) => s.total > 0);
    if (done) picks.push(done);
  }
  return picks.map((pick) => ({
    beanId,
    block: pick.b.block,
    left: pick.left,
    total: pick.total,
    done: pick.done,
    missed: pick.b.ended && pick.left > 0,
    own: viewer.id === beanId,
  }));
}

/**
 * Where a list sits on the clock's day, who sees it there and how many items it counts: the
 * list twin of `classifyPlateTodo`, the ONE rule the briefing and the widget's lists share.
 * null for a filed list, one not showing yet (`waiting`, or a repeating list with no reset day),
 * one that fails `ownerItemSurfaces` for this viewer, or one with nothing left. "Missed" (for
 * the routine gate) is the plate being `overdue`; no `projected` flag is needed, because a
 * repeating list is never overdue and the gate applies to repeating lists only. `due` is the
 * subject's due day (a repeating list: its reset day), absent for an undated list.
 */
export function classifyPlateList(
  list: FamilyList,
  viewer: FamilyMember,
  resolveMember: Resolve,
  clock: PlateClock
): {
  plate: ShownPlate;
  audience: BriefingAudience;
  remaining: number;
  due?: ISODateString;
} | null {
  if (isFiled(list)) return null;
  const subject = listSubject(list, clock.ymd);
  if (!subject) return null;
  const plate = plateOf(subject, clock);
  if (plate === 'waiting') return null;
  const audience = classifyListAudience(list, viewer, resolveMember, plate === 'overdue');
  if (!ownerItemSurfaces(audience)) return null;
  const remaining = listRemaining(list, subject);
  if (remaining === 0) return null;
  return isYmd(subject.dueDate)
    ? { plate, audience, remaining, due: subject.dueDate }
    : { plate, audience, remaining };
}

/**
 * Should an owned item (a list, a cook) surface to this viewer at all?
 *
 * `assignee` (mine) or `forChild` (an adult seeing a child's) — the same two the
 * to-do surfaces show. Deliberately EXCLUDES `unassigned`, which for a
 * single-owner item is not a meaningful state but a data defect: an empty or
 * unresolvable `ownerId`. `classifyOwnerAudience` cannot tell those apart from
 * "nobody is assigned", so gating on `!== 'hidden'` (the shape the to-do builders
 * use, where unassigned genuinely means a shared family task) would put a list
 * owned by nobody on every device in the house. `listStore.createList` now refuses
 * to create one, but existing data can still carry it.
 *
 * Shared by the in-app deriver and the OS reminder builder so they cannot drift —
 * a review caught them disagreeing about exactly this.
 */
export function ownerItemSurfaces(audience: BriefingAudience): boolean {
  return audience.kind === 'assignee' || audience.kind === 'forChild';
}

/**
 * Single-owner sibling of `classifyAudience` for Beanie Lists (#33), which have
 * one `ownerId` rather than an `assigneeIds` array. Returns the SAME
 * `BriefingAudience` union so the briefing's message-key selection works
 * unchanged. Same rule, single-owner shape:
 *   • You own it                         → 'assignee'.
 *   • An adult owns it                   → 'hidden' (only they see it).
 *   • A child owns it                    → adults see it framed by the child
 *     ('forChild'); siblings don't ('hidden').
 *   • Unowned / pet-owned                → everyone non-pet sees it ('unassigned').
 * Pets never get a briefing.
 */
export function classifyOwnerAudience(
  ownerId: string | null | undefined,
  viewer: FamilyMember,
  resolveMember: Resolve
): BriefingAudience {
  // A single owner is just an assignee list of length 0 or 1 — delegate to the
  // one classifier so the rule can't diverge (this file's own header forbids
  // duplicating it). An unresolved/empty owner → empty array → unassigned/hidden.
  return classifyAudience(ownerId ? [ownerId] : [], viewer, resolveMember);
}
