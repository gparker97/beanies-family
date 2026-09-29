// Magic beans to-dos (#113): the model's to-do read → editable review drafts.
//
// Pure and store-free. Everything the drafts depend on that lives in a store (the roster, the
// Who Owns What holder of a card, the person who shared) is INJECTED, so the rules below are
// unit-tested without Pinia and the review drawer stays a thin view over them.
//
// Three rules live here and nowhere else:
//   - who does it (`resolveTodoAssignee`): a named member, else the single holder of the owner
//     card, else whoever shared it (first match wins);
//   - when it is due (`resolveTodoDue`): a stated date, else a date derived from the activity it
//     came with (never before today), with a stated time kept unless that date was worked out
//     for today and the time has passed; and
//   - which rows are already on the family's list (`markDuplicateDrafts`): a narrow candidate
//     set (linked to the probable activity, or open on the same day), then a title match with
//     filler words ignored (`todoTitleSimilarity`).

import { addDaysYmd, isRealYmd } from '@/utils/date';
import { isHint } from '@/utils/helpfulHints';
import { generateUUID } from '@/utils/id';
import { matchTravellerIds } from '@/utils/segmentTravellers';
import { tokenSimilarity } from '@/utils/textSimilarity';
import type { FamilyMember, TodoItem } from '@/types/models';
import type { TodoExtractionResult, TodoItemExtraction } from '@/services/ai/types';
import type { ResultEnvelope, ShareKind } from '@/types/magicPayload';

/** Why a draft's assignee was picked. `null` = nobody could be picked (left unassigned). */
export type TodoAssigneeReason = 'named' | 'owner' | 'submitter';

/** How a draft's due date was derived from the activity, when it was not stated. */
export type TodoDueDerivation = 'event_day' | 'day_before';

/**
 * Why a stated time was not kept: there was no date to sit on, or beanies worked the date out
 * (it was not stated), that date is today, and the time has already gone by. Telemetry only.
 */
export type TodoTimeDropReason = 'no_date' | 'past_today';

/**
 * The `todoTitleSimilarity` bar for "this to-do is already on the list". Higher than the shared
 * `TITLE_MATCH_THRESHOLD` (0.6) the activity duplicate check keeps, because to-do titles are
 * short verb phrases. Scored with filler words removed:
 *   - a reworded re-read that only adds or drops fillers scores 1 ("Return form" / "Return the
 *     form", "Pack sunscreen, a hat and a packed lunch" / "Pack sunscreen, hat, and packed
 *     lunch");
 *   - one extra content word on a four-word title scores 0.75, still a match ("Return the
 *     signed permission slip" / "Return permission slip", "Pay the $12 trip fee" / "Pay the
 *     trip fee");
 *   - two DIFFERENT to-dos one content word apart score 0.5 and stay out ("Pay the soccer fee"
 *     / "Pay the swim fee", "Return the library book" / "Return the library card").
 */
export const TODO_MATCH_THRESHOLD = 0.75;

/**
 * Words that carry no meaning in a to-do title, so a re-read that adds or drops them still
 * matches. Standalone words only ("another" and "pay" are untouched), case-insensitive.
 */
const TITLE_FILLER =
  /(?<![\p{L}\p{N}])(?:the|a|an|and|to|of|for|on|at|by|with|your|my|our|please)(?![\p{L}\p{N}])/giu;

/** `title` with its filler words blanked out. */
function withoutFillers(title: string): string {
  return title.replace(TITLE_FILLER, ' ');
}

/** True when `text` still has a letter or digit left to compare. */
function hasWords(text: string): boolean {
  return /[\p{L}\p{N}]/u.test(text);
}

/**
 * How alike two to-do titles are, in [0, 1]: the shared `tokenSimilarity` over the titles with
 * filler words removed (`TITLE_FILLER`). When either title is nothing BUT fillers, both are
 * compared as written instead, so such a title can still match itself.
 */
