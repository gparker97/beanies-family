import { describe, expect, it } from 'vitest';
import type { ResponsibilityCardDef } from '@/constants/responsibilityCards';
import { resolveDeck, type ResolvedCard } from '@/utils/responsibilityDeck';
import {
  buildBringBack,
  buildCheckIn,
  buildCreateCustom,
  buildDeal,
  buildDeleteCustom,
  buildKeep,
  buildRestoreDefaults,
  buildSaveCard,
  buildSkip,
  buildUndo,
  draftPartsForMode,
  moveId,
  withCycleStart,
  type DeckOp,
} from '@/utils/responsibilityOps';
import type { FamilyMember, ResponsibilityCardState, ResponsibilityMove } from '@/types/models';

function member(id: string, over: Partial<FamilyMember> = {}): FamilyMember {
  return { id, name: id, ageGroup: 'adult', role: 'member', ...over } as FamilyMember;
}
const FAMILY = [
  member('greg', { role: 'owner' }),
  member('sofia'),
  member('leo', { ageGroup: 'child' }),
  member('mia', { ageGroup: 'child' }),
];

const DEFS: ResponsibilityCardDef[] = ['laundry', 'dishes', 'bikes'].map((id) => ({
  id,
  category: 'home',
  emoji: '🧺',
  nameKey: 'cards.laundry.name',
  doneKey: 'cards.laundry.done',
}));

const T0 = '2026-09-01T10:00:00.000Z';
const NOW = '2026-09-26T10:00:00.000Z';

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

function resolved(states: unknown[], moves: ResponsibilityMove[] = []): ResolvedCard[] {
  return resolveDeck(DEFS, states, moves, FAMILY).cards;
}
function card(cards: ResolvedCard[], id: string): ResolvedCard {
  return cards.find((c) => c.id === id)!;
}
const setStates = (ops: DeckOp[]) =>
  ops.filter((o): o is Extract<DeckOp, { op: 'setState' }> => o.op === 'setState');
const setMoves = (ops: DeckOp[]) =>
  ops.filter((o): o is Extract<DeckOp, { op: 'setMove' }> => o.op === 'setMove');

describe('buildDeal', () => {
  it('keeps and deals an unsorted card in ONE op list with one undo', () => {
    const c = card(resolved([]), 'laundry');
    const r = buildDeal(c, 'main', 'greg', 'sofia', NOW);
    expect(setStates(r.ops)).toHaveLength(1);
    expect(setStates(r.ops)[0]!.state).toMatchObject({
      id: 'laundry',
      status: 'kept',
      splitMode: 'single',
      parts: [{ key: 'main', holderId: 'greg' }],
      createdBy: 'sofia',
      createdAt: NOW,
      updatedAt: NOW,
    });
    const [m] = setMoves(r.ops);
    expect(m!.move).toEqual({
      id: moveId('laundry', 'main', NOW),
      cardId: 'laundry',
      partKey: 'main',
      toId: 'greg',
      byId: 'sofia',
      at: NOW,
    });
    expect(r.undo).toEqual({
      action: 'deal',
      before: { laundry: null },
      afterUpdatedAt: { laundry: NOW },
      createdMoveIds: [m!.move.id],
      createdCheckInIds: [],
    });
    expect(r.telemetry[0]).toMatchObject({ message: 'card_dealt', context: { detail: 'first' } });
  });

  it('re-deal records from and to, and snapshots the prior record for undo', () => {
    const prior = state('laundry', { parts: [{ key: 'main', holderId: 'sofia' }] });
    const r = buildDeal(card(resolved([prior]), 'laundry'), 'main', 'greg', 'greg', NOW);
    expect(setMoves(r.ops)[0]!.move).toMatchObject({ fromId: 'sofia', toId: 'greg' });
    expect(r.undo!.before.laundry).toEqual(prior);
    expect(r.telemetry[0]!.context.detail).toBe('redeal');
    expect(setStates(r.ops)[0]!.state.createdAt).toBe(T0);
  });

  it('clearing to nobody records a move without a toId', () => {
    const prior = state('laundry', { parts: [{ key: 'main', holderId: 'sofia' }] });
    const r = buildDeal(card(resolved([prior]), 'laundry'), 'main', null, 'greg', NOW);
    expect(setStates(r.ops)[0]!.state.parts).toEqual([{ key: 'main' }]);
    expect(setMoves(r.ops)[0]!.move.toId).toBeUndefined();
    expect(r.telemetry[0]!.context.detail).toBe('clear');
  });

  it('dealing to the current holder of a kept card changes nothing', () => {
    const prior = state('laundry', { parts: [{ key: 'main', holderId: 'sofia' }] });
    expect(buildDeal(card(resolved([prior]), 'laundry'), 'main', 'sofia', 'greg', NOW).ops).toEqual(
      []
    );
  });

  it('deals one part of a child split', () => {
    const prior = state('laundry', {
      splitMode: 'child',
      parts: [{ key: 'leo', holderId: 'greg' }, { key: 'mia' }],
    });
    const r = buildDeal(card(resolved([prior]), 'laundry'), 'mia', 'sofia', 'greg', NOW);
    expect(setStates(r.ops)[0]!.state.parts).toEqual([
      { key: 'leo', holderId: 'greg' },
      { key: 'mia', holderId: 'sofia' },
    ]);
    expect(setMoves(r.ops)[0]!.move.partKey).toBe('mia');
  });

  it('throws on an unknown part', () => {
    expect(() => buildDeal(card(resolved([]), 'laundry'), 'nope', 'greg', 'greg', NOW)).toThrow();
  });
});

