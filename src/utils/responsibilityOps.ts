/**
 * Who Owns What (#109) — pure operation builders: the write side of the deck.
 *
 * Each mutating store action is a thin call to ONE builder here:
 *   (resolved card(s), input, actorId, nowIso) → { ops, undo?, telemetry }
 * and `responsibilityRepository.applyDeckOps(ops)` writes the ops as one Automerge change,
 * computing nothing. So every decision about WHAT gets written (and deleted) is here,
 * unit-tested without a document, and the store stays orchestration only.
 *
 * Rules that live here and nowhere else:
 *   - Part keys: `'main'` (single), the child's member id (child split), a generated
 *     `label-<uuid>` (label split, so a rename keeps the part's history).
 *   - Move ids: `moveId(cardId, partKey, at)`.
 *   - Card state is always written WHOLE (`setState`), never patched.
 *   - A builder that would change nothing returns `ops: []`; the store then skips the write.
 *   - The check-in cycle starts with a stored `'start'` record, appended by `withCycleStart`
 *     to the write that first puts something in an empty deck. The due date is derived
 *     from records only (`nextCheckInDate`), never from cards or moves.
 */
import { generateUUID } from '@/utils/id';
import {
  CUSTOM_CARD_PREFIX,
  MAIN_PART_KEY,
  childMembers,
  countsTowardCycle,
  isUndealtDeck,
  isValidCardState,
  type ResolvedCard,
  type ResolvedPart,
} from '@/utils/responsibilityDeck';
import type {
  CardPart,
  CardSplitMode,
  FamilyMember,
  ListCategory,
  ResponsibilityCardState,
  ResponsibilityCheckIn,
  ResponsibilityMove,
} from '@/types/models';

export type DeckOp =
  | { op: 'setState'; state: ResponsibilityCardState }
  | { op: 'deleteState'; id: string }
  | { op: 'setMove'; move: ResponsibilityMove }
  | { op: 'deleteMove'; id: string }
  | { op: 'setCheckIn'; checkIn: ResponsibilityCheckIn }
  | { op: 'deleteCheckIn'; id: string };

export type UndoableAction = 'deal' | 'keep' | 'skip' | 'bringBack';

/**
 * In-memory (per session) undo for the toast actions. `undo` restores exactly `before`
 * (`null` = the card had no record: delete it) and deletes `createdMoveIds`, in one batch,
 * but only when every card's live `updatedAt` still equals `afterUpdatedAt` (otherwise
 * another device changed it and the whole undo is refused). `createdCheckInIds` is the
 * cycle-start record the action wrote (`withCycleStart`), if any; the undo deletes it
 * only when the deck is empty again afterwards.
 */
export interface UndoToken {
  action: UndoableAction;
  before: Record<string, ResponsibilityCardState | null>;
  afterUpdatedAt: Record<string, string>;
  createdMoveIds: string[];
  createdCheckInIds: string[];
}

/** One success event for the store to log (allowlisted context keys only). */
export interface DeckTelemetry {
  message: string;
  context: { detail?: string; kind?: string; count?: number };
}

export interface BuildResult {
  ops: DeckOp[];
  undo?: UndoToken;
  telemetry: DeckTelemetry[];
}

export function moveId(cardId: string, partKey: string, at: string): string {
  return `${cardId}:${partKey}:${at}`;
}

/** A new label part's key. Never the label text, so renaming keeps the history. */
export function newLabelPartKey(): string {
  return `label-${generateUUID()}`;
}

export function newCustomCardId(): string {
  return `${CUSTOM_CARD_PREFIX}${generateUUID()}`;
}

/**
 * A new check-in's id: the local day it was finished plus a random suffix, so two check-ins
 * on the same day (two grown-ups on two phones) are two records, never one overwriting the
 * other. Nothing parses it: the day is read from `completedAt` (`checkInYmd`).
 */
