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
 */
import type { ResponsibilityCardDef, CardDefaultTarget } from '@/constants/responsibilityCards';
import { cardIdForTarget } from '@/constants/responsibilityCards';
import { LIST_CATEGORIES } from '@/constants/listCategories';
import { isAdultMember } from '@/composables/useMemberInfo';
import { CARD_CHECKIN_PREFIX, CARD_MOVE_PREFIX } from '@/utils/notifications';
import { addDaysYmd, toDateInputValue } from '@/utils/date';
import type {
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
  /** The validated stored record, or null while the card is unsorted. */
  state: ResponsibilityCardState | null;
}

export interface ResolvedDeck {
  cards: ResolvedCard[];
  /** Valid records whose id this build doesn't know (a newer client's card). */
  unknownIds: string[];
  /** Malformed records; the card (when known) is treated as unsorted. */
  invalidIds: string[];
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

    const parts = raw.map((p): ResolvedPart => {
      const holderId = p.holderId && eligible.has(p.holderId) ? p.holderId : undefined;
      const part: ResolvedPart = { key: p.key };
      if (typeof p.label === 'string') part.label = p.label;
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
      state,
    });
  }
  return { cards, unknownIds, invalidIds };
}

export interface DeckStats {
  /** Every card in the full set: built-ins plus the family's own. */
  total: number;
  /** The family's deck: waiting + held. */
  deck: number;
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

export interface CategoryCoverage {
  category: ListCategory;
  deck: number;
  held: number;
  waiting: number;
  /** Everyone holding at least one part in the category. Faces only, never counts. */
  holderIds: string[];
}

/** Per category in `LIST_CATEGORIES` order (unknown categories last); only categories with a deck. */
export function categoryCoverage(cards: readonly ResolvedCard[]): CategoryCoverage[] {
  const byCat = new Map<ListCategory, CategoryCoverage>();
  for (const c of cards) {
    if (c.status !== 'held' && c.status !== 'waiting') continue;
    let row = byCat.get(c.category);
    if (!row) {
      row = { category: c.category, deck: 0, held: 0, waiting: 0, holderIds: [] };
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
 * check-ins in the last 30 days, newest first. Skips and splits have no history record,
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
 * When the deck was first dealt: the earliest move that gave a card to someone (derived,
 * never stored). Moves, not card `createdAt`, because only moves have the right lifetime:
 * skipping or re-dealing a card never deletes its moves, so the anchor (and the
 * `card-checkin:<due>` snooze key built on it) stays put; "Restore defaults" deletes every
 * move, so the clock restarts at the next deal whether or not custom cards were kept.
 */
export function firstDealtAt(moves: readonly ResponsibilityMove[]): string | undefined {
  let first: string | undefined;
  for (const m of moves) {
    if (!m?.toId || typeof m.at !== 'string') continue;
    if (!first || m.at < first) first = m.at;
  }
  return first;
}

/** The local day a check-in was finished. The ONE reader: ids are opaque. */
export function checkInYmd(checkIn: ResponsibilityCheckIn): string {
  return ymdOf(checkIn.completedAt);
}

/** The most recently finished check-in (by `completedAt`; several may share a day). */
export function latestCheckIn(
  checkIns: readonly ResponsibilityCheckIn[]
): ResponsibilityCheckIn | undefined {
  let last: ResponsibilityCheckIn | undefined;
  for (const c of checkIns) if (!last || c.completedAt > last.completedAt) last = c;
  return last;
}

/** The next check-in's ymd, or null when the rhythm is off or nothing is dealt yet. */
export function nextCheckInDate(
  weeks: number,
  checkIns: readonly ResponsibilityCheckIn[],
  dealtAt: string | undefined
): string | null {
  if (!weeks) return null;
  const last = latestCheckIn(checkIns);
  if (last) return addDaysYmd(checkInYmd(last), weeks * 7);
  return dealtAt ? addDaysYmd(ymdOf(dealtAt), weeks * 7) : null;
}

export function isCheckInDue(
  weeks: number,
  checkIns: readonly ResponsibilityCheckIn[],
  dealtAt: string | undefined,
  today: string
): boolean {
  const next = nextCheckInDate(weeks, checkIns, dealtAt);
  return !!next && today >= next;
}

/** How long a card must go unchanged before the check-in asks whether it still works. */
export const UNCHANGED_MIN_DAYS = 90;

export interface CheckInAgenda {
  /** Cards with nobody: "deal now". */
  nobody: ResolvedCard[];
  /** Cards re-dealt since the last check-in (latest move per card): "settling in" / "let's talk". */
  moved: { card: ResolvedCard; move: ResponsibilityMove }[];
  /** Up to 3 held cards unchanged for the longest (at least 90 days). */
  unchanged: ResolvedCard[];
}

/** A part's move is current only when its `toId` still holds that part. */
function isCurrentMove(card: ResolvedCard | undefined, m: ResponsibilityMove): boolean {
  return !!card && card.parts.some((p) => p.key === m.partKey && p.holderId === m.toId);
}

export function buildCheckInAgenda(
  cards: readonly ResolvedCard[],
  moves: readonly ResponsibilityMove[],
  lastCheckIn: ResponsibilityCheckIn | undefined,
  today: string
): CheckInAgenda {
  const byId = new Map(cards.map((c) => [c.id, c]));
  const nobody = cards.filter((c) => c.status === 'waiting');

  const movedByCard = new Map<string, ResponsibilityMove>();
  for (const m of moves) {
    if (!isRedeal(m)) continue;
    if (lastCheckIn && m.at <= lastCheckIn.completedAt) continue;
    const card = byId.get(m.cardId);
    if (card?.status !== 'held' && card?.status !== 'waiting') continue;
    if (!isCurrentMove(card, m)) continue;
    const prev = movedByCard.get(m.cardId);
    if (!prev || m.at > prev.at) movedByCard.set(m.cardId, m);
  }
  const moved = [...movedByCard.values()]
    .sort((a, b) => b.at.localeCompare(a.at))
    .map((move) => ({ card: byId.get(move.cardId)!, move }));

  const cutoff = addDaysYmd(today, -UNCHANGED_MIN_DAYS);
  const unchanged = cards
    .filter((c) => c.status === 'held' && !movedByCard.has(c.id))
    .map((c) => {
      const sinces = c.parts.map((p) => p.since).filter((s): s is string => !!s);
      const changed = sinces.length ? sinces.sort().at(-1)! : c.state!.createdAt;
      return { c, changed };
    })
    .filter(({ changed }) => ymdOf(changed) <= cutoff)
    .sort((a, b) => a.changed.localeCompare(b.changed))
    .slice(0, 3)
    .map(({ c }) => c);

  return { nobody, moved, unchanged };
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

export const MOVED_NOTE_DAYS = 14;
export const MOVED_NOTE_CAP = 3;
export const CHECKIN_SNOOZE_DAYS = 7;

export type CardBriefingRow =
  | { kind: 'mine'; cardIds: string[] }
  | {
      kind: 'moved';
      move: ResponsibilityMove;
      cardId: string;
      /** The viewer's side of the move. */
      role: 'from' | 'to';
      dismissKey: string;
    }
  | { kind: 'nobody'; cardIds: string[]; count: number }
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
 * The Nook briefing's card rows, in display order: the viewer's cards, card-moved notes,
 * cards with nobody (adults) and the check-in reminder (adults). Pure: `useCriticalItems`
 * only maps these, and the dismiss keys are written back through `notificationsStore`.
 */
export function buildCardBriefingRows(input: CardBriefingInput): CardBriefingRow[] {
  const { cards, moves, checkIns, rhythmWeeks, readState, viewerId, viewerIsAdult, today } = input;
  const rows: CardBriefingRow[] = [];
  const byId = new Map(cards.map((c) => [c.id, c]));

  const mine = cards
    .filter(
      (c) =>
        (c.status === 'held' || c.status === 'waiting') &&
        c.parts.some((p) => p.holderId === viewerId)
    )
    .map((c) => c.id);
  if (mine.length) rows.push({ kind: 'mine', cardIds: mine });

  const from = addDaysYmd(today, -MOVED_NOTE_DAYS);
  const notes = moves
    .filter(
      (m) =>
        isRedeal(m) &&
        m.byId !== viewerId &&
        (m.fromId === viewerId || m.toId === viewerId) &&
        ymdOf(m.at) >= from &&
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
    const waiting = cards.filter((c) => c.status === 'waiting');
    if (waiting.length) {
      rows.push({
        kind: 'nobody',
        cardIds: waiting.slice(0, 3).map((c) => c.id),
        count: waiting.length,
      });
    }
    const due = nextCheckInDate(rhythmWeeks, checkIns, firstDealtAt(moves));
    if (due && today >= due) {
      const dismissKey = CARD_CHECKIN_PREFIX + due;
      const snoozedAt = readState[dismissKey];
      const snoozed = !!snoozedAt && today < addDaysYmd(ymdOf(snoozedAt), CHECKIN_SNOOZE_DAYS);
      if (!snoozed) rows.push({ kind: 'checkin', dueDate: due, dismissKey });
    }
  }
  return rows;
}