describe('buildKeep / buildSkip / buildBringBack', () => {
  it('keep makes an unsorted card waiting; a kept card is a no-op', () => {
    const r = buildKeep(card(resolved([]), 'laundry'), 'greg', NOW);
    expect(setStates(r.ops)[0]!.state).toMatchObject({ status: 'kept', parts: [{ key: 'main' }] });
    expect(r.undo!.action).toBe('keep');
    expect(buildKeep(card(resolved([state('laundry')]), 'laundry'), 'greg', NOW).ops).toEqual([]);
  });

  it('skips a group in one op list, keeping holders, with one token over every card', () => {
    const cards = resolved([
      state('dishes', { parts: [{ key: 'main', holderId: 'greg' }] }),
      state('bikes', { status: 'skipped' }),
    ]);
    const r = buildSkip(
      [card(cards, 'laundry'), card(cards, 'dishes'), card(cards, 'bikes')],
      'greg',
      NOW
    );
    expect(setStates(r.ops).map((o) => [o.state.id, o.state.status])).toEqual([
      ['laundry', 'skipped'],
      ['dishes', 'skipped'],
    ]);
    expect(setStates(r.ops)[1]!.state.parts).toEqual([{ key: 'main', holderId: 'greg' }]);
    expect(Object.keys(r.undo!.before)).toEqual(['laundry', 'dishes']);
    expect(r.telemetry[0]!.context).toEqual({ count: 2, detail: 'group' });
  });

  it('bring back returns a skipped card to the deck', () => {
    const cards = resolved([state('bikes', { status: 'skipped' })]);
    const r = buildBringBack(card(cards, 'bikes'), 'greg', NOW);
    expect(setStates(r.ops)[0]!.state.status).toBe('kept');
    expect(r.undo!.action).toBe('bringBack');
    expect(buildBringBack(card(cards, 'laundry'), 'greg', NOW).ops).toEqual([]);
  });
});

