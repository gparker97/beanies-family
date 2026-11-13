/**
 * The choreboard store (#146): orchestration only. The repository is an in-memory fake with
 * the real semantics that matter here (`ifAbsent` against what is already stored, a batch per
 * call), and telemetry, toasts and the celebration are spies. Under test is the action
 * contract (plan Testing Plan item 2): every tick guard refuses before writing, one mark per
 * tick, the once-only `celebrated` mark in the same batch, grown-up refusals, one batch per
 * starter set and copy, and the retention sweep's clock guard, cap and auto-write budget.
 *
 * The two-device case is proven on the REAL document layer (`docOps` through the #117
 * two-device harness): the marks this store writes are applied on two forked documents that
 * each made the bean's first tick offline, then merged both ways.
 */
import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { reactive } from 'vue';
import type { Chore, ChoreMark, FamilyMember } from '@/types/models';
import {
  choreStarterSet,
  starterSetDrafts,
  type StarterChoreDraft,
} from '@/constants/choreStarterSets';

const clock = vi.hoisted(() => ({ ymd: '2026-11-13', hhmm: '09:00' }));
vi.mock('@/composables/useChoreClock', async () => {
  const { ref: vref } = await import('vue');
  const choreClock = vref({ ...clock });
  return {
    useChoreClock: () => ({ choreClock }),
    __setClock: (ymd: string, hhmm: string) => {
      choreClock.value = { ymd, hhmm };
    },
  };
});
vi.mock('@/services/automerge/docService', () => ({ isDocLoaded: () => true }));
const logEvent = vi.fn();
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: (...a: unknown[]) => logEvent(...a) }));
const showToast = vi.fn((..._a: unknown[]) => 1);
vi.mock('@/composables/useToast', () => ({ showToast: (...a: unknown[]) => showToast(...a) }));
vi.mock('@/stores/translationStore', () => ({
  useTranslationStore: () => ({ t: (k: string) => k }),
}));
const reportError = vi.fn();
vi.mock('@/utils/errorReporter', () => ({
  reportError: (...a: unknown[]) => reportError(...a),
}));
const celebrate = vi.fn();
vi.mock('@/composables/useCelebration', () => ({
  celebrate: (...a: unknown[]) => celebrate(...a),
}));
const budget = vi.hoisted(() => ({ allow: true, calls: [] as string[] }));
vi.mock('@/utils/autoWriteBudget', () => ({
  takeAutoWrite: (writer: string) => {
    budget.calls.push(writer);
    return budget.allow;
  },
}));

function member(id: string, over: Partial<FamilyMember> = {}): FamilyMember {
  return { id, name: id, ageGroup: 'adult', role: 'member', ...over } as FamilyMember;
}
const family = reactive({
  members: [
    member('mom', { role: 'owner' }),
    member('dad'),
    member('kid', { ageGroup: 'child' }),
    member('sib', { ageGroup: 'child' }),
    member('rex', { isPet: true }),
  ] as FamilyMember[],
  currentMemberId: 'mom' as string | null,
  get currentMember() {
    return this.members.find((m) => m.id === this.currentMemberId);
  },
  get humans() {
    return this.members.filter((m) => !m.isPet);
  },
});
vi.mock('@/stores/familyStore', () => ({ useFamilyStore: () => family }));
const settings = reactive({
  settings: {} as Record<string, unknown>,
  weekStartDay: 1,
  setChoreBlockStarts: vi.fn(async (s: unknown) => {
    settings.settings = { ...settings.settings, choreBlockStarts: s };
  }),
});
vi.mock('@/stores/settingsStore', () => ({ useSettingsStore: () => settings }));

// ── in-memory repository ────────────────────────────────────────────────────────
const NOW = '2026-11-13T09:00:00.000Z';
const db = {
  chores: new Map<string, Chore>(),
  marks: new Map<string, ChoreMark>(),
  failNext: null as Error | null,
};
let nextId = 0;
function maybeFail(): void {
  if (db.failNext) {
    const e = db.failNext;
    db.failNext = null;
    throw e;
  }
}
const clone = <T>(v: T): T => structuredClone(v);
const writes = {
  setChoreMarks: vi.fn(),
  createChores: vi.fn(),
  removeChoreMark: vi.fn(),
  removeChoreMarks: vi.fn(),
  updateChore: vi.fn(),
  removeChores: vi.fn(),
};
vi.mock('@/services/automerge/repositories/choreRepository', () => ({
  getAllChores: async () => [...db.chores.values()].map(clone),
  getAllChoreMarks: async () => [...db.marks.values()].map(clone),
  createChore: async (input: Omit<Chore, 'id' | 'createdAt' | 'updatedAt'>) => {
    maybeFail();
    const c = { ...input, id: `chore-${nextId++}`, createdAt: NOW, updatedAt: NOW } as Chore;
    db.chores.set(c.id, clone(c));
    return c;
  },
  createChores: async (items: { id: string; input: Omit<Chore, 'id'> }[]) => {
    writes.createChores(items);
    maybeFail();
    for (const { id, input } of items) {
      db.chores.set(id, { ...clone(input), id, createdAt: NOW, updatedAt: NOW } as Chore);
    }
    return items;
  },
  updateChore: async (id: string, input: Record<string, unknown>) => {
    writes.updateChore(id, input);
    maybeFail();
    const cur = db.chores.get(id);
    if (!cur) return undefined;
    const next = { ...cur } as Record<string, unknown>;
    for (const [k, v] of Object.entries(input)) {
      if (v === undefined) delete next[k];
      else next[k] = clone(v);
    }
    db.chores.set(id, next as unknown as Chore);
    return clone(next) as unknown as Chore;
  },
  updateChores: async (items: { id: string; patch: Partial<Chore> }[]) => {
    for (const { id, patch } of items) {
      const cur = db.chores.get(id);
      if (cur) db.chores.set(id, { ...cur, ...patch });
    }
    return [];
  },
  deleteChore: async (id: string) => db.chores.delete(id),
  removeChores: async (
    deleteIds: readonly string[],
    reassign: readonly { id: string; assigneeIds: readonly string[] }[]
  ) => {
    writes.removeChores([...deleteIds], clone(reassign));
    maybeFail();
    for (const id of deleteIds) db.chores.delete(id);
    for (const { id, assigneeIds } of reassign) {
      const cur = db.chores.get(id);
      if (cur) db.chores.set(id, { ...cur, assigneeIds: [...assigneeIds] });
    }
  },
  setChoreMarks: async (
    items: { id: string; input: Omit<ChoreMark, 'id' | 'createdAt' | 'updatedAt'> }[],
    opts?: { ifAbsent?: boolean }
  ) => {
    writes.setChoreMarks(items, opts);
    maybeFail();
    const toCreate = opts?.ifAbsent ? items.filter(({ id }) => !db.marks.has(id)) : items;
    const created = toCreate.map(
      ({ id, input }) => ({ ...input, id, createdAt: NOW, updatedAt: NOW }) as ChoreMark
    );
    for (const m of created) db.marks.set(m.id, clone(m));
    return created;
  },
  removeChoreMark: async (id: string) => {
    writes.removeChoreMark(id);
    maybeFail();
    return db.marks.delete(id);
  },
  removeChoreMarks: async (ids: readonly string[]) => {
    writes.removeChoreMarks([...ids]);
    maybeFail();
    for (const id of ids) db.marks.delete(id);
  },
}));

