import { describe, expect, it } from 'vitest';
import {
  RESPONSIBILITY_CARDS,
  CARD_DEFAULTS,
  cardUsesFor,
  getResponsibilityCard,
  type ResponsibilityCardDef,
} from '@/constants/responsibilityCards';
import { LIST_TEMPLATES } from '@/constants/listTemplates';
import { LIST_CATEGORIES } from '@/constants/listCategories';
import { HELPFUL_HINT_TYPES } from '@/utils/helpfulHints';
import { UI_STRINGS, BEANIE_STRINGS } from '@/services/translation/uiStrings';
import {
  buildCardBriefingRows,
  buildCheckInAgenda,
  categoryCoverage,
  checkInAnchor,
  deckStats,
  defaultHolderFor,
  groupByCategory,
  groupShortcut,
  isCheckInDue,
  isRedeal,
  isUndealtDeck,
  keptAndSkipped,
  latestCheckIn,
  nextCheckInDate,
  otherHumans,
  recentMoves,
  resolveDeck,
  singleHolderOf,
  type CardBriefingInput,
  type ResolvedCard,
} from '@/utils/responsibilityDeck';
import type {
  FamilyMember,
  ListCategory,
  ResponsibilityCardState,
  ResponsibilityCheckIn,
  ResponsibilityMove,
} from '@/types/models';

// ── fixtures ────────────────────────────────────────────────────────────────────

/** Local noon of a ymd as an ISO timestamp, so date maths holds in every timezone. */
function noon(ymd: string): string {
  return new Date(`${ymd}T12:00:00`).toISOString();
}

function member(id: string, over: Partial<FamilyMember> = {}): FamilyMember {
  return {
    id,
    name: id,
    email: `${id}@x.test`,
    gender: 'other',
    ageGroup: 'adult',
    role: 'member',
    color: '#000',
    createdAt: noon('2026-01-01'),
    updatedAt: noon('2026-01-01'),
    ...over,
  } as FamilyMember;
}

const greg = member('greg', { role: 'owner' });
const sofia = member('sofia');
const leo = member('leo', { ageGroup: 'child' });
const mia = member('mia', { ageGroup: 'child' });
const rex = member('rex', { isPet: true, ageGroup: 'child' });
const FAMILY = [greg, sofia, leo, mia, rex];

const DEFS: ResponsibilityCardDef[] = [
  {
    id: 'laundry',
    category: 'home',
    emoji: '🧺',
    nameKey: 'cards.laundry.name',
    doneKey: 'cards.laundry.done',
  },
  {
    id: 'dishes',
    category: 'home',
    emoji: '🍽️',
    nameKey: 'cards.dishes.name',
    doneKey: 'cards.dishes.done',
  },
  {
    id: 'lunchboxes',
    category: 'kids',
    emoji: '🥪',
    nameKey: 'cards.lunchboxes.name',
    doneKey: 'cards.lunchboxes.done',
    splitHint: 'child',
  },
  {
    id: 'car-care',
    category: 'out',
    emoji: '🚗',
    nameKey: 'cards.carCare.name',
    doneKey: 'cards.carCare.done',
    group: 'car',
  },
  {
    id: 'bikes',
    category: 'projects',
    emoji: '🚲',
    nameKey: 'cards.bikes.name',
    doneKey: 'cards.bikes.done',
    group: 'car',
  },
];

const T0 = noon('2026-06-01');

function state(id: string, over: Partial<ResponsibilityCardState> = {}): ResponsibilityCardState {
  return {
    id,
    status: 'kept',
    splitMode: 'single',
    parts: [{ key: 'main' }],
    createdAt: T0,
    updatedAt: T0,
    ...over,
  };
}

function move(over: Partial<ResponsibilityMove> & { cardId: string }): ResponsibilityMove {
  const at = over.at ?? noon('2026-09-20');
  const partKey = over.partKey ?? 'main';
  return { id: `${over.cardId}:${partKey}:${at}`, partKey, at, ...over };
}

function resolve(
  states: unknown[],
  moves: ResponsibilityMove[] = [],
  members: FamilyMember[] = FAMILY
) {
  return resolveDeck(DEFS, states, moves, members);
}

function card(cards: ResolvedCard[], id: string): ResolvedCard {
  const c = cards.find((x) => x.id === id);
  if (!c) throw new Error(`no card ${id}`);
  return c;
}

