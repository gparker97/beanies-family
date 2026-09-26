/**
 * usePileCursor: the deal pile's cursor rules, without a mount. The deck is a reactive Map
 * standing in for the store's live `cardById`.
 */
import { describe, it, expect } from 'vitest';
import { effectScope, reactive } from 'vue';
import type { CardStatus, ResolvedCard } from '@/utils/responsibilityDeck';
import type { ListCategory } from '@/types/models';
import { isUndecided, nextUndecided, pileView, usePileCursor } from '../usePileCursor';

function card(id: string, status: CardStatus, category: ListCategory = 'home'): ResolvedCard {
  return {
    id,
    isCustom: false,
    category,
    emoji: '🃏',
    status,
    splitMode: 'single',
    parts: [{ key: 'main' }],
    state: null,
  };
}

function setup(cards: ResolvedCard[]) {
  const deck = reactive(new Map(cards.map((c) => [c.id, c])));
  const scope = effectScope();
  const cursor = scope.run(() => usePileCursor({ cardById: (id) => deck.get(id) }))!;
  const set = (id: string, status: CardStatus) => deck.set(id, { ...deck.get(id)!, status });
  return { deck, cursor, set, scope };
}

describe('pure helpers', () => {
  it('isUndecided: unsorted always; waiting unless passed; held and skipped never', () => {
    const passed = new Set(['w2']);
    expect(isUndecided(card('u', 'unsorted'), passed)).toBe(true);
    expect(isUndecided(card('w1', 'waiting'), passed)).toBe(true);
    expect(isUndecided(card('w2', 'waiting'), passed)).toBe(false);
    expect(isUndecided(card('h', 'held'), passed)).toBe(false);
    expect(isUndecided(card('s', 'skipped'), passed)).toBe(false);
    expect(isUndecided(undefined, passed)).toBe(false);
  });

  it('nextUndecided wraps, skips fromId, and falls back to the top when fromId is absent', () => {
    const ids = ['a', 'b', 'c', 'd'];
    const open = new Set(['a', 'c']);
    const pred = (id: string) => open.has(id);
    expect(nextUndecided(ids, 'a', pred)).toBe('c');
    expect(nextUndecided(ids, 'c', pred)).toBe('a');
    expect(nextUndecided(ids, 'gone', pred)).toBe('a');
    expect(nextUndecided(ids, null, pred)).toBe('a');
    expect(nextUndecided(ids, 'a', (id) => id === 'a')).toBeNull();
    expect(nextUndecided([], null, pred)).toBeNull();
  });

  it('pileView covers every status, with and without picking', () => {
    expect(pileView('unsorted', false)).toBe('sort');
    expect(pileView('unsorted', true)).toBe('pick');
    expect(pileView('waiting', false)).toBe('pick');
    expect(pileView('waiting', true)).toBe('pick');
    expect(pileView('held', false)).toBe('held');
    expect(pileView('held', true)).toBe('pick');
    expect(pileView('skipped', false)).toBe('skipped');
    expect(pileView('skipped', true)).toBe('skipped');
  });
});

