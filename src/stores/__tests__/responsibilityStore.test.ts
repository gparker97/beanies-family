/**
 * Who Owns What (#109) store: orchestration only. The repository is an in-memory fake
 * that applies DeckOps to three maps (so verification reads real results), and telemetry,
 * toasts and celebrations are spies. What is under test is the action contract: one
 * batch per action, the guard order, undo + stale refusal, verification, the critical
 * restore report and the deck-dealt transition.
 */
import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { reactive } from 'vue';
import type { DeckOp } from '@/utils/responsibilityOps';
import type {
  FamilyMember,
  ResponsibilityCardState,
  ResponsibilityCheckIn,
  ResponsibilityMove,
} from '@/types/models';

vi.mock('@/composables/useToday', () => ({ useToday: () => ({ today: { value: '2026-09-26' } }) }));
vi.mock('@/services/automerge/docService', () => ({ isDocLoaded: () => true }));
const logEvent = vi.fn();
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: (...a: unknown[]) => logEvent(...a) }));
const showToast = vi.fn((..._a: unknown[]) => 1);
vi.mock('@/composables/useToast', () => ({ showToast: (...a: unknown[]) => showToast(...a) }));
vi.mock('@/stores/translationStore', () => ({
  useTranslationStore: () => ({ t: (k: string) => k }),
}));
const celebrate = vi.fn();
vi.mock('@/composables/useCelebration', () => ({
  celebrate: (...a: unknown[]) => celebrate(...a),
}));

function member(id: string, over: Partial<FamilyMember> = {}): FamilyMember {
  return { id, name: id, ageGroup: 'adult', role: 'member', ...over } as FamilyMember;
}
const family = reactive({
  members: [
    member('greg', { role: 'owner' }),
    member('sofia'),
    member('leo', { ageGroup: 'child' }),
    member('rex', { isPet: true }),
  ] as FamilyMember[],
  currentMemberId: 'greg' as string | null,
  get currentMember() {
    return this.members.find((m) => m.id === this.currentMemberId);
  },
});
vi.mock('@/stores/familyStore', () => ({ useFamilyStore: () => family }));
const setResponsibilityCheckInWeeks = vi.fn(async (_w: number) => {});
vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: () => ({ responsibilityCheckInWeeks: 4, setResponsibilityCheckInWeeks }),
}));

// ── in-memory repository ────────────────────────────────────────────────────────
const db = {
  cards: new Map<string, ResponsibilityCardState>(),
  moves: new Map<string, ResponsibilityMove>(),
  checkIns: new Map<string, ResponsibilityCheckIn>(),
  /** When set, the next applyDeckOps silently drops its ops (a verification miss). */
  dropNext: false,
  failNext: null as Error | null,
};
const applyDeckOps = vi.fn(async (ops: readonly DeckOp[]) => {
  if (db.failNext) {
    const e = db.failNext;
    db.failNext = null;
    throw e;
  }
  if (db.dropNext) {
    db.dropNext = false;
    return;
  }
  for (const op of ops) {
    if (op.op === 'setState') db.cards.set(op.state.id, structuredClone(op.state));
    else if (op.op === 'deleteState') db.cards.delete(op.id);
    else if (op.op === 'setMove') db.moves.set(op.move.id, structuredClone(op.move));
    else if (op.op === 'deleteMove') db.moves.delete(op.id);
    else db.checkIns.set(op.checkIn.id, structuredClone(op.checkIn));
  }
});
vi.mock('@/services/automerge/repositories/responsibilityRepository', () => ({
  getAllCardStates: async () => [...db.cards.values()].map((s) => structuredClone(s)),
  getAllMoves: async () => [...db.moves.values()],
  getAllCheckIns: async () => [...db.checkIns.values()],
  applyDeckOps: (ops: readonly DeckOp[]) => applyDeckOps(ops),
  isDeckOpApplied: (op: DeckOp) => {
    if (op.op === 'setState') return db.cards.get(op.state.id)?.updatedAt === op.state.updatedAt;
    if (op.op === 'deleteState') return !db.cards.has(op.id);
    if (op.op === 'setMove') return db.moves.has(op.move.id);
    if (op.op === 'deleteMove') return !db.moves.has(op.id);
    return db.checkIns.has(op.checkIn.id);
  },
}));

import { useResponsibilityStore } from '@/stores/responsibilityStore';
import { RESPONSIBILITY_CARDS } from '@/constants/responsibilityCards';