// ── resolveDeck ─────────────────────────────────────────────────────────────────

describe('resolveDeck', () => {
  it('derives all four statuses', () => {
    const { cards } = resolve([
      state('laundry', { parts: [{ key: 'main', holderId: 'greg' }] }),
      state('dishes'),
      state('car-care', { status: 'skipped' }),
    ]);
    expect(card(cards, 'laundry').status).toBe('held');
    expect(card(cards, 'dishes').status).toBe('waiting');
    expect(card(cards, 'car-care').status).toBe('skipped');
    expect(card(cards, 'bikes').status).toBe('unsorted');
    expect(card(cards, 'bikes').parts).toEqual([{ key: 'main' }]);
    expect(card(cards, 'bikes').state).toBeNull();
  });

  it('treats a removed member or a pet as nobody', () => {
    const { cards } = resolve([
      state('laundry', { parts: [{ key: 'main', holderId: 'gone' }] }),
      state('dishes', { parts: [{ key: 'main', holderId: 'rex' }] }),
    ]);
    expect(card(cards, 'laundry').status).toBe('waiting');
    expect(card(cards, 'laundry').parts[0]!.holderId).toBeUndefined();
    expect(card(cards, 'dishes').status).toBe('waiting');
  });

  it('children may hold cards', () => {
    const { cards } = resolve([state('dishes', { parts: [{ key: 'main', holderId: 'leo' }] })]);
    expect(card(cards, 'dishes').status).toBe('held');
  });

  it('rebuilds a child split from the current children', () => {
    const s = state('lunchboxes', {
      splitMode: 'child',
      parts: [
        { key: 'leo', holderId: 'greg' },
        { key: 'mia', holderId: 'sofia' },
      ],
    });
    // Held while both children have a holder.
    expect(card(resolve([s]).cards, 'lunchboxes').status).toBe('held');

    // A new child gets a new part with nobody → waiting.
    const ava = member('ava', { ageGroup: 'child' });
    const withAva = card(resolve([s], [], [...FAMILY, ava]).cards, 'lunchboxes');
    expect(withAva.parts.map((p) => p.key)).toEqual(['leo', 'mia', 'ava']);
    expect(withAva.parts[2]!.holderId).toBeUndefined();
    expect(withAva.status).toBe('waiting');

    // A removed child's part disappears; the rest keep their holders.
    const noMia = card(resolve([s], [], [greg, sofia, leo]).cards, 'lunchboxes');
    expect(noMia.parts).toEqual([{ key: 'leo', holderId: 'greg' }]);
    expect(noMia.status).toBe('held');
  });

  it('degrades a child split with no children left to a single card with nobody', () => {
    const s = state('lunchboxes', {
      splitMode: 'child',
      parts: [{ key: 'leo', holderId: 'greg' }],
    });
    const c = card(resolve([s], [], [greg, sofia]).cards, 'lunchboxes');
    expect(c.splitMode).toBe('single');
    expect(c.parts).toEqual([{ key: 'main' }]);
    expect(c.status).toBe('waiting');
  });

  it('keeps label parts as stored', () => {
    const s = state('dishes', {
      splitMode: 'label',
      parts: [
        { key: 'label-1', label: 'upstairs', holderId: 'greg' },
        { key: 'label-2', label: 'downstairs' },
      ],
    });
    const c = card(resolve([s]).cards, 'dishes');
    expect(c.parts.map((p) => p.label)).toEqual(['upstairs', 'downstairs']);
    expect(c.status).toBe('waiting');
  });

  it('resolves custom cards and returns unknown ids', () => {
    const { cards, unknownIds, invalidIds } = resolve([
      state('custom-1', { custom: { name: 'Chickens', emoji: '🐔', category: 'home' } }),
      state('from-the-future'),
    ]);
    const c = card(cards, 'custom-1');
    expect(c.isCustom).toBe(true);
    expect(c.emoji).toBe('🐔');
    expect(c.category).toBe('home');
    expect(unknownIds).toEqual(['from-the-future']);
    expect(invalidIds).toEqual([]);
    expect(cards.some((x) => x.id === 'from-the-future')).toBe(false);
  });

  it('treats a malformed record as unsorted and returns it in invalidIds', () => {
    const { cards, invalidIds } = resolve([
      { id: 'laundry', status: 'kept', splitMode: 'single', parts: 'nope' },
      { id: 'dishes', status: 'weird', splitMode: 'single', parts: [] },
      { id: 'custom-2', status: 'kept', splitMode: 'single', parts: [] }, // no `custom`
      null,
    ]);
    expect(card(cards, 'laundry').status).toBe('unsorted');
    expect(card(cards, 'dishes').status).toBe('unsorted');
    expect(invalidIds).toEqual(['laundry', 'dishes', 'custom-2', '']);
  });

  it('derives since and previous holder from the latest move TO the current holder', () => {
    const moves = [
      move({ cardId: 'laundry', toId: 'sofia', at: noon('2026-09-01') }),
      move({ cardId: 'laundry', fromId: 'sofia', toId: 'greg', at: noon('2026-09-10') }),
      // Superseded: a concurrent write lost, so `leo` never held it.
      move({ cardId: 'laundry', fromId: 'greg', toId: 'leo', at: noon('2026-09-12') }),
    ];
    const { cards } = resolve(
      [state('laundry', { parts: [{ key: 'main', holderId: 'greg' }] })],
      moves
    );
    const part = card(cards, 'laundry').parts[0]!;
    expect(part.since).toBe(noon('2026-09-10'));
    expect(part.previousHolderId).toBe('sofia');
  });

  it('drops a previous holder who has left the family', () => {
    const moves = [
      move({ cardId: 'laundry', fromId: 'gone', toId: 'greg', at: noon('2026-09-10') }),
    ];
    const { cards } = resolve(
      [state('laundry', { parts: [{ key: 'main', holderId: 'greg' }] })],
      moves
    );
    expect(card(cards, 'laundry').parts[0]!.previousHolderId).toBeUndefined();
    expect(card(cards, 'laundry').parts[0]!.since).toBe(noon('2026-09-10'));
  });
});