describe('buildSaveCard', () => {
  const prior = state('laundry', {
    splitMode: 'label',
    parts: [
      { key: 'label-a', label: 'upstairs', holderId: 'greg' },
      { key: 'label-b', label: 'downstairs', holderId: 'sofia' },
    ],
  });

  it('emits one move per changed part and none for unchanged parts', () => {
    const c = card(resolved([prior]), 'laundry');
    const r = buildSaveCard(
      c,
      {
        splitMode: 'label',
        parts: [
          { key: 'label-a', label: 'upstairs', holderId: 'greg' },
          { key: 'label-b', label: 'downstairs', holderId: 'leo' },
          { key: 'label-c', label: 'garage', holderId: 'mia' },
        ],
        skipped: false,
      },
      'greg',
      NOW
    );
    expect(setStates(r.ops)).toHaveLength(1);
    expect(setMoves(r.ops).map((o) => [o.move.partKey, o.move.fromId, o.move.toId])).toEqual([
      ['label-b', 'sofia', 'leo'],
      ['label-c', undefined, 'mia'],
    ]);
    expect(setMoves(r.ops)[0]!.move.partLabel).toBe('downstairs');
    expect(r.undo).toBeUndefined();
  });

  it('an unchanged draft writes nothing', () => {
    const c = card(resolved([prior]), 'laundry');
    const r = buildSaveCard(
      c,
      { splitMode: 'label', parts: prior.parts, skipped: false, doneOverride: '  ' },
      'greg',
      NOW
    );
    expect(r.ops).toEqual([]);
  });

  it('saves done override, skip toggle and split mode in one state set', () => {
    const c = card(resolved([prior]), 'laundry');
    const r = buildSaveCard(
      c,
      {
        splitMode: 'single',
        parts: [{ key: 'label-a', holderId: 'greg' }],
        doneOverride: ' Folded by Friday ',
        skipped: true,
      },
      'greg',
      NOW
    );
    const s = setStates(r.ops)[0]!.state;
    expect(s).toMatchObject({
      status: 'skipped',
      splitMode: 'single',
      parts: [{ key: 'main', holderId: 'greg' }],
      doneOverride: 'Folded by Friday',
    });
    expect(r.telemetry.map((t) => t.message)).toEqual(['card_saved', 'split_set', 'card_skipped']);
  });

  it('clearing the done override removes it', () => {
    const c = card(resolved([state('laundry', { doneOverride: 'x' })]), 'laundry');
    const r = buildSaveCard(
      c,
      { splitMode: 'single', parts: [{ key: 'main' }], doneOverride: '', skipped: false },
      'greg',
      NOW
    );
    expect(setStates(r.ops)[0]!.state.doneOverride).toBeUndefined();
  });

  it('rejects an invalid draft', () => {
    const c = card(resolved([prior]), 'laundry');
    expect(() =>
      buildSaveCard(
        c,
        { splitMode: 'label', parts: [{ key: 'x', label: ' ' }], skipped: false },
        'g',
        NOW
      )
    ).toThrow();
    expect(() =>
      buildSaveCard(c, { splitMode: 'single', parts: [], skipped: false }, 'g', NOW)
    ).toThrow();
  });

  it('only custom cards take a new name, emoji and category', () => {
    const custom = state('custom-1', { custom: { name: 'Hens', emoji: '🐔', category: 'home' } });
    const cards = resolved([custom, state('laundry')]);
    const draft = {
      splitMode: 'single' as const,
      parts: [{ key: 'main' }],
      skipped: false,
      custom: { name: ' Chickens ', emoji: '🐓', category: 'projects' as const },
    };
    expect(
      setStates(buildSaveCard(card(cards, 'custom-1'), draft, 'g', NOW).ops)[0]!.state.custom
    ).toEqual({
      name: 'Chickens',
      emoji: '🐓',
      category: 'projects',
    });
    expect(buildSaveCard(card(cards, 'laundry'), draft, 'g', NOW).ops).toEqual([]);
  });
});

describe('draftPartsForMode', () => {
  it('single keeps the first holder; child makes a part per child; label starts one part', () => {
    const current = [{ key: 'main', holderId: 'greg' }];
    expect(draftPartsForMode(current, 'single', 'single', FAMILY)).toEqual([
      { key: 'main', holderId: 'greg' },
    ]);
    expect(draftPartsForMode(current, 'single', 'child', FAMILY)).toEqual([
      { key: 'leo' },
      { key: 'mia' },
    ]);
    const label = draftPartsForMode(current, 'single', 'label', FAMILY);
    expect(label).toHaveLength(1);
    expect(label[0]).toMatchObject({ label: '', holderId: 'greg' });
    expect(label[0]!.key.startsWith('label-')).toBe(true);
    const labels = [
      { key: 'label-a', label: 'up' },
      { key: 'label-b', label: 'down', holderId: 'sofia' },
    ];
    expect(draftPartsForMode(labels, 'label', 'label', FAMILY)).toEqual(labels);
  });
});

describe('custom cards', () => {
  it('creates a kept custom card with an optional holder and first move', () => {
    const r = buildCreateCustom(
      { name: ' Hens ', emoji: '🐔', category: 'home', done: 'Eggs in', holderId: 'leo' },
      'greg',
      NOW,
      'custom-x'
    );
    expect(setStates(r.ops)[0]!.state).toMatchObject({
      id: 'custom-x',
      custom: { name: 'Hens', emoji: '🐔', category: 'home' },
      doneOverride: 'Eggs in',
      parts: [{ key: 'main', holderId: 'leo' }],
    });
    expect(setMoves(r.ops)[0]!.move).toMatchObject({ toId: 'leo', byId: 'greg' });
    expect(buildCreateCustom({ name: 'x', emoji: 'x', category: 'home' }, 'g', NOW).id).toMatch(
      /^custom-/
    );
  });

  it('delete removes the state and every move of that card only', () => {
    const cards = resolved([
      state('custom-1', { custom: { name: 'x', emoji: 'x', category: 'me' } }),
    ]);
    const moves = [
      { id: 'm1', cardId: 'custom-1', partKey: 'main', at: NOW },
      { id: 'm2', cardId: 'laundry', partKey: 'main', at: NOW },
    ];
    expect(buildDeleteCustom(card(cards, 'custom-1'), moves).ops).toEqual([
      { op: 'deleteState', id: 'custom-1' },
      { op: 'deleteMove', id: 'm1' },
    ]);
    expect(() => buildDeleteCustom(card(cards, 'laundry'), moves)).toThrow();
  });
});