export function todoTitleSimilarity(a: string, b: string): number {
  const sa = withoutFillers(a);
  const sb = withoutFillers(b);
  if (!hasWords(sa) || !hasWords(sb)) return tokenSimilarity(a, b);
  return tokenSimilarity(sa, sb);
}

/** One editable row of the review drawer. */
export interface TodoDraft {
  /** The to-do id, minted here. Also the row key, and why a retried save cannot duplicate. */
  id: string;
  title: string;
  /** Details, then each link on its own line (where the to-do view surfaces URLs). */
  description: string;
  dueDate?: string;
  /** Set only when `dueDate` was derived from the activity's date (not stated, not clamped). */
  dueDerived?: TodoDueDerivation;
  /** `HH:mm`, only ever alongside a `dueDate` (reminders and overdue assume both). */
  dueTime?: string;
  /**
   * Duplicate matching ONLY: the date the source actually pointed at (the stated date, or the
   * derived date before it was clamped to today). Matching checks this AND `dueDate`, so a
   * clamped re-read finds copies saved on the original day as well as copies saved on the
   * clamped day. Never saved.
   */
  matchDate?: string;
  /** Telemetry only: why the read's stated time is not on the draft. Never saved. */
  timeDropped?: TodoTimeDropReason;
  assigneeIds: string[];
  reason: TodoAssigneeReason | null;
  /** The Who Owns What card the assignee holds, when `reason` is `'owner'`. */
  ownerCardId?: string;
  links: string[];
  skipped: boolean;
  /**
   * The existing to-do this row most likely repeats (`markDuplicateDrafts`). Such a row starts
   * skipped; it stays set after "Add anyway" so the save can count the rows kept regardless.
   */
  duplicateOf?: { id: string; done: boolean };
}

/** What the review drawer is opened with: a to-do read, plus its activity when shared. */
export interface TodoReviewReady {
  result: TodoExtractionResult;
  /** The activity the to-dos came with (shared result only). Read-only in the drawer. */
  eventSummary?: {
    title: string;
    /** The activity's emoji (its category's), shown in the summary card. */
    icon?: string;
    date?: string;
    startTime?: string;
    endTime?: string;
    location?: string;
    link?: string;
  };
  env: ResultEnvelope;
  /** The kind the read resolved to, for the "not right?" correction. */
  primaryKind: ShareKind;
  /**
   * The existing activity this read most likely repeats (shared result only). A hint for
   * duplicate to-do matching; the activity confirm step still runs its own check.
   */
  probableActivityId?: string;
}

export interface TodoAssigneeContext {
  /** Humans only (`familyStore.sortedHumans`); names are matched here, never sent to the model. */
  roster: readonly FamilyMember[];
  /** The single holder of a Who Owns What card, or undefined (unheld, split, unknown). */
  holderFor: (cardId: string) => string | undefined;
  /** Who shared it (`currentMember ?? owner`), or null when there is nobody. */
  submitterId: string | null | undefined;
}

export interface TodoAssignee {
  assigneeIds: string[];
  reason: TodoAssigneeReason | null;
  ownerCardId?: string;
}

/**
 * Who does this to-do. First match wins:
 *   (a) the member the source names (`matchTravellerIds`: case, first name, aliases, and it
 *       DROPS an ambiguous name rather than guess),
 *   (b) the single holder of the owner card (a split or unheld card has no single holder),
 *   (c) whoever shared it,
 *   else nobody.
 */
export function resolveTodoAssignee(
  item: Pick<TodoItemExtraction, 'assigneeName' | 'ownerCard'>,
  ctx: TodoAssigneeContext
): TodoAssignee {
  if (item.assigneeName) {
    const named = matchTravellerIds([item.assigneeName], [...ctx.roster])[0];
    if (named) return { assigneeIds: [named], reason: 'named' };
  }
  if (item.ownerCard) {
    const holder = ctx.holderFor(item.ownerCard);
    if (holder) return { assigneeIds: [holder], reason: 'owner', ownerCardId: item.ownerCard };
  }
  if (ctx.submitterId) return { assigneeIds: [ctx.submitterId], reason: 'submitter' };
  return { assigneeIds: [], reason: null };
}