// ── stats, coverage, holders ────────────────────────────────────────────────────

describe('deckStats / categoryCoverage', () => {
  const { cards } = resolve([
    state('laundry', { parts: [{ key: 'main', holderId: 'greg' }] }),
    state('dishes', { parts: [{ key: 'main', holderId: 'sofia' }] }),
    state('lunchboxes', {
      splitMode: 'child',
      parts: [{ key: 'leo', holderId: 'greg' }, { key: 'mia' }],
    }),
    state('car-care', { status: 'skipped' }),
  ]);

  it('counts every state and split cards in the deck', () => {
    expect(deckStats(cards)).toEqual({
      total: 5,
      deck: 3,
      held: 2,
      waiting: 1,
      skipped: 1,
      unsorted: 1,
      splitCount: 1,
    });
  });

  it('reports coverage per category in category order, faces without counts', () => {
    expect(categoryCoverage(cards)).toEqual([
      { category: 'home', deck: 2, held: 2, waiting: 0, holderIds: ['greg', 'sofia'] },
      { category: 'kids', deck: 1, held: 0, waiting: 1, holderIds: ['greg'] },
    ]);
  });

  it('singleHolderOf is undefined for split, waiting, skipped and unknown cards', () => {
    expect(singleHolderOf(cards, 'laundry')).toBe('greg');
    expect(singleHolderOf(cards, 'lunchboxes')).toBeUndefined();
    expect(singleHolderOf(cards, 'car-care')).toBeUndefined();
    expect(singleHolderOf(cards, 'bikes')).toBeUndefined();
    expect(singleHolderOf(cards, 'nope')).toBeUndefined();
  });

  it('a label split with every part held is not a single holder', () => {
    const r = resolve([
      state('dishes', {
        splitMode: 'label',
        parts: [
          { key: 'a', label: 'up', holderId: 'greg' },
          { key: 'b', label: 'down', holderId: 'greg' },
        ],
      }),
    ]);
    expect(card(r.cards, 'dishes').status).toBe('held');
    expect(singleHolderOf(r.cards, 'dishes')).toBeUndefined();
  });

  it('defaultHolderFor maps a target through CARD_DEFAULTS to the single holder', () => {
    const real = resolveDeck(
      RESPONSIBILITY_CARDS,
      [state('cooking-dinner', { parts: [{ key: 'main', holderId: 'sofia' }] })],
      [],
      FAMILY
    ).cards;
    expect(defaultHolderFor(real, { kind: 'mealSlot', slot: 'dinner' })).toEqual({
      memberId: 'sofia',
      cardId: 'cooking-dinner',
    });
    expect(defaultHolderFor(real, { kind: 'mealSlot', slot: 'breakfast' })).toBeNull();
    expect(defaultHolderFor(real, { kind: 'mealSlot', slot: 'lunch' })).toBeNull();
    expect(defaultHolderFor(real, { kind: 'listTemplate', key: 'honey-do' })).toBeNull();
    expect(defaultHolderFor(real, { kind: 'listTemplate', key: 'toString' })).toBeNull();
  });
});