type Store = ReturnType<typeof useResponsibilityStore>;
let store: Store;

const logged = (message: string) =>
  logEvent.mock.calls.filter((c) => (c[0] as { message: string }).message === message);
const opsOf = (call: number) => applyDeckOps.mock.calls[call]![0] as DeckOp[];

/** Distinct timestamps per write, so undo tokens and move ids never collide. */
let clock = Date.parse('2026-09-26T10:00:00.000Z');
beforeEach(async () => {
  setActivePinia(createPinia());
  db.cards.clear();
  db.moves.clear();
  db.checkIns.clear();
  db.dropNext = false;
  db.failNext = null;
  family.currentMemberId = 'greg';
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(clock);
  store = useResponsibilityStore();
  await store.load();
  vi.clearAllMocks();
});

function tick(): void {
  clock += 1000;
  vi.setSystemTime(clock);
}

describe('loading', () => {
  it('starts in the first-deal state and logs deck_loaded once', async () => {
    expect(store.isFirstDeal).toBe(true);
    expect(store.stats.unsorted).toBe(RESPONSIBILITY_CARDS.length);
    expect(store.defaultHolderFor({ kind: 'mealSlot', slot: 'dinner' })).toBeNull();
    await store.load();
    expect(logged('deck_loaded')).toHaveLength(0); // unchanged → not logged again
  });

  it('logs unknown and malformed records once per id, without the id', async () => {
    db.cards.set('from-the-future', {
      id: 'from-the-future',
      status: 'kept',
      splitMode: 'single',
      parts: [],
      createdAt: 'x',
      updatedAt: 'x',
    });
    db.cards.set('laundry', { id: 'laundry', status: 'nope' } as never);
    await store.load();
    await store.load();
    expect(logged('unknown_card')).toHaveLength(1);
    expect(logged('invalid_card_state')).toHaveLength(1);
    expect(JSON.stringify(logEvent.mock.calls)).not.toContain('from-the-future');
    expect(store.cardById('laundry')!.status).toBe('unsorted');
  });
});

describe('deal / keep / skip / bring back', () => {
  it('deals an unsorted card in ONE batch (state + move) and returns an undo token', async () => {
    const r = await store.deal('laundry', 'main', 'sofia');
    expect(applyDeckOps).toHaveBeenCalledTimes(1);
    expect(opsOf(0).map((o) => o.op)).toEqual(['setState', 'setMove']);
    expect(r!.result.status).toBe('held');
    expect(r!.undo!.action).toBe('deal');
    expect(store.defaultHolderFor({ kind: 'listTemplate', key: 'grocery' })).toBeNull();
    expect(logged('card_dealt')[0]![0]).toMatchObject({
      surface: 'responsibilities',
      context: { action: 'deal', kind: 'home', detail: 'first' },
    });
  });

  it('re-deal records the move from the previous holder', async () => {
    await store.deal('laundry', 'main', 'sofia');
    tick();
    await store.deal('laundry', 'main', 'greg');
    const move = opsOf(1).find((o) => o.op === 'setMove') as Extract<DeckOp, { op: 'setMove' }>;
    expect(move.move).toMatchObject({ fromId: 'sofia', toId: 'greg', byId: 'greg' });
    expect(store.cardById('laundry')!.parts[0]).toMatchObject({
      holderId: 'greg',
      previousHolderId: 'sofia',
    });
  });

  it('keep leaves the card waiting; skip takes a group in one batch', async () => {
    const k = await store.keep('dishes');
    expect(k!.result.status).toBe('waiting');
    expect(k!.undo!.action).toBe('keep');
    const s = await store.skip(['car-care', 'bikes']);
    expect(applyDeckOps).toHaveBeenCalledTimes(2);
    expect(s!.undo!.action).toBe('skip');
    expect(store.cardById('bikes')!.status).toBe('skipped');
    const b = await store.bringBack('bikes');
    expect(b!.result.status).toBe('waiting');
    expect(b!.undo!.action).toBe('bringBack');
  });

  it('undo restores exactly the previous state and deletes the created move', async () => {
    await store.deal('laundry', 'main', 'sofia');
    tick();
    const r = await store.deal('laundry', 'main', 'greg');
    expect(await store.undo(r!.undo!)).toBe(true);
    expect(store.cardById('laundry')!.parts[0]!.holderId).toBe('sofia');
    expect(db.moves.size).toBe(1);
    expect(logged('undo')[0]![0]).toMatchObject({ context: { detail: 'deal' } });
  });

  it('undo of a first deal deletes the record (back to unsorted)', async () => {
    const r = await store.deal('laundry', 'main', 'sofia');
    await store.undo(r!.undo!);
    expect(db.cards.has('laundry')).toBe(false);
    expect(store.cardById('laundry')!.status).toBe('unsorted');
  });

  it('refuses a stale group undo as a whole and writes nothing', async () => {
    const s = await store.skip(['car-care', 'bikes']);
    tick();
    await store.bringBack('bikes'); // "another device" changed one card in the token
    applyDeckOps.mockClear();
    expect(await store.undo(s!.undo!)).toBeNull();
    expect(applyDeckOps).not.toHaveBeenCalled();
    expect(store.cardById('car-care')!.status).toBe('skipped');
    expect(showToast).toHaveBeenCalledWith(
      'info',
      'whoOwnsWhat.undo.stale',
      'whoOwnsWhat.undo.staleHelp'
    );
    expect(logged('undo_stale')).toHaveLength(1);
  });
});

