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
 *   `classifyListAudience`; the gate itself stays private so no caller can hand-roll
 *   "is this a routine" (the two encodings are `isRepeating` and `isRecurring`).
 *   `isChildOnly` asks the same "child-only" question viewer-free, for the toggle UI.
 */
import { isAdultMember } from '@/composables/useMemberInfo';
import { listAssignees, normalizeAssignees } from '@/utils/assignees';
import { isFiled, isRecurring, listRemaining, listSubject } from '@/utils/listLifecycle';
import { isRepeating } from '@/utils/todoRecurrence';
import { isYmd, plateOf, todoPlate, type PlateClock, type ShownPlate } from '@/utils/todoPlate';
import type {
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