describe('usePileCursor', () => {
  it('orders the queue by category and reports the position within the category', () => {
    const { cursor } = setup([
      card('kid1', 'unsorted', 'kids'),
      card('home1', 'unsorted', 'home'),
      card('home2', 'unsorted', 'home'),
    ]);
    expect(cursor.ready.value).toBe(false);
    cursor.load(['kid1', 'home1', 'home2']);
    expect(cursor.ready.value).toBe(true);
    const first = cursor.ordered.value[0]!.id;
    expect(cursor.currentId.value).toBe(first);
    cursor.jumpTo('home2');
    expect(cursor.position.value).toEqual({ category: 'home', n: 2, total: 2 });
    expect(cursor.total.value).toBe(3);
  });

  it('step clamps at both ends and includes decided cards', () => {
    const { cursor } = setup([card('a', 'unsorted'), card('b', 'held'), card('c', 'unsorted')]);
    cursor.load(['a', 'b', 'c']);
    expect(cursor.currentId.value).toBe('a');
    expect(cursor.canStep(-1)).toBe(false);
    cursor.step(-1);
    expect(cursor.currentId.value).toBe('a');
    cursor.step(1);
    expect(cursor.currentId.value).toBe('b');
    cursor.step(1);
    expect(cursor.canStep(1)).toBe(false);
    cursor.step(1);
    expect(cursor.currentId.value).toBe('c');
  });

  it('load with a startId opens that card, adding it to the queue when out of scope', () => {
    const { cursor } = setup([card('a', 'waiting'), card('b', 'waiting'), card('h', 'held')]);
    cursor.load(['a', 'b'], 'b');
    expect(cursor.currentId.value).toBe('b');
    cursor.jumpTo('h');
    expect(cursor.currentId.value).toBe('h');
    expect(cursor.total.value).toBe(3);
    expect(cursor.position.value?.total).toBe(3);
  });

  it('settle advance moves to the next undecided card, wrapping, then to the done state', () => {
    const { cursor, set } = setup([card('a', 'unsorted'), card('b', 'unsorted')]);
    cursor.load(['a', 'b']);
    cursor.step(1);
    set('b', 'held');
    cursor.settle('b', 'advance');
    expect(cursor.currentId.value).toBe('a');
    expect(cursor.remaining.value).toBe(1);
    set('a', 'skipped');
    cursor.settle('a', 'advance');
    expect(cursor.currentId.value).toBeNull();
    expect(cursor.position.value).toBeNull();
    expect(cursor.canStep(1)).toBe(false);
  });

  it('settle stay keeps a revisited card on screen with its new status', () => {
    const { cursor, set } = setup([card('a', 'held'), card('b', 'unsorted')]);
    cursor.load(['a', 'b'], 'a');
    set('a', 'skipped');
    cursor.settle('a', 'stay');
    expect(cursor.currentId.value).toBe('a');
  });

  it('settle keeps a card that is still undecided (Undo mid-flight, or an open split part)', () => {
    const { cursor, set } = setup([card('a', 'unsorted'), card('b', 'unsorted')]);
    cursor.load(['a', 'b']);
    // The deal landed and was undone before the flight finished: still unsorted.
    cursor.settle('a', 'advance');
    expect(cursor.currentId.value).toBe('a');
    // A split card with another open part is waiting, not passed: still undecided.
    set('a', 'waiting');
    cursor.settle('a', 'advance');
    expect(cursor.currentId.value).toBe('a');
  });

  it('settle leaves the cursor alone when an Undo moved it mid-flight', () => {
    const { cursor, set } = setup([card('a', 'unsorted'), card('b', 'unsorted')]);
    cursor.load(['a', 'b']);
    cursor.jumpTo('b');
    set('a', 'held');
    cursor.settle('a', 'advance');
    expect(cursor.currentId.value).toBe('b');
  });

  it('a first-deal Decide later (kept, now waiting) is passed and does not stick', () => {
    const { cursor, set } = setup([card('a', 'unsorted'), card('b', 'unsorted')]);
    cursor.load(['a', 'b']);
    set('a', 'waiting');
    cursor.pass('a');
    cursor.settle('a', 'advance');
    expect(cursor.currentId.value).toBe('b');
    expect(cursor.remaining.value).toBe(1);
  });

  it('a deleted current card falls back to the first undecided card', () => {
    const { cursor, deck } = setup([
      card('a', 'unsorted'),
      card('b', 'unsorted'),
      card('c', 'unsorted'),
    ]);
    cursor.load(['a', 'b', 'c']);
    cursor.step(1);
    deck.delete('b');
    expect(cursor.current.value).toBeUndefined();
    cursor.settle('b', 'advance');
    expect(cursor.currentId.value).toBe('a');
    expect(cursor.total.value).toBe(2);
  });

  it('nextToDecide names where "Back to" goes, and is null with nothing left', () => {
    const { cursor, set } = setup([card('a', 'held'), card('b', 'unsorted')]);
    cursor.load(['a', 'b'], 'a');
    expect(cursor.nextToDecide.value).toBe('b');
    set('b', 'held');
    expect(cursor.nextToDecide.value).toBeNull();
  });
});

describe('usePileCursor with the deck order', () => {
  it('a card jumped to takes its natural place, not the end of the pile', () => {
    const deck = reactive(
      new Map([
        ['a', card('a', 'held')],
        ['b', card('b', 'unsorted')],
      ])
    );
    const scope = effectScope();
    const cursor = scope.run(() =>
      usePileCursor({ cardById: (id) => deck.get(id), order: () => ['a', 'b'] })
    )!;
    cursor.load(['b']);
    cursor.jumpTo('a');
    expect(cursor.position.value).toEqual({ category: 'home', n: 1, total: 2 });
    cursor.step(1);
    expect(cursor.currentId.value).toBe('b');
    scope.stop();
  });
});