import { useChoreStore } from '@/stores/choreStore';
import { choreMarkId, shiftChoreDay, MAX_MARK_SWEEP_DELETES } from '@/utils/chores';
import { CHORE_MARK_SWEEP_KEY, LIST_CYCLE_SWEEP_KEY } from '@/utils/cycleSweepClock';
import * as clockModule from '@/composables/useChoreClock';
import * as Automerge from '@automerge/automerge';
import type { FamilyDocument } from '@/types/automerge';
import { migrateDoc } from '@/services/automerge/worker/docOps';
import { seeded, fork, converge, apply } from '@/services/automerge/worker/__tests__/twoDevices';

const setClock = (clockModule as unknown as { __setClock: (y: string, h: string) => void })
  .__setClock;

type Store = ReturnType<typeof useChoreStore>;
let store: Store;

const FRI = '2026-11-13';
const SAT = '2026-11-14';

function draft(title: string, over: Partial<StarterChoreDraft> = {}): StarterChoreDraft {
  return { title, emoji: '🧹', block: 'morning', ...over };
}

function chore(id: string, over: Partial<Chore> = {}): Chore {
  return {
    id,
    title: `Title ${id}`,
    emoji: '🧹',
    assigneeIds: ['kid'],
    block: 'morning',
    sortOrder: 0,
    createdBy: 'mom',
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

const logged = (message: string) =>
  logEvent.mock.calls
    .map((c) => c[0] as { message: string; context?: Record<string, unknown> })
    .filter((e) => e.message === message);

async function setup(chores: Chore[], marks: ChoreMark[] = []): Promise<void> {
  db.chores.clear();
  db.marks.clear();
  for (const c of chores) db.chores.set(c.id, clone(c));
  for (const m of marks) db.marks.set(m.id, clone(m));
  await store.loadChores();
  vi.clearAllMocks();
  budget.calls = [];
}

beforeEach(async () => {
  setActivePinia(createPinia());
  db.chores.clear();
  db.marks.clear();
  db.failNext = null;
  family.currentMemberId = 'mom';
  settings.settings = {};
  budget.allow = true;
  budget.calls = [];
  // A swept-today cursor so `loadChores`' own sweep stays quiet in the tick tests.
  localStorage.clear();
  localStorage.setItem(CHORE_MARK_SWEEP_KEY, FRI);
  setClock(FRI, '09:00');
  store = useChoreStore();
  vi.clearAllMocks();
});

describe('ticking', () => {
  it('a tick sets ONE done mark and an untick removes it', async () => {
    await setup([chore('c1'), chore('c2', { sortOrder: 1 })]);
    family.currentMemberId = 'kid';
    const ticked = await store.toggleChore('c1', 'kid', { surface: 'app' });
    expect(ticked).toEqual({ action: 'tick', completed: null, celebrated: false });
    expect(writes.setChoreMarks).toHaveBeenCalledTimes(1);
    const [items, opts] = writes.setChoreMarks.mock.calls[0]!;
    expect(opts).toEqual({ ifAbsent: true });
    expect(items).toEqual([
      {
        id: choreMarkId('done', 'kid', FRI, 'c1'),
        input: { kind: 'done', memberId: 'kid', date: FRI, ref: 'c1', by: 'kid' },
      },
    ]);
    expect(store.choreDayFor('kid').blocks[0]!.done).toBe(1);
    expect(logged('chore-ticked')[0]!.context).toEqual({
      action: 'tick',
      slot: 'morning',
      kind: 'app',
    });

    const unticked = await store.toggleChore('c1', 'kid', { surface: 'app' });
    expect(unticked).toEqual({ action: 'untick', completed: null, celebrated: false });
    expect(writes.removeChoreMark).toHaveBeenCalledWith(choreMarkId('done', 'kid', FRI, 'c1'));
    expect(db.marks.size).toBe(0);
    expect(store.choreDayFor('kid').blocks[0]!.done).toBe(0);
  });

  it('credits the session on the page and the wall’s `by` on the wall', async () => {
    await setup([chore('c1'), chore('c2', { sortOrder: 1 })]);
    family.currentMemberId = 'mom';
    await store.toggleChore('c1', 'kid', { surface: 'app', by: 'someone-else' });
    expect(db.marks.get(choreMarkId('done', 'kid', FRI, 'c1'))?.by).toBe('mom');
    await store.toggleChore('c2', 'kid', { surface: 'wall', by: 'kid' });
    expect(db.marks.get(choreMarkId('done', 'kid', FRI, 'c2'))?.by).toBe('kid');
  });

  describe('every guard refuses BEFORE writing, with edit-refused and a toast', () => {
    it.each([
      ['not-found', 'gone', 'kid', 'mom'],
      ['not-assigned', 'c1', 'sib', 'mom'],
      ['not-today', 'weekdays', 'kid', 'mom'],
      ['not-yours', 'shared', 'sib', 'kid'],
    ])('%s', async (detail, choreId, memberId, session) => {
      await setup([
        chore('c1'),
        chore('weekdays', { days: [1, 2, 3, 4, 5] }),
        chore('shared', { assigneeIds: ['kid', 'sib'] }),
      ]);
      setClock(SAT, '09:00');
      family.currentMemberId = session;
      const result = await store.toggleChore(choreId, memberId, { surface: 'app' });
      // A tagged refusal, never `null` (that means a failed write the wall would report).
      expect(result).toEqual({ action: 'refused', detail });
      expect(writes.setChoreMarks).not.toHaveBeenCalled();
      expect(writes.removeChoreMark).not.toHaveBeenCalled();
      expect(logged('edit-refused')[0]!.context).toEqual({ action: 'toggleChore', detail });
      expect(showToast).toHaveBeenCalledWith('info', expect.stringContaining('choreboard.error.'));
    });

    it('a removed member cannot be ticked even when still listed on the chore', async () => {
      await setup([chore('c1', { assigneeIds: ['kid', 'gone'] })]);
      expect(await store.toggleChore('c1', 'gone', { surface: 'wall', by: 'gone' })).toEqual({
        action: 'refused',
        detail: 'not-assigned',
      });
      expect(writes.setChoreMarks).not.toHaveBeenCalled();
    });

    it('a child may tick their own chore on the page', async () => {
      await setup([chore('c1'), chore('c2', { sortOrder: 1 })]);
      family.currentMemberId = 'kid';
      expect(await store.toggleChore('c1', 'kid', { surface: 'app' })).not.toBeNull();
    });
  });

  it('a failed write resolves null; the page toasts, the wall does not', async () => {
    await setup([chore('c1'), chore('c2', { sortOrder: 1 })]);
    db.failNext = new Error('boom');
    expect(await store.toggleChore('c1', 'kid', { surface: 'app' })).toBeNull();
    expect(showToast).toHaveBeenCalledWith('error', 'boom', undefined, expect.anything());
    showToast.mockClear();
    db.failNext = new Error('boom');
    expect(await store.toggleChore('c1', 'kid', { surface: 'wall', by: 'kid' })).toBeNull();
    expect(showToast).not.toHaveBeenCalled();
  });
});

describe('the once-only celebration', () => {
  it('the completing tick writes done + celebrated in ONE batch, and celebrates once', async () => {
    await setup([chore('c1'), chore('c2', { sortOrder: 1 })]);
    await store.toggleChore('c1', 'kid', { surface: 'wall', by: 'kid' });
    expect(celebrate).not.toHaveBeenCalled();
    writes.setChoreMarks.mockClear();

    const result = await store.toggleChore('c2', 'kid', { surface: 'wall', by: 'kid' });
    expect(result).toEqual({ action: 'tick', completed: 'morning', celebrated: true });
    expect(writes.setChoreMarks).toHaveBeenCalledTimes(1);
    const [items, opts] = writes.setChoreMarks.mock.calls[0]!;
    expect(opts).toEqual({ ifAbsent: true });
    expect((items as { id: string }[]).map((i) => i.id)).toEqual([
      choreMarkId('done', 'kid', FRI, 'c2'),
      choreMarkId('celebrated', 'kid', FRI, 'morning'),
    ]);
    expect(celebrate).toHaveBeenCalledTimes(1);
    expect(celebrate).toHaveBeenCalledWith('chore-block-complete');
    expect(logged('block-complete')[0]!.context).toEqual({
      slot: 'morning',
      count: 2,
      detail: 'celebrated',
    });
  });

  it('the celebrated mark survives an untick; a re-tick is banner only', async () => {
    await setup([chore('c1')]);
    await store.toggleChore('c1', 'kid', { surface: 'app' });
    expect(celebrate).toHaveBeenCalledTimes(1);
    await store.toggleChore('c1', 'kid', { surface: 'app' }); // untick
    const celebratedId = choreMarkId('celebrated', 'kid', FRI, 'morning');
    expect(db.marks.has(celebratedId)).toBe(true);
    expect(store.choreDayFor('kid').blocks[0]).toMatchObject({ allDone: false, celebrated: true });

    writes.setChoreMarks.mockClear();
    logEvent.mockClear();
    const again = await store.toggleChore('c1', 'kid', { surface: 'app' });
    expect(again).toEqual({ action: 'tick', completed: 'morning', celebrated: false });
    expect((writes.setChoreMarks.mock.calls[0]![0] as { id: string }[]).map((i) => i.id)).toEqual([
      choreMarkId('done', 'kid', FRI, 'c1'),
    ]);
    expect(celebrate).toHaveBeenCalledTimes(1);
    expect(logged('block-complete')[0]!.context).toMatchObject({ detail: 'banner-only' });
  });

  it('another device’s celebrated mark (not yet in this store) means banner only', async () => {
    await setup([chore('c1')]);
    // Merged in after the store last read: the projection has it, the store does not.
    const id = choreMarkId('celebrated', 'kid', FRI, 'morning');
    db.marks.set(id, {
      id,
      kind: 'celebrated',
      memberId: 'kid',
      date: FRI,
      ref: 'morning',
      by: 'kid',
      createdAt: NOW,
      updatedAt: NOW,
    });
    const result = await store.toggleChore('c1', 'kid', { surface: 'app' });
    expect(result).toEqual({ action: 'tick', completed: 'morning', celebrated: false });
    expect(celebrate).not.toHaveBeenCalled();
  });

  it('a block completed by a delete writes no celebrated mark', async () => {
    await setup([chore('c1'), chore('c2', { sortOrder: 1 })]);
    await store.toggleChore('c1', 'kid', { surface: 'app' });
    writes.setChoreMarks.mockClear();
    expect(await store.deleteChore('c2', 'mom')).toBe(true);
    expect(store.choreDayFor('kid').blocks[0]).toMatchObject({ allDone: true, celebrated: false });
    expect(writes.setChoreMarks).not.toHaveBeenCalled();
    expect(celebrate).not.toHaveBeenCalled();
  });
});

describe('two different chores of one block ticked in quick succession', () => {
  it('the block still celebrates exactly once, after both writes land', async () => {
    await setup([chore('c1'), chore('c2', { sortOrder: 1 })]);
    // Both start before either write is read back, so each sees the other still undone and
    // neither looks like the block's last tick. Before the fix: both done marks landed, the
    // block showed its banner, and no celebrated mark, no celebration, no block-complete.
    const [a, b] = await Promise.all([
      store.toggleChore('c1', 'kid', { surface: 'wall', by: 'kid' }),
      store.toggleChore('c2', 'kid', { surface: 'wall', by: 'kid' }),
    ]);
    expect(a).toMatchObject({ action: 'tick' });
    expect(b).toMatchObject({ action: 'tick' });
    expect(db.marks.has(choreMarkId('celebrated', 'kid', FRI, 'morning'))).toBe(true);
    expect(celebrate).toHaveBeenCalledTimes(1);
    expect(celebrate).toHaveBeenCalledWith('chore-block-complete');
    expect(logged('block-complete').map((e) => e.context)).toEqual([
      { slot: 'morning', count: 2, detail: 'celebrated' },
    ]);
    expect([a, b].filter((r) => r && 'celebrated' in r && r.celebrated)).toHaveLength(1);
    expect(store.choreDayFor('kid').blocks[0]).toMatchObject({ allDone: true, celebrated: true });
  });

  it('three at once still celebrate once (the per-device latch)', async () => {
    await setup([chore('c1'), chore('c2', { sortOrder: 1 }), chore('c3', { sortOrder: 2 })]);
    await Promise.all(
      ['c1', 'c2', 'c3'].map((id) => store.toggleChore(id, 'kid', { surface: 'app' }))
    );
    expect(celebrate).toHaveBeenCalledTimes(1);
    expect(logged('block-complete')).toHaveLength(1);
  });

  it('a block left incomplete after both writes is a plain tick', async () => {
    await setup([chore('c1'), chore('c2', { sortOrder: 1 }), chore('c3', { sortOrder: 2 })]);
    await Promise.all([
      store.toggleChore('c1', 'kid', { surface: 'app' }),
      store.toggleChore('c2', 'kid', { surface: 'app' }),
    ]);
    expect(celebrate).not.toHaveBeenCalled();
    expect(logged('block-complete')).toHaveLength(0);
    expect(db.marks.has(choreMarkId('celebrated', 'kid', FRI, 'morning'))).toBe(false);
  });
});

describe('the one-minute clock', () => {
  it('re-runs a reader of choreDayFor at a block boundary or a new day, never every minute', async () => {
    const { computed: vcomputed } = await import('vue');
    await setup([chore('c1')]);
    let runs = 0;
    const reader = vcomputed(() => {
      runs++;
      return store.choreDayFor('kid');
    });
    setClock(FRI, '09:00');
    expect(reader.value.blocks[0]!.isNow).toBe(true);
    expect(runs).toBe(1);
    for (const hhmm of ['09:01', '09:02', '11:59']) {
      setClock(FRI, hhmm);
      void reader.value;
    }
    expect(runs).toBe(1);
    setClock(FRI, '12:00'); // Afternoon starts: morning has ended
    expect(reader.value.blocks[0]).toMatchObject({ isNow: false, ended: true });
    expect(reader.value.blocks[1]!.isNow).toBe(true);
    expect(runs).toBe(2);
    setClock(SAT, '12:00');
    void reader.value;
    expect(runs).toBe(3);
  });
});

describe('two devices, each making the bean’s first tick of the day offline', () => {
  /** The `set` op the repository sends for a mark this store wrote. */
  const setOp = (m: ChoreMark) => ({
    op: 'set' as const,
    collection: 'choreMarks' as const,
    id: m.id,
    entity: { ...m },
  });

  it('keeps every tick from both after the merge (real Automerge, both directions)', async () => {
    const chores = [chore('c1'), chore('c2', { sortOrder: 1 }), chore('c3', { sortOrder: 2 })];
    // Device A ticks c1 and c2; device B, which never saw A's ticks, ticks c2 and c3.
    await setup(chores);
    await store.toggleChore('c1', 'kid', { surface: 'wall', by: 'kid' });
    await store.toggleChore('c2', 'kid', { surface: 'wall', by: 'kid' });
    const onA = [...db.marks.values()];
    await setup(chores);
    await store.toggleChore('c2', 'kid', { surface: 'app' });
    await store.toggleChore('c3', 'kid', { surface: 'app' });
    const onB = [...db.marks.values()];

    const origin = seeded(
      chores.map((c) => ({
        op: 'set' as const,
        collection: 'chores' as const,
        id: c.id,
        entity: c,
      }))
    );
    const devices = fork(origin);
    const a = apply(devices.a, ...onA.map(setOp));
    const b = apply(devices.b, ...onB.map(setOp));
    const merged = converge(a, b);

    const done = (doc: typeof merged.a) =>
      Object.values(doc.choreMarks)
        .filter((m) => m.kind === 'done')
        .map((m) => String(m.ref))
        .sort();
    // Every tick from both devices, and the chore ticked on both is ONE mark.
    expect(done(merged.a)).toEqual(['c1', 'c2', 'c3']);
    expect(done(merged.b)).toEqual(['c1', 'c2', 'c3']);
    expect(Object.keys(merged.a.choreMarks)).toHaveLength(3);
  });

  it('also on a pod that predates the choreboard: each device migrates the SAME mark map in', async () => {
    await setup([chore('c1'), chore('c2', { sortOrder: 1 })]);
    await store.toggleChore('c1', 'kid', { surface: 'app' });
    const onA = [...db.marks.values()];
    await setup([chore('c1'), chore('c2', { sortOrder: 1 })]);
    await store.toggleChore('c2', 'kid', { surface: 'app' });
    const onB = [...db.marks.values()];

    // An empty history: neither device has the chore maps until it migrates on its own.
    const devices = fork(Automerge.init<FamilyDocument>());
    const a = apply(migrateDoc(devices.a), ...onA.map(setOp));
    const b = apply(migrateDoc(devices.b), ...onB.map(setOp));
    const merged = converge(a, b);
    expect(Object.keys(merged.a.choreMarks).sort()).toEqual([
      choreMarkId('done', 'kid', FRI, 'c1'),
      choreMarkId('done', 'kid', FRI, 'c2'),
    ]);
  });
});

describe('grown-up actions', () => {
  it.each([
    [
      'createChore',
      (s: Store) =>
        s.createChore({ title: 'X', emoji: '🧹', assigneeIds: ['kid'], block: 'morning' }, 'kid'),
    ],
    ['updateChore', (s: Store) => s.updateChore('c1', { title: 'Y' }, 'kid')],
    ['deleteChore', (s: Store) => s.deleteChore('c1', 'kid')],
    ['removeChoresForMember', (s: Store) => s.removeChoresForMember(['c1'], 'kid', 'kid')],
    ['reorderChores', (s: Store) => s.reorderChores(['c1'], 'kid')],
    [
      'setBlockStarts',
      (s: Store) =>
        s.setBlockStarts({ morning: '07:00', afternoon: '12:00', evening: '17:00' }, 'kid'),
    ],
    ['addChores', (s: Store) => s.addChores(['kid'], [draft('Make bed')], 'kid')],
    ['copyChores', (s: Store) => s.copyChores('kid', ['sib'], ['morning'], 'kid')],
  ])('%s is refused for a child, with no write', async (action, run) => {
    await setup([chore('c1')]);
    const before = JSON.stringify([...db.chores.values()]);
    expect(await run(store)).toBeNull();
    expect(JSON.stringify([...db.chores.values()])).toBe(before);
    expect(writes.createChores).not.toHaveBeenCalled();
    expect(writes.updateChore).not.toHaveBeenCalled();
    expect(writes.removeChores).not.toHaveBeenCalled();
    expect(settings.setChoreBlockStarts).not.toHaveBeenCalled();
    expect(logged('edit-refused')[0]!.context).toEqual({ action, detail: 'not-adult' });
  });

  it('an unknown actor is refused too (the wall passes who unlocked it)', async () => {
    await setup([]);
    expect(
      await store.createChore(
        { title: 'X', emoji: '🧹', assigneeIds: ['kid'], block: 'morning' },
        'nobody'
      )
    ).toBeNull();
  });

  it('createChore stores a clean chore and logs chore-saved without its title', async () => {
    await setup([chore('c1', { sortOrder: 4 })]);
    const created = await store.createChore(
      {
        title: '  Feed the fish  ',
        emoji: '🐟',
        assigneeIds: ['kid', 'rex', 'gone', 'kid'],
        block: 'evening',
        days: [5, 1, 1, 9],
      },
      'dad'
    );
    expect(created).toMatchObject({
      title: 'Feed the fish',
      assigneeIds: ['kid'],
      block: 'evening',
      days: [1, 5],
      sortOrder: 5,
      createdBy: 'dad',
    });
    expect(logged('chore-saved')[0]!.context).toEqual({
      action: 'create',
      slot: 'evening',
      count: 1,
    });
    expect(JSON.stringify(logEvent.mock.calls)).not.toContain('Feed the fish');
  });

  it('createChore refuses an empty title or nobody living', async () => {
    await setup([]);
    expect(
      await store.createChore(
        { title: ' ', emoji: '🧹', assigneeIds: ['kid'], block: 'morning' },
        'mom'
      )
    ).toBeNull();
    expect(
      await store.createChore(
        { title: 'X', emoji: '🧹', assigneeIds: ['rex'], block: 'morning' },
        'mom'
      )
    ).toBeNull();
    expect(logged('edit-refused').map((e) => e.context?.detail)).toEqual(['invalid', 'invalid']);
  });

  it('updateChore prunes dead assignee ids and clears days', async () => {
    await setup([chore('c1', { assigneeIds: ['kid', 'gone'], days: [1, 2] })]);
    const updated = await store.updateChore('c1', { title: 'Renamed', days: [] }, 'mom');
    expect(updated).toMatchObject({ title: 'Renamed', assigneeIds: ['kid'] });
    expect(updated?.days).toBeUndefined();
  });

  it('updateChore tells the family when the chore was deleted on another device meanwhile', async () => {
    await setup([chore('c1')]);
    // Gone from the document, still in this store's last read: the repository answers
    // `undefined`. Before the fix that was a silent `null` (no toast, the form stayed open).
    db.chores.delete('c1');
    expect(await store.updateChore('c1', { title: 'Renamed' }, 'mom')).toBeNull();
    expect(logged('edit-refused')[0]!.context).toEqual({
      action: 'updateChore',
      detail: 'not-found',
    });
    expect(showToast).toHaveBeenCalledWith('info', 'choreboard.error.notFound');
    expect(logged('chore-saved')).toHaveLength(0);
  });

  it('updateChore refuses a deleted chore and a chore left with nobody', async () => {
    await setup([chore('c1')]);
    expect(await store.updateChore('gone', { title: 'X' }, 'mom')).toBeNull();
    expect(await store.updateChore('c1', { assigneeIds: ['gone'] }, 'mom')).toBeNull();
    expect(logged('edit-refused').map((e) => e.context?.detail)).toEqual(['not-found', 'invalid']);
  });

  it('setBlockStarts refuses unordered hours and writes valid ones whole', async () => {
    await setup([]);
    expect(
      await store.setBlockStarts({ morning: '12:00', afternoon: '07:00', evening: '17:00' }, 'mom')
    ).toBeNull();
    expect(logged('edit-refused')[0]!.context).toEqual({
      action: 'setBlockStarts',
      detail: 'bad-hours',
    });
    expect(settings.setChoreBlockStarts).not.toHaveBeenCalled();
    const s = { morning: '07:00', afternoon: '13:00', evening: '18:00' };
    expect(await store.setBlockStarts(s, 'mom')).toBe(true);
    expect(settings.setChoreBlockStarts).toHaveBeenCalledWith(s);
    expect(store.starts).toEqual(s);
    expect(logged('hours-set')).toHaveLength(1);
  });

  it('updateChore writes Keep Parents Posted and logs notify-parents-set only when it changes', async () => {
    await setup([chore('c1')]);
    expect(await store.updateChore('c1', { notifyParents: true }, 'mom')).toMatchObject({
      notifyParents: true,
    });
    expect(logged('notify-parents-set').map((e) => e.context)).toEqual([{ action: 'on' }]);
    await store.updateChore('c1', { title: 'Renamed', notifyParents: true }, 'mom');
    expect(logged('notify-parents-set')).toHaveLength(1);
    await store.updateChore('c1', { notifyParents: false }, 'mom');
    expect(logged('notify-parents-set').map((e) => e.context)).toEqual([
      { action: 'on' },
      { action: 'off' },
    ]);
  });

  it('reorderChores swaps the moved chores among their own places; no sortOrder collides', async () => {
    // Pip's morning: a(0) b(2) c(4); other chores sit between them (Juno's, and Pip's own
    // weekday chore hidden on a Saturday).
    await setup([
      chore('a', { sortOrder: 0 }),
      chore('j1', { sortOrder: 1, assigneeIds: ['sib'] }),
      chore('b', { sortOrder: 2 }),
      chore('wk', { sortOrder: 3, days: [1, 2, 3, 4, 5] }),
      chore('c', { sortOrder: 4 }),
      chore('j2', { sortOrder: 5, assigneeIds: ['sib'] }),
    ]);
    expect(await store.reorderChores(['c', 'a', 'b'], 'mom')).toBe(true);
    const order = (ids: string[]) => ids.map((id) => db.chores.get(id)!.sortOrder);
    // The old code renumbered only the passed ids to 0..2: c=0, a=1 (colliding with j1),
    // b=2. Now c, a, b take the slots a, b, c held, and everything else stays put.
    expect(order(['c', 'j1', 'a', 'wk', 'b', 'j2'])).toEqual([0, 1, 2, 3, 4, 5]);
    const all = [...db.chores.values()].map((c) => c.sortOrder);
    expect(new Set(all).size).toBe(all.length);
    expect(store.sortedChores.map((c) => c.id)).toEqual(['c', 'j1', 'a', 'wk', 'b', 'j2']);
    expect(logged('chore-saved')[0]!.context).toEqual({
      action: 'update',
      detail: 'reorder',
      count: 3,
    });
  });

  it('reorderChores renumbers a collection with duplicate sortOrders into distinct ones', async () => {
    // Two devices created a chore at once: both took sortOrder 1.
    await setup([
      chore('a', { sortOrder: 0 }),
      chore('b', { sortOrder: 1, createdAt: '2026-11-13T08:00:00.000Z' }),
      chore('x', { sortOrder: 1, assigneeIds: ['sib'], createdAt: '2026-11-13T08:30:00.000Z' }),
    ]);
    expect(await store.reorderChores(['b', 'a'], 'mom')).toBe(true);
    expect(store.sortedChores.map((c) => [c.id, c.sortOrder])).toEqual([
      ['b', 0],
      ['a', 1],
      ['x', 2],
    ]);
  });
});

describe('adding chores and copy: one batch each', () => {
  it('addChores writes ONE batch with a chore PER BEAN, keyed to the set each row came from', async () => {
    await setup([]);
    const drafts = starterSetDrafts(choreStarterSet('school-morning')!, (k) => k);
    const result = await store.addChores(['kid', 'sib'], drafts, 'mom');
    expect(writes.createChores).toHaveBeenCalledTimes(1);
    const items = writes.createChores.mock.calls[0]![0] as { input: Chore }[];
    expect(items).toHaveLength(drafts.length * 2);
    expect(result).toEqual({ added: items.length, skipped: 0 });
    // Each bean gets their own copy of every draft, never one shared chore.
    expect(items.filter((i) => i.input.assigneeIds[0] === 'kid')).toHaveLength(drafts.length);
    for (const { input } of items) {
      expect(input.assigneeIds).toHaveLength(1);
      expect(input.block).toBe('morning');
      expect(input.days).toEqual([1, 2, 3, 4, 5]);
      expect(input.starterKey).toBe('school-morning');
      expect(input.title).toMatch(/^choreboard\.starterChore\./);
    }
    expect(logged('chores-added')[0]!.context).toEqual({
      detail: 'school-morning',
      count: items.length,
    });
    expect(logged('chores-add-edited')).toHaveLength(0);
    expect(logged('chores-add-skipped')).toHaveLength(0);
  });

  it('addChores takes rows from two sets and the grown-up’s own, as plain text', async () => {
    await setup([]);
    const result = await store.addChores(
      ['kid'],
      [
        draft('  Bath time  ', { block: 'evening', setKey: 'bedtime', starterChoreKey: 'bath' }),
        draft('Walk the dog', { block: 'afternoon', setKey: 'pet-care' }),
        draft('Lay out clothes', { block: 'anytime', illustration: 'laundry' }),
        draft('Read together', { days: [0, 6] }),
      ],
      'mom',
      { edited: 2 }
    );
    const items = writes.createChores.mock.calls[0]![0] as { input: Chore }[];
    expect(
      items.map((i) => [i.input.title, i.input.block, i.input.days, i.input.starterKey])
    ).toEqual([
      ['Bath time', 'evening', undefined, 'bedtime'],
      ['Walk the dog', 'afternoon', undefined, 'pet-care'],
      ['Lay out clothes', 'anytime', undefined, undefined],
      ['Read together', 'morning', [0, 6], undefined],
    ]);
    expect(items[2]!.input.illustration).toBe('laundry');
    expect(result).toEqual({ added: 4, skipped: 0 });
    expect(logged('chores-added')[0]!.context).toEqual({ detail: 'bedtime+pet-care', count: 4 });
    expect(logged('chores-add-edited')[0]!.context).toEqual({ count: 2 });
    // No chore titles in telemetry.
    expect(JSON.stringify(logEvent.mock.calls)).not.toContain('Lay out clothes');
  });

  it('addChores with only the grown-up’s own rows logs detail none', async () => {
    await setup([]);
    await store.addChores(['kid'], [draft('Feed the fish')], 'mom');
    expect(logged('chores-added')[0]!.context).toEqual({ detail: 'none', count: 1 });
  });

  it('addChores skips a bean’s duplicate (same title, same block) and counts it', async () => {
    await setup([chore('mine', { title: 'Make bed', assigneeIds: ['kid'] })]);
    const result = await store.addChores(
      ['kid', 'sib'],
      [draft('make bed '), draft('Brush teeth')],
      'mom'
    );
    expect(writes.createChores).toHaveBeenCalledTimes(1);
    const items = writes.createChores.mock.calls[0]![0] as { input: Chore }[];
    expect(items.map((i) => [i.input.title, i.input.assigneeIds])).toEqual([
      ['Brush teeth', ['kid']],
      ['make bed', ['sib']],
      ['Brush teeth', ['sib']],
    ]);
    expect(result).toEqual({ added: 3, skipped: 1 });
    expect(logged('chores-add-skipped')[0]!.context).toEqual({ count: 1 });
  });

  it('addChores with everything a duplicate writes nothing and reports the skips', async () => {
    await setup([chore('mine', { title: 'Make bed', assigneeIds: ['kid'] })]);
    const result = await store.addChores(['kid'], [draft('Make bed')], 'mom');
    expect(writes.createChores).not.toHaveBeenCalled();
    expect(result).toEqual({ added: 0, skipped: 1 });
  });

  it('addChores refuses nobody living, no drafts, an untitled or a bad-block draft', async () => {
    await setup([]);
    expect(await store.addChores(['rex'], [draft('A')], 'mom')).toBeNull();
    expect(await store.addChores(['kid'], [], 'mom')).toBeNull();
    expect(await store.addChores(['kid'], [draft('A'), draft('   ')], 'mom')).toBeNull();
    expect(
      await store.addChores(['kid'], [draft('A', { block: 'night' as never })], 'mom')
    ).toBeNull();
    expect(writes.createChores).not.toHaveBeenCalled();
    expect(logged('edit-refused').map((e) => e.context)).toEqual(
      Array(4).fill({ action: 'addChores', detail: 'invalid' })
    );
  });

  it('copyChores writes ONE batch and skips the same title in the same block', async () => {
    await setup([
      chore('k1', { title: 'Make bed' }),
      chore('k2', { title: 'Feed fish', block: 'evening', days: [1, 3] }),
      chore('k3', { title: 'Homework', block: 'afternoon' }),
      chore('s1', { title: 'make bed ', assigneeIds: ['sib'] }), // sib already has it
    ]);
    const result = await store.copyChores(
      'kid',
      ['sib', 'dad', 'kid'],
      ['morning', 'evening'],
      'mom'
    );
    expect(writes.createChores).toHaveBeenCalledTimes(1);
    const items = writes.createChores.mock.calls[0]![0] as { input: Chore }[];
    expect(items.map((i) => [i.input.title, i.input.assigneeIds[0], i.input.block])).toEqual([
      ['Feed fish', 'sib', 'evening'],
      ['Make bed', 'dad', 'morning'],
      ['Feed fish', 'dad', 'evening'],
    ]);
    expect(items[0]!.input.days).toEqual([1, 3]);
    expect(result).toEqual({ added: 3, skipped: 1 });
    expect(logged('chores-copied')[0]!.context).toEqual({ count: 3 });
    expect(logged('chores-copy-skipped')[0]!.context).toEqual({ count: 1 });
    expect(JSON.stringify(logEvent.mock.calls)).not.toContain('Feed fish');
  });
});

describe('the retention sweep', () => {
  const old = shiftChoreDay(FRI, -40);
  function oldMark(i: number): ChoreMark {
    const id = choreMarkId('done', 'kid', old, `c${i}`);
    return {
      id,
      kind: 'done',
      memberId: 'kid',
      date: old,
      ref: `c${i}`,
      by: 'kid',
      createdAt: `${old}T08:00:00.000Z`,
      updatedAt: `${old}T08:00:00.000Z`,
    };
  }

  async function sweepWith(cursor: string | null, marks: ChoreMark[]): Promise<void> {
    await setup([], marks);
    if (cursor === null) localStorage.removeItem(CHORE_MARK_SWEEP_KEY);
    else localStorage.setItem(CHORE_MARK_SWEEP_KEY, cursor);
    await store.sweepExpiredMarks();
  }

  it('sweeps expired marks once a day, and logs marks-swept', async () => {
    await sweepWith(shiftChoreDay(FRI, -1), [oldMark(1), oldMark(2)]);
    expect(writes.removeChoreMarks).toHaveBeenCalledTimes(1);
    expect(db.marks.size).toBe(0);
    expect(budget.calls).toEqual(['chore-marks-sweep']);
    expect(localStorage.getItem(CHORE_MARK_SWEEP_KEY)).toBe(FRI);
    expect(logged('marks-swept')[0]!.context).toEqual({ count: 2 });
    // Same day again: nothing.
    writes.removeChoreMarks.mockClear();
    db.marks.set(oldMark(3).id, oldMark(3));
    await store.sweepExpiredMarks();
    expect(writes.removeChoreMarks).not.toHaveBeenCalled();
  });

  it('the clock guard: a first run, a regressed clock and a jump delete nothing', async () => {
    await sweepWith(null, [oldMark(1)]);
    expect(writes.removeChoreMarks).not.toHaveBeenCalled();
    expect(localStorage.getItem(CHORE_MARK_SWEEP_KEY)).toBe(FRI); // first run advances

    await sweepWith(shiftChoreDay(FRI, 2), [oldMark(1)]);
    expect(writes.removeChoreMarks).not.toHaveBeenCalled();
    expect(localStorage.getItem(CHORE_MARK_SWEEP_KEY)).toBe(shiftChoreDay(FRI, 2)); // never moved back

    await sweepWith(shiftChoreDay(FRI, -30), [oldMark(1)]);
    expect(writes.removeChoreMarks).not.toHaveBeenCalled();
    expect(logged('marks-sweep-skipped').map((e) => e.context?.detail)).toEqual(['jumped']);
  });

  it('honours the per-run cap', async () => {
    const many = Array.from({ length: MAX_MARK_SWEEP_DELETES + 20 }, (_, i) => oldMark(i));
    await sweepWith(shiftChoreDay(FRI, -1), many);
    expect((writes.removeChoreMarks.mock.calls[0]![0] as string[]).length).toBe(
      MAX_MARK_SWEEP_DELETES
    );
    expect(db.marks.size).toBe(20);
  });

  it('honours the auto-write budget: refused means no delete and the day is not claimed', async () => {
    budget.allow = false;
    const yesterday = shiftChoreDay(FRI, -1);
    await sweepWith(yesterday, [oldMark(1)]);
    expect(budget.calls).toEqual(['chore-marks-sweep']);
    expect(writes.removeChoreMarks).not.toHaveBeenCalled();
    expect(localStorage.getItem(CHORE_MARK_SWEEP_KEY)).toBe(yesterday);
  });

  it('nothing expired: the cursor advances without spending the budget', async () => {
    await sweepWith(shiftChoreDay(FRI, -1), []);
    expect(budget.calls).toEqual([]);
    expect(localStorage.getItem(CHORE_MARK_SWEEP_KEY)).toBe(FRI);
  });

  it('a failed delete is reported, never thrown', async () => {
    await setup([], [oldMark(1)]);
    localStorage.setItem(CHORE_MARK_SWEEP_KEY, shiftChoreDay(FRI, -1));
    db.failNext = new Error('disk');
    await expect(store.sweepExpiredMarks()).resolves.toBeUndefined();
    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({ surface: 'choreboard', severity: 'warning' })
    );
  });

  it('keeps its own cursor, apart from the list cycle sweep', () => {
    expect(CHORE_MARK_SWEEP_KEY).not.toBe(LIST_CYCLE_SWEEP_KEY);
  });
});

describe('reads', () => {
  it('weekFor counts done marks per day with the family week start', async () => {
    const m = (date: string, ref: string): ChoreMark => ({
      id: choreMarkId('done', 'kid', date, ref),
      kind: 'done',
      memberId: 'kid',
      date,
      ref,
      by: 'kid',
      createdAt: NOW,
      updatedAt: NOW,
    });
    await setup([chore('c1')], [m('2026-11-09', 'c1'), m(FRI, 'c1')]);
    const w = store.weekFor('kid');
    expect(w.days[0]!.ymd).toBe('2026-11-09');
    expect(w.total).toBe(2);
  });

  it('resetState clears the chores', async () => {
    await setup([chore('c1')]);
    store.resetState();
    expect(store.chores).toEqual([]);
    expect(store.isLoaded).toBe(false);
  });
});

describe('removeChoresForMember (Delete on a bean’s day)', () => {
  const doneMark = (memberId: string, ref: string): ChoreMark => ({
    id: choreMarkId('done', memberId, FRI, ref),
    kind: 'done',
    memberId,
    date: FRI,
    ref,
    by: memberId,
    createdAt: NOW,
    updatedAt: NOW,
  });

  it('deletes a chore only this bean had, unassigns a shared one, in ONE write', async () => {
    await setup([
      chore('solo'),
      chore('shared', { assigneeIds: ['kid', 'sib'], sortOrder: 1 }),
      chore('theirs', { assigneeIds: ['sib'], sortOrder: 2 }),
    ]);
    const result = await store.removeChoresForMember(['solo', 'shared', 'theirs'], 'kid', 'mom');
    expect(result).toEqual({ deleted: 1, unassigned: 1 });
    expect(writes.removeChores).toHaveBeenCalledTimes(1);
    expect(writes.removeChores).toHaveBeenCalledWith(
      ['solo'],
      [{ id: 'shared', assigneeIds: ['sib'] }]
    );
    expect(store.choreById('solo')).toBeUndefined();
    expect(store.choreById('shared')!.assigneeIds).toEqual(['sib']);
    // Not this bean's: untouched.
    expect(store.choreById('theirs')!.assigneeIds).toEqual(['sib']);
    expect(logged('chores-removed')[0]!.context).toEqual({
      count: 2,
      detail: 'deleted:1+unassigned:1',
    });
  });

  it('a shared chore whose other bean has left the family is deleted, not left with nobody', async () => {
    await setup([chore('shared', { assigneeIds: ['kid', 'gone'] })]);
    expect(await store.removeChoresForMember(['shared'], 'kid', 'mom')).toEqual({
      deleted: 1,
      unassigned: 0,
    });
    expect(store.choreById('shared')).toBeUndefined();
  });

  it('nothing of this bean’s to remove is the not-found refusal, with no write', async () => {
    await setup([chore('theirs', { assigneeIds: ['sib'] })]);
    expect(await store.removeChoresForMember(['theirs', 'ghost'], 'kid', 'mom')).toBeNull();
    expect(writes.removeChores).not.toHaveBeenCalled();
    expect(logged('edit-refused')[0]!.context).toEqual({
      action: 'removeChoresForMember',
      detail: 'not-found',
    });
  });

  it('a failed write resolves null and changes nothing', async () => {
    await setup([chore('solo')]);
    db.failNext = new Error('boom');
    expect(await store.removeChoresForMember(['solo'], 'kid', 'mom')).toBeNull();
    expect(store.choreById('solo')).toBeDefined();
    expect(logged('chores-removed')).toHaveLength(0);
  });

  it('the deleted chore’s old done mark stays and every reader ignores it safely', async () => {
    await setup([chore('solo'), chore('keep', { sortOrder: 1 })], [doneMark('kid', 'solo')]);
    await store.removeChoresForMember(['solo'], 'kid', 'mom');
    // The orphaned mark is still there (the retention sweep ages it out)...
    expect(db.marks.has(choreMarkId('done', 'kid', FRI, 'solo'))).toBe(true);
    // ...and the day and the week read past it without a crash or a ghost row.
    const day = store.choreDayFor('kid');
    const rows = day.blocks.flatMap((b) => b.chores.map((i) => i.chore.id));
    expect(rows).toEqual(['keep']);
    expect(day.left).toBe(1);
    expect(() => store.weekFor('kid')).not.toThrow();
  });
});