export function newCheckInId(todayYmd: string): string {
  return `${todayYmd}-${generateUUID().slice(0, 8)}`;
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function storedParts(parts: readonly ResolvedPart[]): CardPart[] {
  return parts.map((p) => {
    const out: CardPart = { key: p.key };
    if (p.label !== undefined) out.label = p.label;
    if (p.holderId) out.holderId = p.holderId;
    return out;
  });
}

/** The card's record as it would be written now: its stored record, or a fresh kept one. */
function baseState(card: ResolvedCard, actorId: string, nowIso: string): ResponsibilityCardState {
  const s: ResponsibilityCardState = card.state
    ? clone(card.state)
    : {
        id: card.id,
        status: 'kept',
        splitMode: 'single',
        parts: [],
        createdBy: actorId,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
  // Write the RESOLVED parts: removed holders and removed children's parts are dropped,
  // and a child split is keyed by the current children.
  s.splitMode = card.splitMode;
  s.parts = storedParts(card.parts);
  s.updatedAt = nowIso;
  return s;
}

function makeMove(
  card: ResolvedCard,
  part: { key: string; label?: string },
  fromId: string | undefined,
  toId: string | undefined,
  actorId: string,
  at: string
): ResponsibilityMove {
  const m: ResponsibilityMove = {
    id: moveId(card.id, part.key, at),
    cardId: card.id,
    partKey: part.key,
    at,
    byId: actorId,
  };
  if (part.label) m.partLabel = part.label;
  if (fromId) m.fromId = fromId;
  if (toId) m.toId = toId;
  return m;
}

function tokenFor(
  action: UndoableAction,
  cards: readonly ResolvedCard[],
  nowIso: string,
  createdMoveIds: string[]
): UndoToken {
  const before: UndoToken['before'] = {};
  const afterUpdatedAt: UndoToken['afterUpdatedAt'] = {};
  for (const c of cards) {
    before[c.id] = c.state ? clone(c.state) : null;
    afterUpdatedAt[c.id] = nowIso;
  }
  return { action, before, afterUpdatedAt, createdMoveIds, createdCheckInIds: [] };
}

const NOOP: BuildResult = { ops: [], telemetry: [] };

/**
 * Deal one part to a member (or clear it to nobody with `null`). An unsorted or skipped
 * card becomes kept in the SAME op list, so the pile's Keep → pick is one write and one
 * undo. A change of holder records one move.
 */
export function buildDeal(
  card: ResolvedCard,
  partKey: string,
  memberId: string | null,
  actorId: string,
  nowIso: string
): BuildResult {
  const part = card.parts.find((p) => p.key === partKey);
  if (!part) throw new Error(`buildDeal: card has no part "${partKey}"`);
  const from = part.holderId;
  const to = memberId ?? undefined;
  const wasKept = card.state?.status === 'kept';
  if (from === to && wasKept) return NOOP;

  const state = baseState(card, actorId, nowIso);
  state.status = 'kept';
  const target = state.parts.find((p) => p.key === partKey)!;
  if (to) target.holderId = to;
  else delete target.holderId;

  const ops: DeckOp[] = [{ op: 'setState', state }];
  const createdMoveIds: string[] = [];
  if (from !== to) {
    const move = makeMove(card, part, from, to, actorId, nowIso);
    ops.push({ op: 'setMove', move });
    createdMoveIds.push(move.id);
  }
  const detail = !to ? 'clear' : from ? 'redeal' : 'first';
  return {
    ops,
    undo: tokenFor('deal', [card], nowIso, createdMoveIds),
    telemetry: [{ message: 'card_dealt', context: { kind: card.category, detail } }],
  };
}

/** "Decide later": keep the card in the deck with nobody. */
export function buildKeep(card: ResolvedCard, actorId: string, nowIso: string): BuildResult {
  if (card.state?.status === 'kept') return NOOP;
  const state = baseState(card, actorId, nowIso);
  state.status = 'kept';
  return {
    ops: [{ op: 'setState', state }],
    undo: tokenFor('keep', [card], nowIso, []),
    telemetry: [{ message: 'card_kept', context: { kind: card.category } }],
  };
}

/** Skip one card or a whole group. Holders are kept on the record, so Bring back restores them. */
export function buildSkip(
  cards: readonly ResolvedCard[],
  actorId: string,
  nowIso: string
): BuildResult {
  const targets = cards.filter((c) => c.status !== 'skipped');
  if (!targets.length) return NOOP;
  const ops: DeckOp[] = targets.map((c) => {
    const state = baseState(c, actorId, nowIso);
    state.status = 'skipped';
    return { op: 'setState', state };
  });
  return {
    ops,
    undo: tokenFor('skip', targets, nowIso, []),
    telemetry: [
      {
        message: 'card_skipped',
        context: { count: targets.length, detail: targets.length > 1 ? 'group' : 'single' },
      },
    ],
  };
}

export function buildBringBack(card: ResolvedCard, actorId: string, nowIso: string): BuildResult {
  if (card.status !== 'skipped') return NOOP;
  const state = baseState(card, actorId, nowIso);
  state.status = 'kept';
  return {
    ops: [{ op: 'setState', state }],
    undo: tokenFor('bringBack', [card], nowIso, []),
    telemetry: [{ message: 'bring_back', context: { kind: card.category } }],
  };
}

/** What the edit drawer hands back: the whole edited card, saved in ONE batch. */
export interface CardDraft {
  splitMode: CardSplitMode;
  /** Keyed per `draftPartsForMode`. */
  parts: CardPart[];
  /** Blank = restore the card's default done line. */
  doneOverride?: string;
  skipped: boolean;
  /** Custom cards only; ignored for built-ins (they keep their name, emoji and category). */
  custom?: { name: string; emoji: string; category: ListCategory };
}

/**
 * The parts a draft starts with when the editor switches split mode. Single keeps the
 * first part's holder; child makes one part per current child (keeping any holder that
 * child's part already had); label keeps existing label parts, else starts one empty
 * label part carrying the first part's holder.
 */
export function draftPartsForMode(
  current: readonly CardPart[],
  currentMode: CardSplitMode,
  mode: CardSplitMode,
  members: readonly FamilyMember[]
): CardPart[] {
  const first = current[0]?.holderId;
  const withHolder = (p: CardPart, holderId: string | undefined): CardPart =>
    holderId ? { ...p, holderId } : p;
  if (mode === 'single') return [withHolder({ key: MAIN_PART_KEY }, first)];
  if (mode === 'child') {
    return childMembers(members).map((c) =>
      withHolder(
        { key: c.id },
        currentMode === 'child' ? current.find((p) => p.key === c.id)?.holderId : undefined
      )
    );
  }
  if (currentMode === 'label' && current.length) return current.map((p) => ({ ...p }));
  return [withHolder({ key: newLabelPartKey(), label: '' }, first)];
}

function sameParts(a: readonly CardPart[], b: readonly CardPart[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (p, i) =>
        p.key === b[i]!.key &&
        (p.label ?? '') === (b[i]!.label ?? '') &&
        (p.holderId ?? '') === (b[i]!.holderId ?? '')
    )
  );
}

/** Throws on a draft the editor should never produce (a programming error, reported). */
function validateDraft(card: ResolvedCard, draft: CardDraft): void {
  if (!draft.parts.length) throw new Error('buildSaveCard: a card needs at least one part');
  const keys = new Set(draft.parts.map((p) => p.key));
  if (keys.size !== draft.parts.length) throw new Error('buildSaveCard: duplicate part keys');
  if (draft.splitMode === 'single' && draft.parts.length !== 1)
    throw new Error('buildSaveCard: a single card has exactly one part');
  if (draft.splitMode === 'label' && draft.parts.some((p) => !p.label?.trim()))
    throw new Error('buildSaveCard: every label part needs a label');
  if (card.isCustom && draft.custom && !draft.custom.name.trim())
    throw new Error('buildSaveCard: a custom card needs a name');
}

/**
 * Diff the edit drawer's draft into one op list: the whole new state plus one move per
 * part whose holder changed (a part new to the card counts as from nobody; a part that
 * disappears records nothing). Unchanged draft → no ops.
 */
export function buildSaveCard(
  card: ResolvedCard,
  draft: CardDraft,
  actorId: string,
  nowIso: string
): BuildResult {
  validateDraft(card, draft);
  const parts: CardPart[] = draft.parts.map((p) => {
    const out: CardPart = { key: draft.splitMode === 'single' ? MAIN_PART_KEY : p.key };
    if (draft.splitMode === 'label') out.label = p.label!.trim();
    if (p.holderId) out.holderId = p.holderId;
    return out;
  });
  const doneOverride = draft.doneOverride?.trim() || undefined;
  const status = draft.skipped ? 'skipped' : 'kept';
  const custom =
    card.isCustom && card.custom
      ? draft.custom
        ? { ...draft.custom, name: draft.custom.name.trim() }
        : card.custom
      : undefined;

  const unchanged =
    card.state !== null &&
    card.state.status === status &&
    card.splitMode === draft.splitMode &&
    sameParts(storedParts(card.parts), parts) &&
    (card.doneOverride?.trim() || undefined) === doneOverride &&
    JSON.stringify(card.custom ?? null) === JSON.stringify(custom ?? null);
  if (unchanged) return NOOP;

  const state = baseState(card, actorId, nowIso);
  state.status = status;
  state.splitMode = draft.splitMode;
  state.parts = parts;
  if (doneOverride) state.doneOverride = doneOverride;
  else delete state.doneOverride;
  if (custom) state.custom = custom;

  const ops: DeckOp[] = [{ op: 'setState', state }];
  let moved = 0;
  for (const p of parts) {
    const prev = card.parts.find((q) => q.key === p.key)?.holderId;
    if (prev === p.holderId) continue;
    ops.push({ op: 'setMove', move: makeMove(card, p, prev, p.holderId, actorId, nowIso) });
    moved += 1;
  }

  const telemetry: DeckTelemetry[] = [
    { message: 'card_saved', context: { kind: card.category, count: moved } },
  ];
  if (card.splitMode !== draft.splitMode)
    telemetry.push({ message: 'split_set', context: { detail: draft.splitMode } });
  if (card.status !== 'skipped' && status === 'skipped')
    telemetry.push({ message: 'card_skipped', context: { count: 1, detail: 'single' } });
  if (card.status === 'skipped' && status === 'kept')
    telemetry.push({ message: 'bring_back', context: { kind: card.category } });
  return { ops, telemetry };
}

export interface CustomCardInput {
  name: string;
  emoji: string;
  category: ListCategory;
  done?: string;
  holderId?: string;
}

export function buildCreateCustom(
  input: CustomCardInput,
  actorId: string,
  nowIso: string,
  id: string = newCustomCardId()
): BuildResult & { id: string } {
  const name = input.name.trim();
  if (!name) throw new Error('buildCreateCustom: a custom card needs a name');
  const part: CardPart = { key: MAIN_PART_KEY };
  if (input.holderId) part.holderId = input.holderId;
  const state: ResponsibilityCardState = {
    id,
    status: 'kept',
    splitMode: 'single',
    parts: [part],
    custom: { name, emoji: input.emoji, category: input.category },
    createdBy: actorId,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  const done = input.done?.trim();
  if (done) state.doneOverride = done;
  const ops: DeckOp[] = [{ op: 'setState', state }];
  if (input.holderId) {
    ops.push({
      op: 'setMove',
      move: {
        id: moveId(id, MAIN_PART_KEY, nowIso),
        cardId: id,
        partKey: MAIN_PART_KEY,
        toId: input.holderId,
        byId: actorId,
        at: nowIso,
      },
    });
  }
  return {
    id,
    ops,
    telemetry: [{ message: 'custom_created', context: { kind: input.category } }],
  };
}

/** Delete a family-made card with its whole history. Built-in cards can only be skipped. */
export function buildDeleteCustom(
  card: ResolvedCard,
  moves: readonly ResponsibilityMove[]
): BuildResult {
  if (!card.isCustom) throw new Error('buildDeleteCustom: built-in cards cannot be deleted');
  return {
    ops: [
      { op: 'deleteState', id: card.id },
      ...moves
        .filter((m) => m.cardId === card.id)
        .map((m): DeckOp => ({ op: 'deleteMove', id: m.id })),
    ],
    telemetry: [{ message: 'custom_deleted', context: { kind: card.category } }],
  };
}

/**
 * Restore the default cards and start the deal over (Requirement 15). Takes the RAW
 * stored records so ids this build doesn't recognise are deleted too.
 *   - every non-custom record is deleted (every built-in card is unsorted again);
 *   - custom cards are deleted, or with `keepCustom` kept as waiting: holders and split
 *     cleared, `custom` and `doneOverride` preserved;
 *   - every move is deleted; check-in records are kept. The deck is then empty (see
 *     `countsTowardCycle`), so the next write that puts a card in it writes a new cycle
 *     start (`withCycleStart`) and the check-in clock restarts from there.
 */
export function buildRestoreDefaults(
  states: readonly unknown[],
  moves: readonly ResponsibilityMove[],
  keepCustom: boolean,
  nowIso: string
): BuildResult {
  const ops: DeckOp[] = [];
  let kept = 0;
  for (const raw of states) {
    const id = (raw as { id?: unknown } | null)?.id;
    if (typeof id !== 'string' || !id) continue;
    if (keepCustom && id.startsWith(CUSTOM_CARD_PREFIX) && isValidCardState(raw) && raw.custom) {
      const state: ResponsibilityCardState = {
        ...clone(raw),
        status: 'kept',
        splitMode: 'single',
        parts: [{ key: MAIN_PART_KEY }],
        updatedAt: nowIso,
      };
      ops.push({ op: 'setState', state });
      kept += 1;
    } else {
      ops.push({ op: 'deleteState', id });
    }
  }
  for (const m of moves) {
    if (m && typeof m.id === 'string') ops.push({ op: 'deleteMove', id: m.id });
  }
  return {
    ops,
    telemetry: [
      {
        message: 'restore_defaults',
        context: { detail: keepCustom ? 'keep_custom' : 'clear_custom', count: kept },
      },
    ],
  };
}

export interface CheckInOutcomes {
  stillWorks: number;
  talkAbout: number;
  redealt: number;
  dealtNow: number;
}

/** A write-once check-in with its own id (`newCheckInId`): a second one never overwrites. */
export function buildCheckIn(
  outcomes: CheckInOutcomes,
  actorId: string,
  nowIso: string,
  todayYmd: string,
  id: string = newCheckInId(todayYmd)
): BuildResult & { checkIn: ResponsibilityCheckIn } {
  const checkIn: ResponsibilityCheckIn = {
    id,
    kind: 'checkin',
    completedAt: nowIso,
    byId: actorId,
    stillWorks: outcomes.stillWorks,
    talkAbout: outcomes.talkAbout,
    redealt: outcomes.redealt,
    dealtNow: outcomes.dealtNow,
  };
  const count = outcomes.stillWorks + outcomes.talkAbout + outcomes.redealt + outcomes.dealtNow;
  return {
    checkIn,
    ops: [{ op: 'setCheckIn', checkIn }],
    telemetry: [{ message: 'checkin_completed', context: { count } }],
  };
}

/**
 * Start the check-in cycle if this write is the one that first puts something in an empty
 * deck: `deck` is the resolved deck the builder read (`isUndealtDeck`), and a written card
 * record counts per `countsTowardCycle`. Appends ONE `'start'` record (zero counts) to the
 * same op batch and to the undo token, so undoing that first keep or deal removes it
 * again. Any other write is returned unchanged.
 */
export function withCycleStart(
  build: BuildResult,
  deck: readonly ResolvedCard[],
  actorId: string,
  nowIso: string,
  todayYmd: string,
  id: string = newCheckInId(todayYmd)
): BuildResult {
  const starts = build.ops.some(
    (o) =>
      o.op === 'setState' &&
      countsTowardCycle(
        o.state.status === 'kept',
        o.state.id.startsWith(CUSTOM_CARD_PREFIX),
        o.state.parts
      )
  );
  if (!starts || !isUndealtDeck(deck)) return build;
  const checkIn: ResponsibilityCheckIn = {
    id,
    kind: 'start',
    completedAt: nowIso,
    byId: actorId,
    stillWorks: 0,
    talkAbout: 0,
    redealt: 0,
    dealtNow: 0,
  };
  return {
    ops: [...build.ops, { op: 'setCheckIn', checkIn }],
    undo: build.undo
      ? { ...build.undo, createdCheckInIds: [...build.undo.createdCheckInIds, id] }
      : undefined,
    telemetry: [...build.telemetry, { message: 'checkin_cycle_started', context: {} }],
  };
}

/**
 * Undo a toast action. Refused as a whole (`stale: true`, no ops) when ANY card in the
 * token changed since (its live `updatedAt` differs), so a group skip never half-undoes.
 * The token's cycle start is deleted only when the deck is empty again once `before` is
 * restored (judged on `deck`, the live resolved deck): if another card went into the deck
 * meanwhile (another device), the cycle it belongs to has started and its start stays.
 */
export function buildUndo(
  token: UndoToken,
  live: ReadonlyMap<string, { updatedAt: string }>,
  deck: readonly ResolvedCard[]
): (BuildResult & { stale: false }) | { stale: true } {
  for (const [id, after] of Object.entries(token.afterUpdatedAt)) {
    if (live.get(id)?.updatedAt !== after) return { stale: true };
  }
  const ops: DeckOp[] = [];
  for (const [id, before] of Object.entries(token.before)) {
    ops.push(before ? { op: 'setState', state: clone(before) } : { op: 'deleteState', id });
  }
  for (const id of token.createdMoveIds) ops.push({ op: 'deleteMove', id });
  if (token.createdCheckInIds.length) {
    const others = deck.filter((c) => !(c.id in token.before));
    const restored = Object.values(token.before).some(
      (b) =>
        !!b && countsTowardCycle(b.status === 'kept', b.id.startsWith(CUSTOM_CARD_PREFIX), b.parts)
    );
    if (isUndealtDeck(others) && !restored) {
      for (const id of token.createdCheckInIds) ops.push({ op: 'deleteCheckIn', id });
    }
  }
  return {
    stale: false,
    ops,
    telemetry: [{ message: 'undo', context: { detail: token.action } }],
  };
}