// ── recent moves ────────────────────────────────────────────────────────────────

describe('recentMoves', () => {
  const TODAY = '2026-09-26';
  it('lists re-deals, custom cards, skips, splits and check-ins, newest first, capped', () => {
    const states = [
      state('laundry', { parts: [{ key: 'main', holderId: 'greg' }] }),
      state('car-care', { status: 'skipped', updatedAt: noon('2026-09-22') }),
      state('lunchboxes', { splitMode: 'child', updatedAt: noon('2026-09-23') }),
      state('custom-1', {
        custom: { name: 'x', emoji: 'x', category: 'home' },
        createdAt: noon('2026-09-24'),
      }),
    ];
    const moves = [
      move({ cardId: 'laundry', fromId: 'sofia', toId: 'greg', at: noon('2026-09-25') }),
      move({ cardId: 'laundry', toId: 'sofia', at: noon('2026-09-21') }), // first deal
      move({ cardId: 'laundry', fromId: 'greg', toId: 'sofia', at: noon('2026-07-01') }), // old
    ];
    const checkIns: ResponsibilityCheckIn[] = [
      {
        id: '2026-09-20',
        completedAt: noon('2026-09-20'),
        stillWorks: 1,
        talkAbout: 0,
        redealt: 0,
        dealtNow: 0,
      },
    ];
    const items = recentMoves(moves, checkIns, states, TODAY);
    expect(items.map((i) => i.kind)).toEqual(['redeal', 'custom', 'split', 'skip', 'checkin']);
    expect(recentMoves(moves, checkIns, states, TODAY, 2)).toHaveLength(2);
  });
});

// ── check-in ────────────────────────────────────────────────────────────────────

