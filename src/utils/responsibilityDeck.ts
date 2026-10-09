/**
 * Who Owns What (#109) — pure read-side domain logic for the responsibility deck.
 *
 * Everything here is a pure function of its inputs (no store, no clock, no logging), so
 * every rule the Overview, deal views, briefing and integrations rely on is unit-tested
 * without a document. The store (`responsibilityStore`) feeds it and logs what it returns
 * (`unknownIds`, `invalidIds`); the write side lives in `responsibilityOps.ts`.
 *
 * Two rules shape the whole module:
 *   - **Card state is the truth; moves are advisory history.** A move whose `toId` no
 *     longer holds its part (lost to a concurrent write on another device) is ignored for
 *     "since", "previous holder", the briefing and the check-in agenda.
 *   - **Holders resolve against the CURRENT family.** A removed member or a pet is
 *     nobody, and a child split is rebuilt from the current children every time.
 *
 * Card reminders (#123) resolve here too, per part (`ResolvedPart.reminder`). This module
 * imports only the recurrence helpers for them, NEVER to-do code: the to-do side
 * (`utils/cardReminders.ts`) depends on the deck, not the reverse.
 */
import type { ResponsibilityCardDef, CardDefaultTarget } from '@/constants/responsibilityCards';
import { cardIdForTarget } from '@/constants/responsibilityCards';
import { LIST_CATEGORIES } from '@/constants/listCategories';
import { isAdultMember } from '@/composables/useMemberInfo';
import { CARD_CHECKIN_PREFIX, CARD_MOVE_PREFIX } from '@/utils/notifications';
import { addDaysYmd, isWallClockTime, parseLocalDate, toDateInputValue } from '@/utils/date';
import { cadenceToRule } from '@/services/recurrence/cadence';
import { isRuleComplete } from '@/services/recurrence/recurrenceEngine';
import type {
  CardReminder,
  CardSplitMode,
  FamilyMember,
  ListCategory,
  ResponsibilityCardState,
  ResponsibilityCheckIn,
  ResponsibilityMove,
} from '@/types/models';

/** The part key of an unsplit card. Every other part-key rule lives in `responsibilityOps`. */
export const MAIN_PART_KEY = 'main';
/** Prefix of a family-made card's id (`custom-<uuid>`). */
export const CUSTOM_CARD_PREFIX = 'custom-';

export type CardStatus = 'unsorted' | 'waiting' | 'held' | 'skipped';

export interface ResolvedPart {
  key: string;
  label?: string;
  /** A current, non-pet member; absent = nobody. */
  holderId?: string;
  /** When the current holder got this part (from the latest non-superseded move). */
  since?: string;
  /** Who held it before the current holder, when that member is still in the family. */
  previousHolderId?: string;
  /** #123: this part's reminder (`state.reminders[key]`), only when it is well-formed. */
  reminder?: CardReminder;
}

export interface ResolvedCard {
  id: string;
  /** The static definition (built-in cards only). */
  def?: ResponsibilityCardDef;
  /** The family's own name/emoji/category (custom cards only). */
  custom?: { name: string; emoji: string; category: ListCategory };
  isCustom: boolean;
  category: ListCategory;
  emoji: string;
  group?: ResponsibilityCardDef['group'];
  splitHint?: 'child';
  illustration?: string;
  status: CardStatus;
  splitMode: CardSplitMode;
  parts: ResolvedPart[];
  doneOverride?: string;
  /**
   * #123: at least one resolved part carries a reminder. Always set by `resolveDeck`;
   * optional only so hand-built test cards need not spell it out (absent reads as false).
   */
  hasReminder?: boolean;
  /** The validated stored record, or null while the card is unsorted. */
  state: ResponsibilityCardState | null;
}

export interface ResolvedDeck {
  cards: ResolvedCard[];
  /** Valid records whose id this build doesn't know (a newer client's card). */
  unknownIds: string[];
  /** Malformed records; the card (when known) is treated as unsorted. */
  invalidIds: string[];
  /**
   * #123: malformed reminder entries on resolved parts, as `${cardId}:${partKey}` (or the
   * bare card id when the whole `reminders` value is not a map). Only that reminder is
   * ignored; the card itself resolves as normal. Orphan keys are not resolved, so not listed.
   */
  invalidReminderIds: string[];
}

const STATUSES = new Set(['kept', 'skipped']);
const SPLIT_MODES = new Set<CardSplitMode>(['single', 'child', 'label']);