describe('guard', () => {
  it('refuses every write from a child with an info toast and no report', async () => {
    family.currentMemberId = 'leo';
    expect(store.canDeal).toBe(false);
    expect(await store.deal('laundry', 'main', 'leo')).toBeNull();
    expect(await store.skip(['laundry'])).toBeNull();
    expect(await store.restoreDefaults({ keepCustom: true })).toBeNull();
    expect(await store.setRhythm(2)).toBeNull();
    expect(applyDeckOps).not.toHaveBeenCalled();
    expect(setResponsibilityCheckInWeeks).not.toHaveBeenCalled();
    expect(showToast.mock.calls.every((c) => c[0] === 'info')).toBe(true);
    expect(logged('write_refused')).toHaveLength(4);
  });

  it('refuses a card that no longer exists', async () => {
    expect(await store.deal('custom-gone', 'main', 'greg')).toBeNull();
    expect(showToast).toHaveBeenCalledWith(
      'info',
      'whoOwnsWhat.error.cardGone',
      expect.any(String)
    );
    expect(logged('card_missing')).toHaveLength(1);
    expect(applyDeckOps).not.toHaveBeenCalled();
  });

  it('refuses a holder who is a pet or not in the family', async () => {
    expect(await store.deal('laundry', 'main', 'rex')).toBeNull();
    expect(await store.deal('laundry', 'main', 'ghost')).toBeNull();
    expect(logged('invalid_holder')).toHaveLength(2);
    expect(applyDeckOps).not.toHaveBeenCalled();
  });
});

describe('verification and failure reports', () => {
  it('a batch that did not land surfaces exactly one error toast and returns null', async () => {
    db.dropNext = true;
    expect(await store.deal('laundry', 'main', 'sofia')).toBeNull();
    const errors = showToast.mock.calls.filter((c) => c[0] === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0]![1]).toBe('whoOwnsWhat.error.saveFailed');
    expect(errors[0]![3]).toMatchObject({
      surface: 'responsibilities',
      context: { action: 'responsibilityStore:deal' },
    });
    expect(logged('card_dealt')).toHaveLength(0);
  });

  it('restoreDefaults failure reports once, at critical, with the stage', async () => {
    db.failNext = new Error('boom');
    expect(await store.restoreDefaults({ keepCustom: true })).toBeNull();
    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast.mock.calls[0]).toEqual([
      'error',
      'whoOwnsWhat.restore.failed',
      'whoOwnsWhat.restore.failedHelp',
      expect.objectContaining({
        critical: true,
        surface: 'responsibilities',
        context: { action: 'restore_defaults', stage: 'write' },
      }),
    ]);
  });
});