describe('check-in rhythm', () => {
  const ci = (id: string, kind?: 'start' | 'checkin'): ResponsibilityCheckIn => ({
    id,
    ...(kind ? { kind } : {}),
    completedAt: noon(id),
    stillWorks: 0,
    talkAbout: 0,
    redealt: 0,
    dealtNow: 0,
  });
  const started = [ci('2026-08-01', 'start')];
  /** A deck with something kept in it, so the clock runs. */
  const KEPT = resolve([state('laundry')]).cards;

  it('is never due when off or before the cycle has started', () => {
    expect(nextCheckInDate(0, started, KEPT)).toBeNull();
    expect(isCheckInDue(0, [ci('2026-01-01')], KEPT, '2026-12-01')).toBe(false);
    expect(isCheckInDue(4, [], KEPT, '2026-12-01')).toBe(false);
  });

  it.each([
    [2, '2026-08-15', '2026-08-14'],
    [4, '2026-08-29', '2026-08-28'],
    [8, '2026-09-26', '2026-09-25'],
  ])('the first check-in is due %i weeks after the cycle start', (weeks, due, dayBefore) => {
    expect(nextCheckInDate(weeks, started, KEPT)).toBe(due);
    expect(isCheckInDue(weeks, started, KEPT, dayBefore)).toBe(false);
    expect(isCheckInDue(weeks, started, KEPT, due)).toBe(true);
  });

  it('later check-ins count from the latest record of either kind', () => {
    const checkIns = [...started, ci('2026-09-01'), ci('2026-09-10', 'checkin')];
    expect(nextCheckInDate(2, checkIns, KEPT)).toBe('2026-09-24');
    expect(isCheckInDue(2, checkIns, KEPT, '2026-09-23')).toBe(false);
    expect(isCheckInDue(2, checkIns, KEPT, '2026-09-24')).toBe(true);
  });

  it('a new cycle start (after a restore) restarts the clock past an old check-in', () => {
    const checkIns = [ci('2026-05-01', 'start'), ci('2026-06-01'), ci('2026-09-20', 'start')];
    expect(nextCheckInDate(4, checkIns, KEPT)).toBe('2026-10-18');
    expect(isCheckInDue(4, checkIns, KEPT, '2026-09-26')).toBe(false);
    expect(checkInAnchor(checkIns)!.id).toBe('2026-09-20');
  });

  it('the last check-in shown is never a cycle start; records without kind are check-ins', () => {
    const checkIns = [ci('2026-06-01'), ci('2026-09-20', 'start')];
    expect(latestCheckIn(checkIns)!.id).toBe('2026-06-01');
    expect(latestCheckIn(started)).toBeUndefined();
  });

  it('is never due, and has no next date, when the deck has nothing kept in it', () => {
    const due = '2026-08-29';
    // Restore defaults / everything skipped / the first keep undone.
    const empty = resolve([state('laundry', { status: 'skipped' })]).cards;
    expect(nextCheckInDate(4, started, empty)).toBeNull();
    expect(isCheckInDue(4, started, empty, due)).toBe(false);
    expect(nextCheckInDate(4, started, [])).toBeNull();
    // A family-made card nobody holds does not count either (`countsTowardCycle`).
    const unheldCustom = resolve([
      state('custom-swim', { custom: { name: 'Swim', emoji: '🏊', category: 'kids' } }),
    ]).cards;
    expect(unheldCustom.filter((c) => c.isCustom).map((c) => c.status)).toEqual(['waiting']);
    expect(isCheckInDue(4, started, unheldCustom, due)).toBe(false);
    expect(isCheckInDue(4, started, KEPT, due)).toBe(true);
  });

  it('skips malformed records instead of throwing', () => {
    const bad = [null, { id: 'x' }, { id: 'y', completedAt: 7 }, 'nope', ...started];
    expect(() => nextCheckInDate(4, bad, KEPT)).not.toThrow();
    expect(nextCheckInDate(4, bad, KEPT)).toBe('2026-08-29');
    expect(latestCheckIn([{ id: 'x' }])).toBeUndefined();
    expect(recentMoves([], bad as ResponsibilityCheckIn[], [], '2026-08-02')).toEqual([]);
  });

  it('isUndealtDeck: kept built-ins and held custom cards count; waiting custom cards do not', () => {
    expect(isUndealtDeck(resolve([]).cards)).toBe(true);
    expect(isUndealtDeck(resolve([state('laundry', { status: 'skipped' })]).cards)).toBe(true);
    expect(isUndealtDeck(resolve([state('laundry')]).cards)).toBe(false); // decide later
    const custom = (holderId?: string) =>
      state('custom-hens', {
        custom: { name: 'Hens', emoji: '🐔', category: 'home' },
        parts: [{ key: 'main', ...(holderId ? { holderId } : {}) }],
      });
    expect(isUndealtDeck(resolve([custom()]).cards)).toBe(true); // kept through a restore
    expect(isUndealtDeck(resolve([custom('greg')]).cards)).toBe(false);
  });
});

describe('buildCheckInAgenda', () => {
  const TODAY = '2026-09-26';
  it('selects nobody, moved-since-last and up to 3 long-unchanged cards', () => {
    const states = [
      state('laundry', { parts: [{ key: 'main', holderId: 'greg' }] }),
      state('dishes', { parts: [{ key: 'main', holderId: 'sofia' }] }),
      state('bikes', {
        parts: [{ key: 'main', holderId: 'sofia' }],
        createdAt: noon('2026-01-01'),
      }),
      state('car-care', {
        parts: [{ key: 'main', holderId: 'greg' }],
        createdAt: noon('2026-09-01'),
      }),
      state('lunchboxes', { splitMode: 'child', parts: [] }),
    ];
    const moves = [
      move({ cardId: 'laundry', fromId: 'sofia', toId: 'greg', at: noon('2026-09-15') }),
      // Before the last check-in: not "moved since".
      move({ cardId: 'dishes', fromId: 'greg', toId: 'sofia', at: noon('2026-03-01') }),
      // Superseded (greg does not hold dishes): ignored.
      move({ cardId: 'dishes', fromId: 'sofia', toId: 'greg', at: noon('2026-09-16') }),
    ];
    const { cards } = resolve(states, moves);
    const last: ResponsibilityCheckIn = {
      id: '2026-09-01',
      completedAt: noon('2026-09-01'),
      stillWorks: 0,
      talkAbout: 0,
      redealt: 0,
      dealtNow: 0,
    };
    const agenda = buildCheckInAgenda(cards, moves, last, TODAY);
    expect(agenda.nobody.map((c) => c.id)).toEqual(['lunchboxes']);
    expect(agenda.moved.map((m) => m.card.id)).toEqual(['laundry']);
    // bikes (Jan, never moved) and dishes (moved in March) are 90+ days unchanged, oldest
    // first; car-care (Sep) is too recent.
    expect(agenda.unchanged.map((c) => c.id)).toEqual(['bikes', 'dishes']);
  });
});