export interface TodoDue {
  dueDate?: string;
  dueDerived?: TodoDueDerivation;
  dueTime?: string;
  /** The stated date, or the derived date before clamping (see `TodoDraft.matchDate`). */
  matchDate?: string;
  timeDropped?: TodoTimeDropReason;
}

export interface TodoDueContext {
  /** The activity's date (shared result only). */
  eventDate?: string;
  /** `localToday()`, injected so the clamp is testable. */
  today: string;
  /** The current local `HH:mm` (`toTimeInputValue(new Date())`), injected likewise. */
  nowTime: string;
}

/**
 * When this to-do is due.
 *
 * A real stated date always wins, as stated (even a past one: the source said so). Otherwise a
 * date is derived ONLY beside an activity with a real date: `on_event_day` is that day, and
 * `before_event` or no timing at all is the day before (greg's decision: prep lands the day
 * before). A derived date is clamped to `today` so nothing arrives already overdue, and a
 * clamped date loses its derivation label, since "day before" would no longer be true. With no
 * activity date (a to-do-only read, or an undated event) an undated item stays undated.
 *
 * A stated time is kept whenever there is a date, with one exception: a DERIVED date (clamped
 * or not) that is today, with the time at or before now. beanies chose that date, so the time
 * would make it arrive already overdue with no reminder (`isTodoOverdue`,
 * `useScheduledReminders`); it is dropped (`'past_today'`). A stated date keeps its time as
 * written, even one already past (truthfully overdue: the source said so). With no date the
 * time has nothing to sit on (`'no_date'`).
 *
 * `matchDate` is the stated date, or the derived date BEFORE the clamp. Duplicate matching
 * checks it alongside `dueDate` (see `TodoDraft.matchDate`).
 */
export function resolveTodoDue(
  item: Pick<TodoItemExtraction, 'dueDate' | 'timing'> &
    Partial<Pick<TodoItemExtraction, 'dueTime'>>,
  ctx: TodoDueContext
): TodoDue {
  const stated = item.dueTime || undefined;
  const kept = stated ? { dueTime: stated } : {};
  const dropped = (reason: TodoTimeDropReason) => (stated ? { timeDropped: reason } : {});
  if (item.dueDate && isRealYmd(item.dueDate)) {
    return { dueDate: item.dueDate, matchDate: item.dueDate, ...kept };
  }
  if (!ctx.eventDate || !isRealYmd(ctx.eventDate)) return dropped('no_date');

  const onEventDay = item.timing === 'on_event_day';
  const matchDate = onEventDay ? ctx.eventDate : addDaysYmd(ctx.eventDate, -1);
  // A clamped date loses its label: "day before" would no longer be true.
  const derived: TodoDue =
    matchDate < ctx.today
      ? { dueDate: ctx.today, matchDate }
      : { dueDate: matchDate, dueDerived: onEventDay ? 'event_day' : 'day_before', matchDate };
  if (stated && derived.dueDate === ctx.today && stated <= ctx.nowTime) {
    return { ...derived, ...dropped('past_today') };
  }
  return { ...derived, ...kept };
}

/** Details first, then each link not already in them on its own line. Deduped, trimmed. */
export function todoDescription(details: string | null, links: readonly string[]): string {
  const text = details?.trim() ?? '';
  const extra = [...new Set(links.map((l) => l.trim()).filter(Boolean))].filter(
    (l) => !text.includes(l)
  );
  return [text, ...extra].filter(Boolean).join('\n');
}

export interface BuildTodoDraftsContext extends TodoAssigneeContext, TodoDueContext {}