describe('edit, custom cards and restore', () => {
  it('saveCard writes one batch and returns the card (no undo token)', async () => {
    const r = await store.saveCard('lunchboxes', {
      splitMode: 'child',
      parts: [{ key: 'leo', holderId: 'sofia' }],
      doneOverride: 'Packed by 8',
      skipped: false,
    });
    expect(applyDeckOps).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ id: 'lunchboxes', status: 'held', doneOverride: 'Packed by 8' });
    expect(r).not.toHaveProperty('undo');
    expect(logged('split_set')).toHaveLength(1);
  });

  it('an invalid draft writes nothing and toasts a translated title, never the builder string', async () => {
    const r = await store.saveCard('lunchboxes', {
      splitMode: 'child',
      parts: [], // a child split in a family with no children
      skipped: false,
    });
    expect(r).toBeNull();
    expect(applyDeckOps).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith(
      'error',
      'whoOwnsWhat.error.saveFailed',
      undefined,
      expect.objectContaining({
        surface: 'responsibilities',
        context: { action: 'responsibilityStore:saveCard' },
        error: expect.objectContaining({ message: expect.stringContaining('buildSaveCard') }),
      })
    );
  });

  it('deleteCustom removes the card and its moves', async () => {
    const c = await store.createCustom({
      name: 'Hens',
      emoji: '🐔',
      category: 'home',
      holderId: 'leo',
    });
    expect(db.moves.size).toBe(1);
    expect(await store.deleteCustom(c!.id)).toBe(true);
    expect(db.cards.has(c!.id)).toBe(false);
    expect(db.moves.size).toBe(0);
  });

  it('restore keeps custom cards as waiting, or clears them', async () => {
    const c = await store.createCustom({
      name: 'Hens',
      emoji: '🐔',
      category: 'home',
      holderId: 'leo',
    });
    await store.deal('laundry', 'main', 'sofia');
    expect(store.nextCheckIn).toBe('2026-10-24');
    await store.restoreDefaults({ keepCustom: true });
    // The deal starts over: nothing is dealt, so no check-in clock, kept custom card or not.
    expect(store.nextCheckIn).toBeNull();
    expect(store.cardById(c!.id)!.status).toBe('waiting');
    expect(store.cardById('laundry')!.status).toBe('unsorted');
    expect(db.moves.size).toBe(0);
    expect(showToast).toHaveBeenCalledWith('success', 'whoOwnsWhat.restore.done');
    await store.restoreDefaults({ keepCustom: false });
    expect(store.cardById(c!.id)).toBeUndefined();
    expect(store.isFirstDeal).toBe(true);
  });
});

describe('check-in and celebrations', () => {
  it('records a check-in and celebrates', async () => {
    const r = await store.completeCheckIn({ stillWorks: 1, talkAbout: 0, redealt: 0, dealtNow: 2 });
    expect(r).toMatchObject({ id: '2026-09-26', byId: 'greg' });
    expect(db.checkIns.has('2026-09-26')).toBe(true);
    expect(celebrate).toHaveBeenCalledWith('check-in-done');
    expect(store.lastCheckIn!.id).toBe('2026-09-26');
  });

  it('setRhythm goes through settingsStore and never toasts twice on failure', async () => {
    expect(await store.setRhythm(8)).toBe(true);
    expect(setResponsibilityCheckInWeeks).toHaveBeenCalledWith(8);
    setResponsibilityCheckInWeeks.mockRejectedValueOnce(new Error('x'));
    expect(await store.setRhythm(2)).toBeNull();
    expect(showToast).not.toHaveBeenCalled(); // settingsStore owns that toast
  });

  it('the check-in due date survives skipping the first card dealt', async () => {
    await store.deal('laundry', 'main', 'sofia'); // 2026-09-26
    vi.setSystemTime(Date.parse('2026-09-30T10:00:00.000Z'));
    await store.deal('dishes', 'main', 'greg');
    expect(store.nextCheckIn).toBe('2026-10-24');
    vi.setSystemTime(Date.parse('2026-10-01T10:00:00.000Z'));
    await store.skip(['laundry']);
    expect(store.nextCheckIn).toBe('2026-10-24'); // same due date, same snooze key
    vi.setSystemTime(clock);
  });

  it('fires deck-dealt once, on the write that sorts the last card', async () => {
    const all = RESPONSIBILITY_CARDS.map((c) => c.id);
    await store.skip(all.slice(1));
    expect(celebrate).not.toHaveBeenCalled();
    tick();
    await store.deal(all[0]!, 'main', 'greg');
    expect(celebrate).toHaveBeenCalledTimes(1);
    expect(celebrate).toHaveBeenCalledWith('deck-dealt');
    expect(logged('deck_dealt')).toHaveLength(1);
    tick();
    await store.deal(all[0]!, 'main', 'sofia'); // still fully dealt: no replay
    await store.load();
    expect(celebrate).toHaveBeenCalledTimes(1);
  });

  it('defaultHolderFor reads the single holder once loaded', async () => {
    await store.deal('cooking-dinner', 'main', 'sofia');
    expect(store.defaultHolderFor({ kind: 'mealSlot', slot: 'dinner' })).toEqual({
      memberId: 'sofia',
      cardId: 'cooking-dinner',
    });
  });
});