describe('groupShortcut', () => {
  it('offers the group only while more than one of it is unsorted', () => {
    const r1 = resolve([]);
    expect(groupShortcut(r1.cards, card(r1.cards, 'car-care'))).toEqual({
      group: 'car',
      unsortedIds: ['car-care', 'bikes'],
    });
    expect(groupShortcut(r1.cards, card(r1.cards, 'laundry'))).toBeNull();
    const r2 = resolve([state('bikes', { status: 'skipped' })]);
    expect(groupShortcut(r2.cards, card(r2.cards, 'car-care'))).toBeNull();
  });
});

describe('groupByCategory', () => {
  it('groups in LIST_CATEGORIES order, keeps card order, and puts unknown categories last', () => {
    const { cards } = resolve([]);
    const stray = { ...card(cards, 'laundry'), id: 'x', category: 'future' as ListCategory };
    const groups = groupByCategory([card(cards, 'bikes'), stray, ...cards]);
    const order = LIST_CATEGORIES.map((c) => c.id as string);
    const cats = groups.map((g) => g.category);
    expect(cats.at(-1)).toBeNull();
    const known = cats.filter((c): c is ListCategory => c !== null);
    expect(known).toEqual([...known].sort((a, b) => order.indexOf(a) - order.indexOf(b)));
    expect(groups.find((g) => g.category === 'home')!.cards.map((c) => c.id)).toEqual([
      'laundry',
      'dishes',
    ]);
    expect(groups.at(-1)!.cards.map((c) => c.id)).toEqual(['x']);
  });
});

// ── briefing ────────────────────────────────────────────────────────────────────