describe('buildRestoreDefaults', () => {
  const states = [
    state('laundry', { parts: [{ key: 'main', holderId: 'greg' }] }),
    state('from-the-future'),
    { id: 'broken' },
    state('custom-1', {
      custom: { name: 'Hens', emoji: '🐔', category: 'home' },
      doneOverride: 'Eggs in',
      splitMode: 'child',
      parts: [{ key: 'leo', holderId: 'greg' }],
    }),
  ];
  const moves = [
    { id: 'm1', cardId: 'laundry', partKey: 'main', at: NOW },
    { id: 'm2', cardId: 'custom-1', partKey: 'leo', at: NOW },
  ];

  it('keeping custom cards: built-ins and unknown ids deleted, custom reset to waiting, moves gone', () => {
    const r = buildRestoreDefaults(states, moves, true, NOW);
    expect(r.ops).toEqual([
      { op: 'deleteState', id: 'laundry' },
      { op: 'deleteState', id: 'from-the-future' },
      { op: 'deleteState', id: 'broken' },
      {
        op: 'setState',
        state: {
          ...states[3],
          splitMode: 'single',
          parts: [{ key: 'main' }],
          updatedAt: NOW,
        },
      },
      { op: 'deleteMove', id: 'm1' },
      { op: 'deleteMove', id: 'm2' },
    ]);
    expect(r.telemetry[0]!.context).toEqual({ detail: 'keep_custom', count: 1 });
  });

  it('clearing custom cards deletes them too; check-ins are never touched', () => {
    const r = buildRestoreDefaults(states, moves, false, NOW);
    expect(r.ops.filter((o) => o.op === 'deleteState')).toHaveLength(4);
    expect(r.ops.some((o) => o.op === 'setState' || o.op === 'setCheckIn')).toBe(false);
  });
});

describe('buildCheckIn', () => {
  it('records a write-once check-in with its own id, dated by the local day', () => {
    const outcomes = { stillWorks: 2, talkAbout: 1, redealt: 1, dealtNow: 3 };
    const r = buildCheckIn(outcomes, 'greg', NOW, '2026-09-26');
    expect(r.ops).toEqual([{ op: 'setCheckIn', checkIn: r.checkIn }]);
    expect(r.checkIn).toMatchObject({ kind: 'checkin', completedAt: NOW, byId: 'greg' });
    expect(r.checkIn.id).toMatch(/^2026-09-26-[0-9a-f]{8}$/);
    expect(r.telemetry[0]!.context.count).toBe(7);
    // A second check-in the same day is a second record, never an overwrite.
    expect(buildCheckIn(outcomes, 'sofia', NOW, '2026-09-26').checkIn.id).not.toBe(r.checkIn.id);
  });
});

describe('buildUndo', () => {
  it('restores exactly the token records and deletes its moves', () => {
    const prior = state('laundry', { parts: [{ key: 'main', holderId: 'sofia' }] });
    const cards = resolved([prior]);
    const deal = buildDeal(card(cards, 'laundry'), 'main', 'greg', 'greg', NOW);
    const firstDeal = buildDeal(card(cards, 'dishes'), 'main', 'greg', 'greg', NOW);
    const live = new Map([
      ['laundry', { updatedAt: NOW }],
      ['dishes', { updatedAt: NOW }],
    ]);
    const u1 = buildUndo(deal.undo!, live, cards);
    expect(u1).toMatchObject({ stale: false });
    if (u1.stale) throw new Error('unexpected');
    expect(u1.ops).toEqual([
      { op: 'setState', state: prior },
      { op: 'deleteMove', id: deal.undo!.createdMoveIds[0] },
    ]);
    const u2 = buildUndo(firstDeal.undo!, live, cards);
    if (u2.stale) throw new Error('unexpected');
    expect(u2.ops[0]).toEqual({ op: 'deleteState', id: 'dishes' });
    expect(u2.telemetry[0]!.context.detail).toBe('deal');
  });

  it('refuses the whole undo when any card in the token changed since', () => {
    const cards = resolved([]);
    const skip = buildSkip([card(cards, 'laundry'), card(cards, 'dishes')], 'greg', NOW);
    const live = new Map([
      ['laundry', { updatedAt: NOW }],
      ['dishes', { updatedAt: '2026-09-26T10:00:05.000Z' }],
    ]);
    expect(buildUndo(skip.undo!, live, cards)).toEqual({ stale: true });
    // A card deleted on another device is stale too.
    expect(buildUndo(skip.undo!, new Map([['laundry', { updatedAt: NOW }]]), cards)).toEqual({
      stale: true,
    });
  });
});