/** One draft per extracted item, in the model's order, each with a freshly minted id. */
export function buildTodoDrafts(
  result: TodoExtractionResult,
  ctx: BuildTodoDraftsContext
): TodoDraft[] {
  return result.items.map((item) => {
    const links = [...new Set(item.links)];
    return {
      id: generateUUID(),
      title: item.title.trim(),
      description: todoDescription(item.details, links),
      ...resolveTodoDue(item, ctx),
      ...resolveTodoAssignee(item, ctx),
      links,
      skipped: false,
    };
  });
}

/** The day part of a to-do or draft date (`todoStore`'s rule), with undated as `''`. */
function dayOf(date: string | undefined): string {
  return date?.slice(0, 10) ?? '';
}

/**
 * The to-dos that can be a candidate for ANY draft (never a hint; linked to the probable
 * activity, or open), filtered once so the per-draft pass only checks the day.
 */
function candidatePool(existing: readonly TodoItem[], probableActivityId?: string): TodoItem[] {
  return existing.filter(
    (t) =>
      !isHint(t) && ((!!probableActivityId && t.activityId === probableActivityId) || !t.completed)
  );
}

/**
 * The existing to-dos a draft could be repeating, from a pool already narrowed by
 * `candidatePool`. Kept deliberately narrow, since that is what makes a fuzzy title match safe
 * (a fuzzy match across every open to-do would catch unrelated "Pay the fee" items). Either:
 *   (a) linked to the probable existing activity (open or done), or
 *   (b) open and due on the draft's `dueDate` OR its `matchDate` (the unclamped date), with
 *       both undated counting as the same day.
 * (b) applies with a probable activity too, so an unlinked copy (an earlier read whose
 * activity form was closed unsaved, or an activity made by hand) is still caught.
 */
function candidatesIn(
  draft: Pick<TodoDraft, 'dueDate' | 'matchDate'>,
  pool: readonly TodoItem[],
  probableActivityId?: string
): TodoItem[] {
  const days = new Set([dayOf(draft.dueDate), dayOf(draft.matchDate ?? draft.dueDate)]);
  return pool.filter(
    (t) =>
      (!!probableActivityId && t.activityId === probableActivityId) ||
      (!t.completed && days.has(dayOf(t.dueDate)))
  );
}

/**
 * Flag the drafts that repeat a to-do the family already has: each such draft gets
 * `duplicateOf` and starts skipped (visible, one tap to add anyway; never dropped). A draft
 * matches its best-scoring candidate (`candidatesIn`, scored by `todoTitleSimilarity`) at or
 * above `threshold`, and each existing to-do is
 * claimed by at most one draft. Returns new draft objects; the input is not mutated.
 */
export function markDuplicateDrafts(
  drafts: readonly TodoDraft[],
  existing: readonly TodoItem[],
  opts: { probableActivityId?: string; threshold?: number } = {}
): TodoDraft[] {
  const threshold = opts.threshold ?? TODO_MATCH_THRESHOLD;
  const pool = candidatePool(existing, opts.probableActivityId);
  const pairs: { di: number; ci: number; score: number; todo: TodoItem }[] = [];
  drafts.forEach((draft, di) => {
    candidatesIn(draft, pool, opts.probableActivityId).forEach((todo, ci) => {
      const score = todoTitleSimilarity(draft.title, todo.title);
      if (score >= threshold) pairs.push({ di, ci, score, todo });
    });
  });

  // Greedy global claim by descending score, the same pattern as `statement/match.ts`: the
  // best pair wins, and a pair is skipped once either side is taken.
  pairs.sort((a, b) => b.score - a.score || a.di - b.di || a.ci - b.ci);
  const matchFor = new Map<number, TodoItem>();
  const claimed = new Set<string>();
  for (const p of pairs) {
    if (matchFor.has(p.di) || claimed.has(p.todo.id)) continue;
    matchFor.set(p.di, p.todo);
    claimed.add(p.todo.id);
  }

  return drafts.map((draft, di) => {
    const match = matchFor.get(di);
    if (!match) return draft;
    return { ...draft, duplicateOf: { id: match.id, done: match.completed }, skipped: true };
  });
}