describe('buildCardBriefingRows', () => {
  const TODAY = '2026-09-26';
  const baseStates = [
    state('laundry', {
      parts: [{ key: 'main', holderId: 'greg' }],
      createdAt: noon('2026-08-01'),
    }),
    state('dishes', { createdAt: noon('2026-08-05') }),
  ];

  function input(over: Partial<CardBriefingInput> = {}, moves: ResponsibilityMove[] = []) {
    const { cards } = resolve(baseStates, moves);
    return {
      cards,
      moves,
      checkIns: [],
      rhythmWeeks: 0,
      readState: {},
      viewerId: 'greg',
      viewerIsAdult: true,
      today: TODAY,
      ...over,
    } satisfies CardBriefingInput;
  }

  it('shows the viewer their cards and adults the cards with nobody', () => {
    const rows = buildCardBriefingRows(input());
    expect(rows).toEqual([
      { kind: 'mine', cardIds: ['laundry'] },
      { kind: 'nobody', cardIds: ['dishes'], count: 1 },
    ]);
  });

  it('never shows nobody or check-in rows to a child', () => {
    const rows = buildCardBriefingRows(
      input({ viewerId: 'leo', viewerIsAdult: false, rhythmWeeks: 2 })
    );
    expect(rows).toEqual([]);
  });

  it('first deals and clears produce no moved note; re-deals do, for both sides', () => {
    const moves = [
      move({ cardId: 'laundry', toId: 'greg', byId: 'sofia', at: noon('2026-09-20') }),
      move({
        cardId: 'laundry',
        fromId: 'sofia',
        toId: 'greg',
        byId: 'sofia',
        at: noon('2026-09-21'),
      }),
    ];
    expect(isRedeal(moves[0]!)).toBe(false);
    const toGreg = buildCardBriefingRows(input({}, moves)).filter((r) => r.kind === 'moved');
    expect(toGreg).toHaveLength(1);
    expect(toGreg[0]).toMatchObject({ role: 'to', dismissKey: `card-move:${moves[1]!.id}` });

    const forSofia = buildCardBriefingRows(input({ viewerId: 'mia' }, moves)).filter(
      (r) => r.kind === 'moved'
    );
    expect(forSofia).toEqual([]); // mia is on neither side
  });

  it('never shows the actor a note for their own move', () => {
    const moves = [
      move({
        cardId: 'laundry',
        fromId: 'sofia',
        toId: 'greg',
        byId: 'greg',
        at: noon('2026-09-21'),
      }),
    ];
    expect(buildCardBriefingRows(input({}, moves)).some((r) => r.kind === 'moved')).toBe(false);
  });

  it('hides superseded, dismissed and old notes, and caps at the 3 newest', () => {
    const redeal = (day: number, from = 'sofia', to = 'greg') =>
      move({
        cardId: 'laundry',
        fromId: from,
        toId: to,
        byId: 'sofia',
        at: noon(`2026-09-${String(day).padStart(2, '0')}`),
      });
    const superseded = redeal(25, 'greg', 'leo'); // leo does not hold it
    const old = redeal(1);
    const dismissed = redeal(24);
    const moves = [redeal(20), redeal(21), redeal(22), redeal(23), dismissed, superseded, old];
    const rows = buildCardBriefingRows(
      input({ readState: { [`card-move:${dismissed.id}`]: noon('2026-09-24') } }, moves)
    ).filter((r) => r.kind === 'moved');
    expect(rows.map((r) => (r.kind === 'moved' ? r.move.at.slice(8, 10) : ''))).toEqual([
      '23',
      '22',
      '21',
    ]);
  });

  it('shows the check-in row from the due date, snoozable for 7 days', () => {
    // Cycle started 2026-08-01, rhythm 4 weeks → due 2026-08-29.
    const start: ResponsibilityCheckIn = {
      id: 'start',
      kind: 'start',
      completedAt: noon('2026-08-01'),
      stillWorks: 0,
      talkAbout: 0,
      redealt: 0,
      dealtNow: 0,
    };
    const on = (over: Partial<CardBriefingInput> = {}) => input({ checkIns: [start], ...over });
    const due = buildCardBriefingRows(on({ rhythmWeeks: 4 })).find((r) => r.kind === 'checkin');
    expect(due).toEqual({
      kind: 'checkin',
      dueDate: '2026-08-29',
      dismissKey: 'card-checkin:2026-08-29',
    });
    const snoozed = (readAt: string) =>
      buildCardBriefingRows(
        on({ rhythmWeeks: 4, readState: { 'card-checkin:2026-08-29': readAt } })
      ).some((r) => r.kind === 'checkin');
    expect(snoozed(noon('2026-09-22'))).toBe(false); // 4 days ago
    expect(snoozed(noon('2026-09-19'))).toBe(true); // 7 days ago → back
    // Nothing kept in the deck: no reminder, however overdue the clock is.
    const skippedAll = resolve(baseStates.map((st) => ({ ...st, status: 'skipped' }))).cards;
    expect(
      buildCardBriefingRows(on({ rhythmWeeks: 4, cards: skippedAll })).some(
        (r) => r.kind === 'checkin'
      )
    ).toBe(false);
    expect(
      buildCardBriefingRows(on({ rhythmWeeks: 4, today: '2026-08-28' })).some(
        (r) => r.kind === 'checkin'
      )
    ).toBe(false);
  });
});

// ── drift guards ────────────────────────────────────────────────────────────────

