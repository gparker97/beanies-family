/**
 * Who Owns What (#109, round 7): the deal pile's cursor. Which card is on screen, where it
 * sits in the queue, and where the pile goes after an action. Pure state over `ref` /
 * `computed`: no store import, no DOM, so every cursor rule is unit-tested without a mount.
 *
 * The model:
 *  - `queue` is a snapshot of the card ids in scope, taken once when the deck has loaded
 *    (`load`, plus the card it opens at). Progress, `total` and `position` count only it.
 *  - A card jumped to from the lists that is not in the queue is **visited**, never added:
 *    the position line shows just its category, the totals don't move, and either arrow (or
 *    an advancing action) returns to the queue card the jump left (`returnId`).
 *  - `ordered` resolves the queue against the LIVE deck (`cardById`) in category order, so
 *    a card deleted on another device drops out and the order never drifts.
 *  - `currentId` is a card id, not an index, so a store refresh can never swap the card on
 *    screen mid-flight. It moves only by `step`, `jumpTo`, `load` and `settle`.
 *  - A card is **undecided** when it still needs an answer: unsorted, or waiting and not
 *    passed over ("Decide later") this session. `null` means nothing is left: the done state.
 */
import { computed, ref } from 'vue';
import { groupByCategory, type CardStatus, type ResolvedCard } from '@/utils/responsibilityDeck';
import type { ListCategory } from '@/types/models';

/** What the pile shows for the card on screen. */
export type PileView = 'sort' | 'pick' | 'held' | 'skipped';

/** How the pile moves after an action: on to the next card, or stay to show the result. */
export type SettleMode = 'advance' | 'stay';

export function isUndecided(card: ResolvedCard | undefined, passed: ReadonlySet<string>): boolean {
  if (!card) return false;
  if (card.status === 'unsorted') return true;
  return card.status === 'waiting' && !passed.has(card.id);
}

/**
 * The first id after `fromId` that satisfies `pred`, wrapping round to the start and never
 * returning `fromId` itself. When `fromId` is absent (null, or dropped from the queue) the
 * search starts from the top. Null when nothing qualifies.
 */
export function nextUndecided(
  ids: readonly string[],
  fromId: string | null,
  pred: (id: string) => boolean
): string | null {
  const at = fromId === null ? -1 : ids.indexOf(fromId);
  for (let i = 1; i <= ids.length; i++) {
    const id = ids[(at + i) % ids.length]!;
    if (id !== fromId && pred(id)) return id;
  }
  return null;
}

/**
 * The view for a card: unsorted asks keep-or-skip (or shows the faces once kept), waiting
 * goes straight to the faces, held shows its banner (or the faces for "Give it to someone
 * else"), and skipped shows its banner.
 */
export function pileView(status: CardStatus, picking: boolean): PileView {
  if (status === 'unsorted') return picking ? 'pick' : 'sort';
  if (status === 'waiting') return 'pick';
  if (status === 'held') return picking ? 'pick' : 'held';
  return 'skipped';
}

export interface PilePosition {
  category: ListCategory | null;
  /** 1-based index within the category; null while visiting a card outside the queue. */
  n: number | null;
  total: number | null;
}