/** Shape check for a record read from the document (any client may have written it). */
export function isValidCardState(s: unknown): s is ResponsibilityCardState {
  if (!s || typeof s !== 'object') return false;
  const r = s as Record<string, unknown>;
  if (typeof r.id !== 'string' || !r.id) return false;
  if (typeof r.status !== 'string' || !STATUSES.has(r.status)) return false;
  if (typeof r.splitMode !== 'string' || !SPLIT_MODES.has(r.splitMode as CardSplitMode))
    return false;
  if (!Array.isArray(r.parts)) return false;
  for (const p of r.parts) {
    if (!p || typeof p !== 'object' || typeof (p as { key?: unknown }).key !== 'string')
      return false;
  }
  if (r.id.startsWith(CUSTOM_CARD_PREFIX)) {
    const c = r.custom as Record<string, unknown> | undefined;
    if (!c || typeof c.name !== 'string' || typeof c.emoji !== 'string') return false;
    if (typeof c.category !== 'string') return false;
  }
  return true;
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;

function isPlainRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Shape check for one stored card reminder (#123; any client may have written it): an
 * object with a string `say`, a cadence the engine can expand, a real `YYYY-MM-DD` anchor,
 * and a `time` that is absent or `HH:mm`.
 */
export function isValidCardReminder(r: unknown): r is CardReminder {
  if (!isPlainRecord(r)) return false;
  if (typeof r.say !== 'string') return false;
  const cadence = r.cadence;
  if (!isPlainRecord(cadence)) return false;
  const weekdays = cadence.weekdays;
  if (
    weekdays !== undefined &&
    !(Array.isArray(weekdays) && weekdays.every((d) => Number.isInteger(d) && d >= 0 && d <= 6))
  )
    return false;
  if (!isRuleComplete(cadenceToRule(cadence as unknown as CardReminder['cadence']))) return false;
  const anchor = r.anchor;
  if (typeof anchor !== 'string' || !YMD.test(anchor)) return false;
  // Round-trip: rejects an overflowing "2026-02-31".
  if (toDateInputValue(parseLocalDate(anchor)) !== anchor) return false;
  return r.time === undefined || (typeof r.time === 'string' && isWallClockTime(r.time));
}

/** The card's own route, opened by the to-do side's links (#123). Never a deep-link entry. */
export function cardRoute(cardId: string): { path: string; query: { card: string } } {
  return { path: '/who-owns-what', query: { card: cardId } };
}

/** Local `YYYY-MM-DD` of an ISO timestamp (a ymd passes through). */
export function ymdOf(iso: string): string {
  return iso.length === 10 ? iso : toDateInputValue(new Date(iso));
}

/** The one re-deal predicate: a move from one holder to a different one. */
export function isRedeal(m: ResponsibilityMove): boolean {
  return !!m.fromId && !!m.toId && m.fromId !== m.toId;
}

function eligibleMembers(members: readonly FamilyMember[]): FamilyMember[] {
  return members.filter((m) => !m.isPet);
}

/** The members a child split makes parts for: current non-pet, non-adult members. */
export function childMembers(members: readonly FamilyMember[]): FamilyMember[] {
  return eligibleMembers(members).filter((m) => !isAdultMember(m));
}

/** Latest move first, per `${cardId}\u0000${partKey}`. */
function movesByPart(moves: readonly ResponsibilityMove[]): Map<string, ResponsibilityMove[]> {
  const out = new Map<string, ResponsibilityMove[]>();
  for (const m of moves) {
    if (!m || typeof m.cardId !== 'string' || typeof m.partKey !== 'string') continue;
    const k = `${m.cardId}\u0000${m.partKey}`;
    const arr = out.get(k) ?? [];
    arr.push(m);
    out.set(k, arr);
  }
  for (const arr of out.values()) arr.sort((a, b) => b.at.localeCompare(a.at));
  return out;
}

export function resolveDeck(
  defs: readonly ResponsibilityCardDef[],
  states: readonly unknown[],
  moves: readonly ResponsibilityMove[],
  members: readonly FamilyMember[]
): ResolvedDeck {
  const eligible = new Set(eligibleMembers(members).map((m) => m.id));
  const children = childMembers(members);
  const byPart = movesByPart(moves);
  const defIds = new Set(defs.map((d) => d.id));

  const valid = new Map<string, ResponsibilityCardState>();
  const invalidIds: string[] = [];
  const unknownIds: string[] = [];
  const invalidReminderIds: string[] = [];
  for (const s of states) {
    if (!isValidCardState(s)) {
      const id = (s as { id?: unknown } | null)?.id;
      invalidIds.push(typeof id === 'string' ? id : '');
      continue;
    }
    valid.set(s.id, s);
    if (!defIds.has(s.id) && !s.id.startsWith(CUSTOM_CARD_PREFIX)) unknownIds.push(s.id);
  }

  function resolveParts(
    cardId: string,
    state: ResponsibilityCardState | null
  ): { splitMode: CardSplitMode; parts: ResolvedPart[] } {
    let splitMode: CardSplitMode = state?.splitMode ?? 'single';
    let raw: { key: string; label?: string; holderId?: string }[];
    if (!state) {
      raw = [{ key: MAIN_PART_KEY }];
    } else if (splitMode === 'child') {
      // Rebuilt from the CURRENT children: a new child gets a part with nobody, a
      // removed child's part disappears. With no children left the card degrades to a
      // single card (nobody), so it can always be dealt.
      if (children.length) {
        raw = children.map((c) => ({
          key: c.id,
          holderId: state.parts.find((p) => p.key === c.id)?.holderId,
        }));
      } else {
        splitMode = 'single';
        raw = [{ key: MAIN_PART_KEY }];
      }
    } else if (splitMode === 'label') {
      raw = state.parts.length ? state.parts : [{ key: MAIN_PART_KEY }];
      if (!state.parts.length) splitMode = 'single';
    } else {
      raw = [state.parts[0] ?? { key: MAIN_PART_KEY }];
    }

    const reminders = remindersOf(cardId, state);
    const parts = raw.map((p): ResolvedPart => {
      const holderId = p.holderId && eligible.has(p.holderId) ? p.holderId : undefined;
      const part: ResolvedPart = { key: p.key };
      if (typeof p.label === 'string') part.label = p.label;
      const reminder = reminderFor(cardId, reminders, p.key);
      if (reminder) part.reminder = reminder;
      if (holderId) {
        part.holderId = holderId;
        // Superseded moves are skipped: only a move TO the current holder counts.
        const latest = byPart.get(`${cardId}\u0000${p.key}`)?.find((m) => m.toId === holderId);
        if (latest) {
          part.since = latest.at;
          if (latest.fromId && latest.fromId !== holderId && eligible.has(latest.fromId))
            part.previousHolderId = latest.fromId;
        }
      }
      return part;
    });
    return { splitMode, parts };
  }

  /** The stored reminder map, or null (a value that is not a map is logged and ignored). */
  function remindersOf(
    cardId: string,
    state: ResponsibilityCardState | null
  ): Record<string, unknown> | null {
    const map: unknown = state?.reminders;
    if (map === undefined) return null;
    if (isPlainRecord(map)) return map;
    invalidReminderIds.push(cardId);
    return null;
  }

  /** One part's reminder when well-formed; a malformed entry is listed and ignored. */
  function reminderFor(
    cardId: string,
    reminders: Record<string, unknown> | null,
    key: string
  ): CardReminder | undefined {
    if (!reminders || !Object.prototype.hasOwnProperty.call(reminders, key)) return undefined;
    const r = reminders[key];
    if (isValidCardReminder(r)) return r;
    invalidReminderIds.push(`${cardId}:${key}`);
    return undefined;
  }

  function statusOf(state: ResponsibilityCardState | null, parts: ResolvedPart[]): CardStatus {
    if (!state) return 'unsorted';
    if (state.status === 'skipped') return 'skipped';
    return parts.length > 0 && parts.every((p) => p.holderId) ? 'held' : 'waiting';
  }

  const cards: ResolvedCard[] = [];
  for (const def of defs) {
    const state = valid.get(def.id) ?? null;
    const { splitMode, parts } = resolveParts(def.id, state);
    cards.push({
      id: def.id,
      def,
      isCustom: false,
      category: def.category,
      emoji: def.emoji,
      group: def.group,
      splitHint: def.splitHint,
      illustration: def.illustration,
      status: statusOf(state, parts),
      splitMode,
      parts,
      doneOverride: state?.doneOverride,
      hasReminder: parts.some((p) => !!p.reminder),
      state,
    });
  }
  for (const state of valid.values()) {
    if (!state.id.startsWith(CUSTOM_CARD_PREFIX) || !state.custom) continue;
    const { splitMode, parts } = resolveParts(state.id, state);
    cards.push({
      id: state.id,
      custom: state.custom,
      isCustom: true,
      category: state.custom.category,
      emoji: state.custom.emoji,
      status: statusOf(state, parts),
      splitMode,
      parts,
      doneOverride: state.doneOverride,
      hasReminder: parts.some((p) => !!p.reminder),
      state,
    });
  }
  return { cards, unknownIds, invalidIds, invalidReminderIds };
}

export interface DeckStats {
  /** Every card in the full set: built-ins plus the family's own. */
  total: number;
  /** The family's deck: waiting + held. */
  deck: number;
  /** Every card not skipped: held + waiting + unsorted. The Overview's progress measures against this. */
  inPlay: number;
  held: number;
  waiting: number;
  skipped: number;
  unsorted: number;
  /** Deck cards split into more than one part. */
  splitCount: number;
}

export function deckStats(cards: readonly ResolvedCard[]): DeckStats {
  const s: DeckStats = {
    total: cards.length,
    deck: 0,
    inPlay: 0,
    held: 0,
    waiting: 0,
    skipped: 0,
    unsorted: 0,
    splitCount: 0,
  };
  for (const c of cards) {
    s[c.status] += 1;
    if ((c.status === 'held' || c.status === 'waiting') && c.splitMode !== 'single') {
      s.splitCount += 1;
    }
  }
  s.deck = s.held + s.waiting;
  s.inPlay = s.total - s.skipped;
  return s;
}

/** A run of cards in one category; `category` is null for categories this build doesn't know. */
export interface CategoryGroup {
  category: ListCategory | null;
  cards: ResolvedCard[];
}

/**
 * Cards grouped by category in `LIST_CATEGORIES` order, unknown categories last (one
 * group), card order kept within each group. The ONE ordering every deck surface uses:
 * the Deck shelves, the deal rail, the deal pile's first-deal order and the fridge sheet.
 */
export function groupByCategory(cards: readonly ResolvedCard[]): CategoryGroup[] {
  const known = new Set<string>(LIST_CATEGORIES.map((c) => c.id));
  const byCat = new Map<ListCategory | null, ResolvedCard[]>();
  for (const c of cards) {
    const key = known.has(c.category) ? c.category : null;
    const arr = byCat.get(key) ?? [];
    arr.push(c);
    byCat.set(key, arr);
  }
  const out: CategoryGroup[] = [];
  for (const cat of LIST_CATEGORIES) {
    const group = byCat.get(cat.id);
    if (group?.length) out.push({ category: cat.id, cards: group });
  }
  const other = byCat.get(null);
  if (other?.length) out.push({ category: null, cards: other });
  return out;
}

// ── Card history ────────────────────────────────────────────────────────────────
export type CardHistoryKind = 'dealt' | 'moved' | 'cleared' | 'sorted' | 'talked';

export interface CardHistoryEntry {
  kind: CardHistoryKind;
  at: string;
  /** The part a move was on, as recorded (a split card); absent for card-level entries. */
  partKey?: string;
  /** A label split's label at the time of the move. */
  partLabel?: string;
  fromId?: string;
  toId?: string;
}

/**
 * Everything that happened to one card, newest first: every deal, hand-over and return to
 * nobody (from the move log; an undone move is deleted), and when it was first sorted (kept
 * or skipped: `state.createdAt`, written once). A card nobody has moved still shows when it
 * was sorted and first dealt. A deal lost to a simultaneous one on another device still
 * shows, as it happened on that device; who holds the card now is on the card itself.
 * Malformed records (a half-synced move from another client) are skipped, as every other
 * reader of the move log does.
 *
 * Only timestamps that record the event itself are used: `updatedAt` changes on every save
 * (an edit to the done line), so a "skipped on" date from it would be wrong. A move with
 * neither side recorded carries no information and is left out.
 *
 * `checkIns` adds a `talked` entry for every finished check-in that answered this card
 * We've Talked (read through `checkInCardIds`), dated `completedAt`. Only check-ins in the
 * card's current life count (`completedAt >= state.createdAt`): Restore defaults keeps
 * check-ins but wipes states and moves, so an older one belongs to a previous deck.
 */
export function cardHistory(
  card: Pick<ResolvedCard, 'id' | 'state'>,
  moves: readonly ResponsibilityMove[],
  checkIns: readonly unknown[]
): CardHistoryEntry[] {
  const out: CardHistoryEntry[] = [];
  for (const m of moves) {
    if (!m || typeof m.cardId !== 'string' || typeof m.at !== 'string') continue;
    if (m.cardId !== card.id || (!m.fromId && !m.toId)) continue;
    const kind: CardHistoryKind = !m.toId ? 'cleared' : m.fromId ? 'moved' : 'dealt';
    out.push({
      kind,
      at: m.at,
      partKey: m.partKey,
      partLabel: m.partLabel,
      fromId: m.fromId,
      toId: m.toId,
    });
  }
  if (card.state) {
    const since = card.state.createdAt;
    out.push({ kind: 'sorted', at: since });
    // "We've Talked" at a check-in. Only this life of the card: Restore defaults keeps the
    // check-ins but wipes states and moves, and a check-in can only discuss a kept card.
    for (const c of checkIns) {
      if (!isReadableCheckIn(c) || isCycleStart(c) || c.completedAt < since) continue;
      if (checkInCardIds(c, 'talkedIds').includes(card.id))
        out.push({ kind: 'talked', at: c.completedAt });
    }
  }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}

// ── Card details sequences ──────────────────────────────────────────────────────
/**
 * The list a card was opened from (a Deck shelf, a bean's cards, a board lane, Skipped,
 * the Overview's Waiting rows), so the details drawer can step through it.
 */
export interface CardSequence {
  ids: string[];
  label: string;
}

/**
 * The ONE way to build a sequence. De-duplicated, first place kept: one member can hold
 * several parts of the same split card, and a card appearing twice would break "n of N".
 */
export function cardSequence(label: string, ids: readonly string[]): CardSequence {
  return { label, ids: [...new Set(ids)] };
}

export interface SequenceStep {
  /** 1-based position among the cards that still exist. */
  n: number;
  total: number;
  prevId: string | null;
  nextId: string | null;
}

/**
 * Where `cardId` sits in `seq`, over the ids that still `exist` (status does not matter, so
 * Skipped flips like any list; only a card deleted elsewhere drops out). Null when there is
 * no list, one card left, or the card is no longer in it: the drawer then shows no arrows.
 */
export function sequenceStep(
  seq: CardSequence | null,
  cardId: string,
  exists: (id: string) => boolean
): SequenceStep | null {
  if (!seq) return null;
  const ids = seq.ids.filter(exists);
  const i = ids.indexOf(cardId);
  if (ids.length < 2 || i < 0) return null;
  return {
    n: i + 1,
    total: ids.length,
    prevId: ids[i - 1] ?? null,
    nextId: ids[i + 1] ?? null,
  };
}

export interface CategoryCoverage {
  category: ListCategory;
  /** Every card in the category that is not skipped: held + waiting + unsorted. */
  deck: number;
  held: number;
  waiting: number;
  unsorted: number;
  /** Everyone holding at least one part in the category. Faces only, never counts. */
  holderIds: string[];
}

/**
 * Per category in `LIST_CATEGORIES` order (unknown categories last); only categories with at
 * least one card that is not skipped, so a category still waiting to be sorted shows too.
 */
export function categoryCoverage(cards: readonly ResolvedCard[]): CategoryCoverage[] {
  const byCat = new Map<ListCategory, CategoryCoverage>();
  for (const c of cards) {
    if (c.status === 'skipped') continue;
    let row = byCat.get(c.category);
    if (!row) {
      row = { category: c.category, deck: 0, held: 0, waiting: 0, unsorted: 0, holderIds: [] };
      byCat.set(c.category, row);
    }
    row.deck += 1;
    row[c.status] += 1;
    for (const p of c.parts) {
      if (p.holderId && !row.holderIds.includes(p.holderId)) row.holderIds.push(p.holderId);
    }
  }
  const order = new Map(LIST_CATEGORIES.map((c, i) => [c.id, i]));
  return [...byCat.values()].sort(
    (a, b) => (order.get(a.category) ?? 99) - (order.get(b.category) ?? 99)
  );
}

export type RecentItem =
  | { kind: 'redeal'; at: string; cardId: string; move: ResponsibilityMove }
  | { kind: 'custom' | 'split' | 'skip'; at: string; cardId: string }
  | { kind: 'checkin'; at: string; checkIn: ResponsibilityCheckIn };

/**
 * The Overview's "recent moves": re-deals, custom cards added, splits, skips and
 * finished check-ins (never cycle starts) in the last 30 days, newest first. Skips and splits have no history record,
 * so they are read from the card's `updatedAt` (the latest write to a skipped or split
 * card); that is approximate by design and good enough for a glance.
 */
export function recentMoves(
  moves: readonly ResponsibilityMove[],
  checkIns: readonly ResponsibilityCheckIn[],
  states: readonly unknown[],
  today: string,
  limit = 5
): RecentItem[] {
  const from = addDaysYmd(today, -30);
  const inWindow = (at: string | undefined) => !!at && ymdOf(at) >= from && ymdOf(at) <= today;
  const validStates = states.filter(isValidCardState);
  const kept = new Set(validStates.filter((s) => s.status === 'kept').map((s) => s.id));
  const items: RecentItem[] = [];
  for (const m of moves) {
    if (isRedeal(m) && kept.has(m.cardId) && inWindow(m.at))
      items.push({ kind: 'redeal', at: m.at, cardId: m.cardId, move: m });
  }
  for (const s of validStates) {
    if (s.custom && s.id.startsWith(CUSTOM_CARD_PREFIX) && inWindow(s.createdAt))
      items.push({ kind: 'custom', at: s.createdAt, cardId: s.id });
    if (s.status === 'skipped' && inWindow(s.updatedAt))
      items.push({ kind: 'skip', at: s.updatedAt, cardId: s.id });
    else if (s.status === 'kept' && s.splitMode !== 'single' && inWindow(s.updatedAt))
      items.push({ kind: 'split', at: s.updatedAt, cardId: s.id });
  }
  for (const c of checkIns) {
    if (!isReadableCheckIn(c) || isCycleStart(c)) continue;
    if (inWindow(c.completedAt)) items.push({ kind: 'checkin', at: c.completedAt, checkIn: c });
  }
  return items.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}

/** The holder of an unsplit, fully held card; undefined when split, waiting, skipped or unknown. */
export function singleHolderOf(cards: readonly ResolvedCard[], cardId: string): string | undefined {
  const card = cards.find((c) => c.id === cardId);
  if (!card || card.status !== 'held' || card.splitMode !== 'single' || card.parts.length !== 1)
    return undefined;
  return card.parts[0]!.holderId;
}

/**
 * Who a card could be handed to next: every member but its first part's current holder.
 * Offering the holder would write nothing yet toast "dealt" and count a re-deal. Used by
 * the check-in's Re-deal and the deal pile's "Give it to someone else".
 */
export function otherHumans<M extends { id: string }>(
  members: readonly M[],
  card: Pick<ResolvedCard, 'parts'>
): M[] {
  const holder = card.parts[0]?.holderId;
  return members.filter((m) => m.id !== holder);
}

/**
 * The deal pile's two lists: Kept (held and waiting) and Skipped, each newest change first
 * by `state.updatedAt` (every deck write stamps it). Ties break by category order, then id,
 * so the lists never reshuffle between renders. Unsorted cards are in neither list.
 */
export function keptAndSkipped(cards: readonly ResolvedCard[]): {
  kept: ResolvedCard[];
  skipped: ResolvedCard[];
} {
  const catIndex = new Map<string, number>(LIST_CATEGORIES.map((c, i) => [c.id, i]));
  const rank = (c: ResolvedCard) => catIndex.get(c.category) ?? LIST_CATEGORIES.length;
  const newestFirst = (a: ResolvedCard, b: ResolvedCard) =>
    (b.state?.updatedAt ?? '').localeCompare(a.state?.updatedAt ?? '') ||
    rank(a) - rank(b) ||
    a.id.localeCompare(b.id);
  return {
    kept: cards.filter((c) => c.status === 'held' || c.status === 'waiting').sort(newestFirst),
    skipped: cards.filter((c) => c.status === 'skipped').sort(newestFirst),
  };
}

/** The `CARD_DEFAULTS` lookup + `singleHolderOf`: who beanies should default to, and why. */
export function defaultHolderFor(
  cards: readonly ResolvedCard[],
  target: CardDefaultTarget
): { memberId: string; cardId: string } | null {
  const cardId = cardIdForTarget(target);
  if (!cardId) return null;
  const memberId = singleHolderOf(cards, cardId);
  return memberId ? { memberId, cardId } : null;
}

// ── Family check-in ─────────────────────────────────────────────────────────────

/**
 * Does a card put something in the deck for a check-in to be about? A kept built-in card
 * (held, or "decide later"), or a family-made card someone holds. A family-made card that
 * nobody holds does not count: "Restore defaults" keeps those as waiting, and the deal
 * (and so the check-in clock) must still start over after it. Skipped and unsorted cards
 * never count. The ONE rule, shared by the resolved deck (`isUndealtDeck`) and the card
 * records a builder is about to write (`withCycleStart`).
 */
export function countsTowardCycle(
  kept: boolean,
  isCustom: boolean,
  parts: readonly { holderId?: string }[]
): boolean {
  return kept && (!isCustom || parts.some((p) => !!p.holderId));
}

/** Nothing is in the deck yet (see `countsTowardCycle`): the next write that adds a card starts a check-in cycle. */
export function isUndealtDeck(cards: readonly ResolvedCard[]): boolean {
  return !cards.some((c) =>
    countsTowardCycle(c.status === 'held' || c.status === 'waiting', c.isCustom, c.parts)
  );
}

/** A check-in record is readable only with a string `completedAt`; anything else is skipped. */
function isReadableCheckIn(c: unknown): c is ResponsibilityCheckIn {
  return (
    !!c &&
    typeof c === 'object' &&
    typeof (c as { completedAt?: unknown }).completedAt === 'string' &&
    !!(c as { completedAt: string }).completedAt
  );
}

/** A cycle-start record, not a finished check-in. Records without `kind` are check-ins. */
export function isCycleStart(c: ResponsibilityCheckIn): boolean {
  return c.kind === 'start';
}

/** The local day a check-in was finished (or a cycle started). The ONE reader: ids are opaque. */
export function checkInYmd(checkIn: ResponsibilityCheckIn): string {
  return ymdOf(checkIn.completedAt);
}

function latestOf(
  checkIns: readonly unknown[],
  include: (c: ResponsibilityCheckIn) => boolean
): ResponsibilityCheckIn | undefined {
  let last: ResponsibilityCheckIn | undefined;
  for (const c of checkIns) {
    if (!isReadableCheckIn(c) || !include(c)) continue;
    if (!last || c.completedAt > last.completedAt) last = c;
  }
  return last;
}

/**
 * The most recently FINISHED check-in (by `completedAt`; several may share a day). Cycle
 * starts are not check-ins, so the Overview's "last check-in" never shows one.
 */
export function latestCheckIn(checkIns: readonly unknown[]): ResponsibilityCheckIn | undefined {
  return latestOf(checkIns, (c) => !isCycleStart(c));
}

/**
 * What the check-in clock runs from: the latest record of either kind, a finished
 * check-in or a cycle start. Undefined until the deck has had something put in it. Also
 * the line "moved since last time" is drawn from.
 */
export function checkInAnchor(checkIns: readonly unknown[]): ResponsibilityCheckIn | undefined {
  return latestOf(checkIns, () => true);
}

/**
 * The next check-in's local ymd: rhythm weeks after the anchor's local day. Null when the
 * rhythm is off, there is no anchor, or the deck has nothing in it (`isUndealtDeck`: after
 * Restore defaults, everything skipped, or the first keep undone), since a check-in about
 * no cards is never due. The date itself changes only when a record is written (a
 * check-in, or a new cycle start after the deck was emptied or restored), so the
 * `card-checkin:<due>` snooze key built on it is stable across every deal, skip and
 * card delete in between.
 */
export function nextCheckInDate(
  weeks: number,
  checkIns: readonly unknown[],
  cards: readonly ResolvedCard[]
): string | null {
  if (!weeks || isUndealtDeck(cards)) return null;
  const anchor = checkInAnchor(checkIns);
  return anchor ? addDaysYmd(checkInYmd(anchor), weeks * 7) : null;
}

export function isCheckInDue(
  weeks: number,
  checkIns: readonly unknown[],
  cards: readonly ResolvedCard[],
  today: string
): boolean {
  const next = nextCheckInDate(weeks, checkIns, cards);
  return !!next && today >= next;
}

/** How long a card must go unchanged before the check-in asks whether it still works. */
export const UNCHANGED_MIN_DAYS = 90;

export interface CheckInAgenda {
  /**
   * Cards the last check-in saved for this one (Save for Next Time), in deck order: listed
   * here once, never also in `moved` / `unchanged`.
   */
  saved: ResolvedCard[];
  /** Cards with nobody: "deal now". */
  nobody: ResolvedCard[];
  /** Cards re-dealt since the anchor (latest move per card): No Issues / We've Talked / Save. */
  moved: { card: ResolvedCard; move: ResponsibilityMove }[];
  /** Up to 3 held cards unchanged for the longest (at least 90 days). */
  unchanged: ResolvedCard[];
}

/** A part's move is current only when its `toId` still holds that part. */
function isCurrentMove(card: ResolvedCard | undefined, m: ResponsibilityMove): boolean {
  return !!card && card.parts.some((p) => p.key === m.partKey && p.holderId === m.toId);
}

/** `anchor` is `checkInAnchor(checkIns)`: re-deals after it are "moved since last time". */
export function buildCheckInAgenda(
  cards: readonly ResolvedCard[],
  moves: readonly ResponsibilityMove[],
  anchor: ResponsibilityCheckIn | undefined,
  today: string
): CheckInAgenda {
  const byId = new Map(cards.map((c) => [c.id, c]));
  const nobody = cards.filter((c) => c.status === 'waiting');
  // Saved by the last FINISHED check-in (a cycle start carries nothing), still kept.
  const savedIds = new Set(
    anchor && !isCycleStart(anchor) ? checkInCardIds(anchor, 'savedIds') : []
  );
  const saved = cards.filter(
    (c) => savedIds.has(c.id) && (c.status === 'held' || c.status === 'waiting')
  );
  const isSaved = new Set(saved.map((c) => c.id));

  const movedByCard = new Map<string, ResponsibilityMove>();
  for (const m of moves) {
    if (!isRedeal(m)) continue;
    if (anchor && m.at <= anchor.completedAt) continue;
    const card = byId.get(m.cardId);
    if (card?.status !== 'held' && card?.status !== 'waiting') continue;
    if (!isCurrentMove(card, m)) continue;
    if (isSaved.has(m.cardId)) continue;
    const prev = movedByCard.get(m.cardId);
    if (!prev || m.at > prev.at) movedByCard.set(m.cardId, m);
  }
  const moved = [...movedByCard.values()]
    .sort((a, b) => b.at.localeCompare(a.at))
    .map((move) => ({ card: byId.get(move.cardId)!, move }));

  const cutoff = addDaysYmd(today, -UNCHANGED_MIN_DAYS);
  const unchanged = cards
    // Saved cards leave BEFORE the cap, so they never take one of the 3 slots.
    .filter((c) => c.status === 'held' && !movedByCard.has(c.id) && !isSaved.has(c.id))
    .map((c) => {
      const sinces = c.parts.map((p) => p.since).filter((s): s is string => !!s);
      const changed = sinces.length ? sinces.sort().at(-1)! : c.state!.createdAt;
      return { c, changed };
    })
    .filter(({ changed }) => ymdOf(changed) <= cutoff)
    .sort((a, b) => a.changed.localeCompare(b.changed))
    .slice(0, 3)
    .map(({ c }) => c);

  return { saved, nobody, moved, unchanged };
}

/**
 * The ONE reader of a check-in's card lists: the string entries of an array (a mixed list
 * keeps its strings; a non-array reads as empty). `invalidCheckIns` reports any list that
 * is not purely strings, so a bad shape from another client is logged, not silent.
 */
export function checkInCardIds(c: ResponsibilityCheckIn, key: 'talkedIds' | 'savedIds'): string[] {
  const list: unknown = c[key];
  return Array.isArray(list) ? list.filter((id): id is string => typeof id === 'string') : [];
}

/**
 * Readable check-ins whose `talkedIds` / `savedIds` is present but not a list of strings:
 * `key` identifies the record for once-per-session logging (its id, or its date when a
 * foreign client wrote no id), `list` says which field is wrong, for triage from the logs.
 */
export function invalidCheckIns(
  checkIns: readonly unknown[]
): { key: string; list: 'talkedIds' | 'savedIds' | 'both' }[] {
  const bad: { key: string; list: 'talkedIds' | 'savedIds' | 'both' }[] = [];
  for (const c of checkIns) {
    if (!isReadableCheckIn(c)) continue;
    const broken = (['talkedIds', 'savedIds'] as const).filter((key) => {
      const list: unknown = c[key];
      return (
        list !== undefined && !(Array.isArray(list) && list.every((id) => typeof id === 'string'))
      );
    });
    if (!broken.length) continue;
    bad.push({
      key: typeof c.id === 'string' ? c.id : `no-id@${c.completedAt}`,
      list: broken.length === 2 ? 'both' : broken[0]!,
    });
  }
  return bad;
}

/**
 * Where "Deal the Remaining" opens the pile: the never-sorted cards first, else the kept
 * ones waiting for a holder. The ONE rule (Overview, check-in, the page's default scope).
 */
export function remainingScope(stats: Pick<DeckStats, 'unsorted'>): 'unsorted' | 'waiting' {
  return stats.unsorted > 0 ? 'unsorted' : 'waiting';
}

/** "No car? Skip all 3": the other unsorted cards in the top card's group, when > 1. */
export function groupShortcut(
  cards: readonly ResolvedCard[],
  card: ResolvedCard
): { group: NonNullable<ResolvedCard['group']>; unsortedIds: string[] } | null {
  if (!card.group) return null;
  const unsortedIds = cards
    .filter((c) => c.group === card.group && c.status === 'unsorted')
    .map((c) => c.id);
  return unsortedIds.length > 1 ? { group: card.group, unsortedIds } : null;
}

// ── Nook briefing ───────────────────────────────────────────────────────────────

export const MOVED_NOTE_DAYS = 7;
export const MOVED_NOTE_CAP = 3;
export const CHECKIN_SNOOZE_DAYS = 7;

export type CardBriefingRow =
  | {
      kind: 'moved';
      move: ResponsibilityMove;
      cardId: string;
      /** The viewer's side of the move. */
      role: 'from' | 'to';
      dismissKey: string;
    }
  | { kind: 'checkin'; dueDate: string; dismissKey: string };

export interface CardBriefingInput {
  cards: readonly ResolvedCard[];
  moves: readonly ResponsibilityMove[];
  checkIns: readonly ResponsibilityCheckIn[];
  rhythmWeeks: number;
  /** The viewer's `notificationReads` slice (id → readAt). */
  readState: Readonly<Record<string, string>>;
  viewerId: string;
  viewerIsAdult: boolean;
  today: string;
}

/**
 * The Nook briefing's card rows, in display order: card-moved notes and the check-in
 * reminder (adults). Pure: `useCriticalItems` only maps these, and the dismiss keys are
 * written back through `notificationsStore`.
 *
 * Deliberately NOT here (2026-09-30, docs/plans/2026-09-30-who-owns-what-briefing-trim.md):
 * a standing "your cards" row (never actionable, never dismissable, so it read as clutter)
 * and "cards with nobody" (an action in an area, which the app signals with the nav count
 * badge `stillToDeal` in `useNavBadges`, like over-budget or unbooked travel).
 */
export function buildCardBriefingRows(input: CardBriefingInput): CardBriefingRow[] {
  const { cards, moves, checkIns, rhythmWeeks, readState, viewerId, viewerIsAdult, today } = input;
  const rows: CardBriefingRow[] = [];
  const byId = new Map(cards.map((c) => [c.id, c]));

  // Strictly newer than MOVED_NOTE_DAYS ago: a note shows on 7 calendar days (the day of
  // the move and the 6 after) and is gone a week after the move, as the help says.
  const from = addDaysYmd(today, -MOVED_NOTE_DAYS);
  const notes = moves
    .filter(
      (m) =>
        isRedeal(m) &&
        m.byId !== viewerId &&
        (m.fromId === viewerId || m.toId === viewerId) &&
        ymdOf(m.at) > from &&
        !readState[CARD_MOVE_PREFIX + m.id] &&
        isCurrentMove(byId.get(m.cardId), m)
    )
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, MOVED_NOTE_CAP);
  for (const m of notes) {
    rows.push({
      kind: 'moved',
      move: m,
      cardId: m.cardId,
      role: m.toId === viewerId ? 'to' : 'from',
      dismissKey: CARD_MOVE_PREFIX + m.id,
    });
  }

  if (viewerIsAdult) {
    const due = nextCheckInDate(rhythmWeeks, checkIns, cards);
    if (due && today >= due) {
      const dismissKey = CARD_CHECKIN_PREFIX + due;
      const snoozedAt = readState[dismissKey];
      const snoozed = !!snoozedAt && today < addDaysYmd(ymdOf(snoozedAt), CHECKIN_SNOOZE_DAYS);
      if (!snoozed) rows.push({ kind: 'checkin', dueDate: due, dismissKey });
    }
  }
  return rows;
}