describe('deck drift guards', () => {
  it('card ids are unique and categories are real', () => {
    const ids = RESPONSIBILITY_CARDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    const cats = new Set(LIST_CATEGORIES.map((c) => c.id));
    for (const c of RESPONSIBILITY_CARDS) expect(cats.has(c.category), c.id).toBe(true);
    expect(RESPONSIBILITY_CARDS.length).toBe(81);
  });

  it('every card has en + beanie name and done keys, beanie all lowercase', () => {
    for (const c of RESPONSIBILITY_CARDS) {
      for (const key of [c.nameKey, c.doneKey]) {
        expect(UI_STRINGS[key], key).toBeTruthy();
        const beanie = BEANIE_STRINGS[key];
        expect(beanie, key).toBeTruthy();
        expect(beanie, key).toBe(beanie!.toLowerCase());
      }
      expect(UI_STRINGS[c.doneKey].endsWith('.'), c.doneKey).toBe(false);
    }
  });

  it('every CARD_DEFAULTS id exists in the deck', () => {
    const ids = [
      ...Object.values(CARD_DEFAULTS.mealSlot),
      ...Object.values(CARD_DEFAULTS.listTemplate),
      ...Object.values(CARD_DEFAULTS.hint),
    ];
    for (const id of ids) expect(getResponsibilityCard(id), id).toBeDefined();
  });

  it('every listTemplate key exists in LIST_TEMPLATES', () => {
    const keys = new Set(LIST_TEMPLATES.map((t) => t.key));
    for (const k of Object.keys(CARD_DEFAULTS.listTemplate)) expect(keys.has(k), k).toBe(true);
  });

  it('every hint key is a HelpfulHintType', () => {
    for (const k of Object.keys(CARD_DEFAULTS.hint))
      expect(HELPFUL_HINT_TYPES as string[]).toContain(k);
  });

  it('cardUsesFor derives the drawer lines from CARD_DEFAULTS', () => {
    expect(cardUsesFor('cooking-dinner')).toEqual([{ kind: 'mealSlot', slot: 'dinner' }]);
    expect(cardUsesFor('trip-packing')).toEqual([
      { kind: 'listTemplate', key: 'vacation-packing' },
      { kind: 'hint', hintType: 'trip-packing' },
    ]);
    expect(cardUsesFor('gifts-for-others')).toHaveLength(3);
    expect(cardUsesFor('dishes')).toEqual([]);
  });

  it('hero illustrations follow the /brand/cards/<id>.webp convention', () => {
    const heroes = RESPONSIBILITY_CARDS.filter((c) => c.illustration);
    expect(heroes).toHaveLength(10);
    for (const c of heroes) expect(c.illustration).toBe(`/brand/cards/${c.id}.webp`);
  });
});

// ── Deal pile helpers ───────────────────────────────────────────────────────────

describe('otherHumans', () => {
  it("drops the first part's holder, and keeps everyone when nobody holds it", () => {
    const { cards } = resolve([
      state('laundry', { parts: [{ key: 'main', holderId: 'sofia' }] }),
      state('dishes'),
    ]);
    expect(otherHumans(FAMILY, card(cards, 'laundry')).map((m) => m.id)).toEqual([
      'greg',
      'leo',
      'mia',
      'rex',
    ]);
    expect(otherHumans(FAMILY, card(cards, 'dishes'))).toHaveLength(FAMILY.length);
  });
});

describe('keptAndSkipped', () => {
  it('splits kept (held + waiting) from skipped, newest change first, unsorted in neither', () => {
    const { cards } = resolve([
      state('laundry', {
        parts: [{ key: 'main', holderId: 'sofia' }],
        updatedAt: noon('2026-09-01'),
      }),
      state('dishes', { updatedAt: noon('2026-09-03') }),
      state('car-care', { status: 'skipped', updatedAt: noon('2026-09-02') }),
      state('bikes', { status: 'skipped', updatedAt: noon('2026-09-04') }),
    ]);
    const { kept, skipped } = keptAndSkipped(cards);
    expect(kept.map((c) => c.id)).toEqual(['dishes', 'laundry']);
    expect(skipped.map((c) => c.id)).toEqual(['bikes', 'car-care']);
    expect([...kept, ...skipped].some((c) => c.id === 'lunchboxes')).toBe(false);
  });

  it('breaks updatedAt ties by category order, then id, so the order is stable', () => {
    const { cards } = resolve([
      state('lunchboxes', { parts: [{ key: 'main', holderId: 'greg' }] }),
      state('laundry', { parts: [{ key: 'main', holderId: 'greg' }] }),
      state('dishes', { parts: [{ key: 'main', holderId: 'greg' }] }),
    ]);
    const home = LIST_CATEGORIES.findIndex((c) => c.id === 'home');
    const kids = LIST_CATEGORIES.findIndex((c) => c.id === 'kids');
    const byCat =
      home < kids ? ['dishes', 'laundry', 'lunchboxes'] : ['lunchboxes', 'dishes', 'laundry'];
    expect(keptAndSkipped(cards).kept.map((c) => c.id)).toEqual(byCat);
  });
});