export function usePileCursor(opts: {
  cardById: (id: string) => ResolvedCard | undefined;
  /**
   * The deck's own card order (the store's). A card jumped to from the lists then takes its
   * natural place in the pile instead of joining the end. Without it: queue order.
   */
  order?: () => readonly string[];
}) {
  const { cardById, order } = opts;

  const queue = ref<string[]>([]);
  const passed = ref(new Set<string>());
  const currentId = ref<string | null>(null);
  /** The queue card a jump to an out-of-queue card left, where the pile goes back to. */
  const returnId = ref<string | null>(null);
  const ready = ref(false);

  const rank = computed(() => new Map((order?.() ?? []).map((id, i) => [id, i])));
  const groups = computed(() => {
    const at = (id: string) => rank.value.get(id) ?? Infinity;
    const ids = order ? [...queue.value].sort((a, b) => at(a) - at(b)) : queue.value;
    return groupByCategory(ids.map(cardById).filter((c): c is ResolvedCard => c !== undefined));
  });
  const ordered = computed(() => groups.value.flatMap((g) => g.cards));
  const orderedIds = computed(() => ordered.value.map((c) => c.id));
  const current = computed(() => (currentId.value ? cardById(currentId.value) : undefined));

  const undecided = (id: string) => isUndecided(cardById(id), passed.value);
  const inQueue = (id: string) => orderedIds.value.includes(id);
  /** On a card outside the queue (reached from the lists). */
  const visiting = computed(() => !!currentId.value && !queue.value.includes(currentId.value));
  /** Where a visit goes back to: the card it left, while that is still in the pile. */
  const backToQueue = computed(() =>
    visiting.value && returnId.value && inQueue(returnId.value) ? returnId.value : null
  );

  const position = computed<PilePosition | null>(() => {
    const id = currentId.value;
    if (!id) return null;
    for (const g of groups.value) {
      const i = g.cards.findIndex((c) => c.id === id);
      if (i !== -1) return { category: g.category, n: i + 1, total: g.cards.length };
    }
    const c = cardById(id);
    return c ? { category: c.category ?? null, n: null, total: null } : null;
  });

  /**
   * The next card still to decide after `fromId`. From a visited card that is the card the
   * visit left (when it still needs an answer), else the next one after it.
   */
  function nextAfter(fromId: string): string | null {
    const back = inQueue(fromId) ? null : backToQueue.value;
    if (!back) return nextUndecided(orderedIds.value, fromId, undecided);
    return undecided(back) ? back : nextUndecided(orderedIds.value, back, undecided);
  }

  const remaining = computed(() => ordered.value.filter((c) => undecided(c.id)).length);
  const total = computed(() => ordered.value.length);
  /** Where "Back to <card>" goes from a decided card; null when there is nowhere to go. */
  const nextToDecide = computed(() => (currentId.value ? nextAfter(currentId.value) : null));

  /**
   * Take the queue snapshot. Starts at `startId` when given (it joins the queue: it is the
   * card the pile was opened to deal), else the first undecided card.
   */
  function load(ids: readonly string[], startId?: string): void {
    queue.value = [...new Set(startId ? [...ids, startId] : ids)];
    ready.value = true;
    currentId.value = startId ?? nextUndecided(orderedIds.value, null, undecided);
  }

  function canStep(dir: -1 | 1): boolean {
    const id = currentId.value;
    if (!id) return false;
    if (visiting.value) return backToQueue.value !== null;
    const i = orderedIds.value.indexOf(id);
    if (i === -1) return false;
    const j = i + dir;
    return j >= 0 && j < orderedIds.value.length;
  }

  /**
   * One card back or forward, including decided cards. Clamped at the ends (no wrap). From a
   * visited card either direction returns to the queue card the visit left.
   */
  function step(dir: -1 | 1): void {
    if (!canStep(dir)) return;
    if (visiting.value) {
      currentId.value = backToQueue.value;
      return;
    }
    const i = orderedIds.value.indexOf(currentId.value!);
    currentId.value = orderedIds.value[i + dir]!;
  }

  /** Show this card. One outside the queue is visited (see the file header), never added. */
  function jumpTo(id: string): void {
    if (!queue.value.includes(id) && currentId.value && !visiting.value) {
      returnId.value = currentId.value;
    }
    currentId.value = id;
  }

  /** Move past a waiting card this session without a write ("Decide later"). */
  function pass(id: string): void {
    passed.value = new Set(passed.value).add(id);
  }

  /**
   * After an action on `actedId`. If the cursor has moved meanwhile (an Undo jumped it), it
   * stays where it is. With `'stay'`, or when the card still needs an answer (an Undo landed
   * mid-flight, or a split card with another open part), the card stays. Otherwise on to
   * the next undecided card, or the done state. A card that vanished counts as decided, so
   * the pile moves on from it.
   */
  function settle(actedId: string, after: SettleMode): void {
    if (currentId.value !== actedId) return;
    if (after === 'stay' && cardById(actedId)) return;
    if (undecided(actedId)) return;
    currentId.value = nextAfter(actedId);
  }

  return {
    ready,
    currentId,
    current,
    ordered,
    position,
    visiting,
    remaining,
    total,
    nextToDecide,
    load,
    canStep,
    step,
    jumpTo,
    pass,
    settle,
    isUndecided: undecided,
  };
}