describe('withCycleStart', () => {
  const START_ID = 'start-1';
  const starts = (ops: DeckOp[]) =>
    ops.filter((o): o is Extract<DeckOp, { op: 'setCheckIn' }> => o.op === 'setCheckIn');
  const custom = (holderId?: string) =>
    state('custom-hens', {
      custom: { name: 'Hens', emoji: '🐔', category: 'home' },
      parts: [{ key: 'main', ...(holderId ? { holderId } : {}) }],
    });

  it('the first keep or deal into an empty deck appends ONE start record, in the undo too', () => {
    const deck = resolved([]);
    for (const build of [
      buildKeep(card(deck, 'laundry'), 'greg', NOW),
      buildDeal(card(deck, 'laundry'), 'main', 'sofia', 'greg', NOW),
    ]) {
      const r = withCycleStart(build, deck, 'greg', NOW, '2026-09-26', START_ID);
      expect(starts(r.ops)).toEqual([
        {
          op: 'setCheckIn',
          checkIn: {
            id: START_ID,
            kind: 'start',
            completedAt: NOW,
            byId: 'greg',
            stillWorks: 0,
            talkAbout: 0,
            redealt: 0,
            dealtNow: 0,
          },
        },
      ]);
      expect(r.ops.slice(0, build.ops.length)).toEqual(build.ops);
      expect(r.undo!.createdCheckInIds).toEqual([START_ID]);
      expect(build.undo!.createdCheckInIds).toEqual([]); // the input is not mutated
    }
  });

  it('writes nothing more once the deck has something in it, or for a write that adds nothing', () => {
    const dealt = resolved([state('laundry')]);
    const keep = buildKeep(card(dealt, 'dishes'), 'greg', NOW);
    expect(withCycleStart(keep, dealt, 'greg', NOW, '2026-09-26')).toBe(keep);
    const empty = resolved([]);
    const skip = buildSkip([card(empty, 'laundry')], 'greg', NOW);
    expect(withCycleStart(skip, empty, 'greg', NOW, '2026-09-26')).toBe(skip);
  });

  it('after Restore (custom cards kept as waiting) the next keep starts a new cycle', () => {
    const afterRestore = resolved([custom()]);
    const keep = buildKeep(card(afterRestore, 'laundry'), 'greg', NOW);
    expect(starts(withCycleStart(keep, afterRestore, 'greg', NOW, '2026-09-26').ops)).toHaveLength(
      1
    );
  });

  it('a custom card starts the cycle only when it is created with a holder', () => {
    const deck = resolved([]);
    const input = { name: 'Hens', emoji: '🐔', category: 'home' as const };
    const bare = buildCreateCustom(input, 'greg', NOW);
    expect(starts(withCycleStart(bare, deck, 'greg', NOW, '2026-09-26').ops)).toHaveLength(0);
    const held = buildCreateCustom({ ...input, holderId: 'leo' }, 'greg', NOW);
    expect(starts(withCycleStart(held, deck, 'greg', NOW, '2026-09-26').ops)).toHaveLength(1);
  });

  it('undo of the first keep deletes the start; not when another card went in meanwhile', () => {
    const deck = resolved([]);
    const r = withCycleStart(
      buildKeep(card(deck, 'laundry'), 'greg', NOW),
      deck,
      'greg',
      NOW,
      '2026-09-26',
      START_ID
    );
    const live = new Map([['laundry', { updatedAt: NOW }]]);
    const alone = buildUndo(r.undo!, live, resolved([state('laundry', { updatedAt: NOW })]));
    if (alone.stale) throw new Error('unexpected');
    expect(alone.ops).toContainEqual({ op: 'deleteCheckIn', id: START_ID });
    const withOther = buildUndo(
      r.undo!,
      live,
      resolved([state('laundry', { updatedAt: NOW }), state('dishes')])
    );
    if (withOther.stale) throw new Error('unexpected');
    expect(withOther.ops.some((o) => o.op === 'deleteCheckIn')).toBe(false);
  });
});
