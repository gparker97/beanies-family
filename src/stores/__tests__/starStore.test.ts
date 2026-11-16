/**
 * Stars and rewards (#148): the star store (plan Testing Plan item 4). The chore store, the
 * repositories, telemetry, the budget and the banner are fakes; the rules are the real
 * `utils/choreStars.ts` and `utils/chores.ts`, and load maintenance is the real module. The store
 * keeps TWO copies apart on purpose: what the fake chore store and the star store hold (the store
 * arrays) and what the repositories return (the projection), so a test can tell which one shaped
 * a write.
 */
import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { nextTick, reactive, ref, toRaw } from 'vue';
import type {
  Chore,
  ChoreAward,
  ChoreMark,
  ChoreStarGift,
  ChoreWeek,
  FamilyMember,
} from '@/types/models';

const MON = '2026-11-16';
const W0 = '2026-11-09';
const T = '2026-11-01T08:00:00.000Z';
/** Chores exist from well before every week a test closes, so every week has something due. */
const CHORE_T = '2026-09-01T08:00:00.000Z';

const doc = vi.hoisted(() => ({ loaded: true }));
vi.mock('@/services/automerge/docService', () => ({ isDocLoaded: () => doc.loaded }));
const logEvent = vi.fn();
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: (...a: unknown[]) => logEvent(...a) }));
const reportError = vi.fn();
vi.mock('@/utils/errorReporter', () => ({ reportError: (...a: unknown[]) => reportError(...a) }));
const showToast = vi.fn();
vi.mock('@/composables/useToast', () => ({ showToast: (...a: unknown[]) => showToast(...a) }));
vi.mock('@/stores/translationStore', () => ({
  useTranslationStore: () => ({
    t: (k: string) => (k === 'choreStars.error.overWeek' ? 'over:{name}:{count}' : k),
  }),
}));
const budget = vi.hoisted(() => ({ allow: true, calls: [] as string[] }));
vi.mock('@/utils/autoWriteBudget', () => ({
  takeAutoWrite: (writer: string) => {
    budget.calls.push(writer);
    return budget.allow;
  },
}));
/**
 * The banner, as `celebrateReward` orders it: an optional wait (`duringWait` runs inside it, so a
 * test can untick or leave meanwhile), then `stillClaimable()`, then `claim()`; `shown` counts the
 * banners actually shown. `result` is what a shown banner answers (`played` or `waited`).
 */
const banner = vi.hoisted(() => ({
  result: 'played' as 'played' | 'waited',
  duringWait: null as null | (() => void),
  shown: 0,
  calls: [] as {
    memberId: string;
    beanName: string;
    stillClaimable: () => boolean;
    claim: () => Promise<boolean>;
  }[],
}));
vi.mock('@/composables/useCelebration', () => ({
  celebrateReward: async (req: (typeof banner.calls)[number]) => {
    banner.calls.push(req);
    if (banner.duringWait) {
      await Promise.resolve();
      banner.duringWait();
    }
    if (!req.stillClaimable()) return 'dropped';
    if (!(await req.claim())) return 'claimed-elsewhere';
    banner.shown++;
    return banner.result;
  },
}));

function member(id: string, over: Partial<FamilyMember> = {}): FamilyMember {
  return { id, name: `${id} Lastname`, ageGroup: 'child', role: 'member', ...over } as FamilyMember;
}
const ROSTER = [
  member('mom', { role: 'owner', ageGroup: 'adult' }),
  member('dad', { ageGroup: 'adult' }),
  member('kid'),
  member('sib'),
  member('rex', { isPet: true, ageGroup: 'adult' }),
];
const family = reactive({
  members: ROSTER,
  get humans() {
    return this.members.filter((m) => !m.isPet);
  },
  /** Family order (the roster's order here). */
  get sortedHumans() {
    return this.members.filter((m) => !m.isPet);
  },
});
vi.mock('@/stores/familyStore', () => ({ useFamilyStore: () => family }));

/**
 * The settings store. `settings` is the STORE's copy (what the getters read); `projected` is the
 * PROJECTION's `choreRewards` (what the real `setChoreRewards` hands the builder), kept apart so
 * a test can make the store's copy lag. A write lands in both; `sent` is every object written.
 */
const settings = reactive({
  settings: {} as Record<string, unknown>,
  projected: undefined as Record<string, unknown> | undefined,
  sent: [] as Record<string, unknown>[],
  weekStartDay: 1,
  failNext: null as Error | null,
  setChoreRewards: vi.fn(
    async (build: (current: Record<string, unknown> | undefined) => Record<string, unknown>) => {
      if (settings.failNext) {
        const e = settings.failNext;
        settings.failNext = null;
        throw e;
      }
      const current = settings.projected ? structuredClone(toRaw(settings.projected)) : undefined;
      const next = structuredClone(build(current));
      settings.sent.push(next);
      settings.projected = next;
      settings.settings = { ...settings.settings, choreRewards: structuredClone(next) };
    }
  ),
});
/** The family's rewards settings, the same in the store's copy and the projection. */
function setRewardsState(choreRewards: Record<string, unknown> | undefined): void {
  settings.settings = choreRewards ? { choreRewards: structuredClone(choreRewards) } : {};
  settings.projected = choreRewards ? structuredClone(choreRewards) : undefined;
}
vi.mock('@/stores/settingsStore', () => ({ useSettingsStore: () => settings }));

/** The STORE arrays (what the chore store holds), with the real rules over them. */
const markWrites = vi.hoisted(() => ({ fail: false, calls: [] as unknown[][] }));
/** This device's ticks still being written (`whenTicksSettled` waits for `pending`). */
const ticking = vi.hoisted(() => ({ pending: null as Promise<void> | null, waits: 0 }));
const chores = reactive({
  chores: [] as Chore[],
  choreMarks: [] as ChoreMark[],
  livingIds: new Set(['mom', 'dad', 'kid', 'sib']),
  isLoaded: true,
  todayYmd: MON,
  get markIndex() {
    return indexMarks(this.choreMarks);
  },
  choreById(id: string) {
    return this.chores.find((c) => c.id === id);
  },
  weekFor(memberId: string, ymd: string, wsd: number) {
    return choreWeekRecord(
      this.chores,
      indexMarks(this.choreMarks),
      memberId,
      ymd,
      wsd,
      this.livingIds
    );
  },
  async whenTicksSettled(_memberId: string) {
    ticking.waits++;
    await ticking.pending;
  },
  async writeCelebratedMark(memberId: string, ymd: string, ref: string, by: string) {
    markWrites.calls.push([memberId, ymd, ref, by]);
    if (markWrites.fail) return 'failed';
    const id = choreMarkId('celebrated', memberId, ymd, ref);
    if (this.choreMarks.some((m) => m.id === id)) return 'exists';
    this.choreMarks = [
      ...this.choreMarks,
      { id, kind: 'celebrated', memberId, date: ymd, ref, by, createdAt: T, updatedAt: T },
    ];
    return 'created';
  },
});
vi.mock('@/stores/choreStore', () => ({ useChoreStore: () => chores }));

/** The PROJECTION (what the repositories return). */
const proj = {
  chores: [] as Chore[],
  marks: [] as ChoreMark[],
  weeks: [] as ChoreWeek[],
  awards: [] as ChoreAward[],
  gifts: [] as ChoreStarGift[],
  failWrite: null as Error | null,
  /** The next update/remove finds the entity gone (another device deleted it). */
  goneNext: false,
};
const clone = <V>(v: V): V => structuredClone(v);
const reads = { chores: vi.fn(), marks: vi.fn(), weeks: vi.fn(), gifts: vi.fn(), awards: vi.fn() };
/** The next projection read of the marks throws (then reads work again). */
const readFail = { next: null as Error | null };
const writes = {
  setChoreWeeks: vi.fn(),
  createAward: vi.fn(),
  updateAward: vi.fn(),
  deleteAward: vi.fn(),
  createGift: vi.fn(),
  removeGift: vi.fn(),
};
let seq = 0;
function failMaybe(): void {
  if (proj.failWrite) throw proj.failWrite;
}
vi.mock('@/services/automerge/repositories/choreRepository', () => ({
  getAllChores: async () => {
    reads.chores();
    return clone(proj.chores);
  },
  getAllChoreMarks: async () => {
    reads.marks();
    if (readFail.next) {
      const e = readFail.next;
      readFail.next = null;
      throw e;
    }
    return clone(proj.marks);
  },
}));
vi.mock('@/services/automerge/repositories/starRepository', () => ({
  getAllChoreWeeks: async () => {
    reads.weeks();
    return clone(proj.weeks);
  },
  getAllAwards: async () => {
    reads.awards();
    return clone(proj.awards);
  },
  getAllGifts: async () => {
    reads.gifts();
    return clone(proj.gifts);
  },
  setChoreWeeks: async (items: Omit<ChoreWeek, 'createdAt' | 'updatedAt'>[]) => {
    writes.setChoreWeeks(clone(items));
    failMaybe();
    for (const w of items) {
      proj.weeks = [
        ...proj.weeks.filter((x) => x.id !== w.id),
        { ...clone(w), createdAt: T, updatedAt: T },
      ];
    }
    return [];
  },
  createAward: async (input: Omit<ChoreAward, 'id' | 'createdAt' | 'updatedAt'>) => {
    writes.createAward(clone(input));
    failMaybe();
    const award = { ...clone(input), id: `a${++seq}`, createdAt: `${T}${seq}`, updatedAt: T };
    proj.awards = [...proj.awards, award as ChoreAward];
    return clone(award);
  },
  updateAward: async (id: string, input: Partial<ChoreAward>) => {
    writes.updateAward(id, clone(input));
    failMaybe();
    if (proj.goneNext) {
      proj.goneNext = false;
      proj.awards = proj.awards.filter((a) => a.id !== id);
      return undefined;
    }
    const cur = proj.awards.find((a) => a.id === id);
    if (!cur) return undefined;
    const next = { ...cur } as Record<string, unknown>;
    for (const [k, v] of Object.entries(input)) {
      if (v === undefined) delete next[k];
      else next[k] = clone(v);
    }
    proj.awards = proj.awards.map((a) => (a.id === id ? (next as unknown as ChoreAward) : a));
    return clone(next);
  },
  deleteAward: async (id: string) => {
    writes.deleteAward(id);
    failMaybe();
    const had = proj.awards.some((a) => a.id === id) && !proj.goneNext;
    proj.goneNext = false;
    proj.awards = proj.awards.filter((a) => a.id !== id);
    return had;
  },
  createGift: async (input: Omit<ChoreStarGift, 'id' | 'createdAt' | 'updatedAt'>) => {
    writes.createGift(clone(input));
    failMaybe();
    const gift = { ...clone(input), id: `g${++seq}`, createdAt: T, updatedAt: T };
    proj.gifts = [...proj.gifts, gift as ChoreStarGift];
    return clone(gift);
  },
  removeGift: async (id: string) => {
    writes.removeGift(id);
    failMaybe();
    const had = proj.gifts.some((g) => g.id === id) && !proj.goneNext;
    proj.goneNext = false;
    proj.gifts = proj.gifts.filter((g) => g.id !== id);
    return had;
  },
}));

import { useStarStore } from '@/stores/starStore';
import {
  __resetLoadMaintenanceForTesting,
  __setStoresAuthoritativeForTesting,
  __whenLoadMaintenanceIdleForTesting,
  runLoadMaintenance,
} from '@/services/automerge/loadMaintenance';
import { markAuthoritative, resetProjection } from '@/services/automerge/projection';
import {
  ReadOnlyError,
  __resetWriteGateForTesting,
  setWriteGate,
} from '@/services/automerge/worker/writeGate';
import {
  REWARD_MARK_REF,
  choreMarkId,
  choreWeekRecord,
  indexMarks,
  shiftChoreDay,
} from '@/utils/chores';

type Store = ReturnType<typeof useStarStore>;
let store: Store;

const days7 = (start: string) => Array.from({ length: 7 }, (_, i) => shiftChoreDay(start, i));

function chore(id: string, assigneeIds: string[], over: Partial<Chore> = {}): Chore {
  return {
    id,
    title: id,
    emoji: '🧹',
    assigneeIds,
    block: 'morning',
    sortOrder: 0,
    createdBy: 'mom',
    createdAt: CHORE_T,
    updatedAt: CHORE_T,
    ...over,
  };
}
function mark(date: string, ref: string, memberId: string): ChoreMark {
  return {
    id: choreMarkId('done', memberId, date, ref),
    kind: 'done',
    memberId,
    date,
    ref,
    by: memberId,
    createdAt: T,
    updatedAt: T,
  };
}
const ticks = (memberId: string, dates: readonly string[]) =>
  dates.map((d) => mark(d, `c-${memberId}`, memberId));
function gift(memberId: string, date: string, stars: number, id = `gift-${date}-${stars}`) {
  return { id, memberId, date, stars, by: 'mom', createdAt: T, updatedAt: T } as ChoreStarGift;
}
function record(memberId: string, weekStart: string, over: Partial<ChoreWeek> = {}): ChoreWeek {
  return {
    id: `${memberId}:${weekStart}`,
    memberId,
    weekStart,
    done: 7,
    due: 7,
    stars: 7,
    bonus: 0,
    full: 7,
    bar: 7,
    days: [1, 1, 1, 1, 1, 1, 1],
    marks: 7,
    createdAt: T,
    updatedAt: T,
    ...over,
  };
}

const ON = {
  on: true,
  weeklyOn: true,
  barPct: 100,
  startedOn: W0,
  title: 'Ice cream',
  emoji: '🍦',
};

const logged = (message: string) =>
  logEvent.mock.calls
    .map((c) => c[0] as { level: string; message: string; context?: Record<string, unknown> })
    .filter((e) => e.message === message);
const starEvents = () =>
  logEvent.mock.calls.filter((c) => (c[0] as { surface: string }).surface === 'chore-stars');

/** Put the same data in the store arrays and the projection, load the store, clear the spies. */
async function setup(
  opts: {
    marks?: ChoreMark[];
    weeks?: ChoreWeek[];
    gifts?: ChoreStarGift[];
    awards?: ChoreAward[];
    chores?: Chore[];
  } = {}
): Promise<void> {
  const cs = opts.chores ?? [chore('c-kid', ['kid']), chore('c-sib', ['sib'])];
  chores.chores = clone(cs);
  chores.choreMarks = clone(opts.marks ?? []);
  proj.chores = clone(cs);
  proj.marks = clone(opts.marks ?? []);
  proj.weeks = clone(opts.weeks ?? []);
  proj.gifts = clone(opts.gifts ?? []);
  proj.awards = clone(opts.awards ?? []);
  await store.loadStars();
  vi.clearAllMocks();
  budget.calls = [];
  banner.calls = [];
  banner.shown = 0;
  markWrites.calls = [];
}

beforeEach(() => {
  // The fakes are module-level: stop the last test's store, or its day watcher reacts too.
  store?.$dispose();
  setActivePinia(createPinia());
  __resetLoadMaintenanceForTesting();
  doc.loaded = true;
  setRewardsState({ ...ON });
  settings.sent = [];
  settings.weekStartDay = 1;
  settings.failNext = null;
  family.members = ROSTER;
  chores.isLoaded = true;
  chores.todayYmd = MON;
  proj.failWrite = null;
  proj.goneNext = false;
  readFail.next = null;
  budget.allow = true;
  budget.calls = [];
  banner.result = 'played';
  banner.duringWait = null;
  banner.shown = 0;
  banner.calls = [];
  markWrites.fail = false;
  markWrites.calls = [];
  ticking.pending = null;
  ticking.waits = 0;
  __resetWriteGateForTesting();
  store = useStarStore();
  vi.clearAllMocks();
});

describe('loadStars', () => {
  it('reads the three collections and writes nothing', async () => {
    proj.weeks = [record('kid', W0)];
    proj.awards = [{ id: 'a1' } as ChoreAward];
    proj.gifts = [gift('kid', MON, 1)];
    await store.loadStars();
    expect(store.isLoaded).toBe(true);
    expect(store.weeks.map((w) => w.id)).toEqual([`kid:${W0}`]);
    expect(store.awards.map((a) => a.id)).toEqual(['a1']);
    expect(store.gifts).toHaveLength(1);
    expect(Object.values(writes).every((w) => w.mock.calls.length === 0)).toBe(true);
  });
});

// ─── Getters ────────────────────────────────────────────────────────────────

describe('getters answer nothing while off or not loaded', () => {
  it.each([
    ['never decided', {}, true],
    ['{ on: false }', { choreRewards: { on: false } }, true],
    ['on, stars not loaded', { choreRewards: { ...ON } }, false],
  ])('%s', async (_n, s, load) => {
    settings.settings = s;
    if (load) await setup({ marks: ticks('kid', [MON]) });
    expect(store.weekFor('kid')).toBeNull();
    expect(store.awardsFor('kid')).toEqual([]);
    expect(store.arcFor('kid')).toBeNull();
    expect(store.stripFor('kid')).toBeNull();
    expect(store.notesFor('kid')).toEqual([]);
    expect(store.lookbackWeeks).toEqual([]);
    expect(store.wallStarsFor('kid')).toBeNull();
    expect(store.valueFor('kid')).toBeNull();
  });

  it("valueFor: a kid's chore values (absent = 1); nothing for a grown-up", async () => {
    await setup();
    const value = store.valueFor('kid')!;
    expect(value({})).toBe(1);
    expect(value({ stars: 3 })).toBe(3);
    expect(store.valueFor('mom')).toBeNull();
  });

  it('a grown-up or a pet has no stars, even with the feature on', async () => {
    await setup();
    for (const id of ['mom', 'dad', 'rex']) {
      expect(store.weekFor(id)).toBeNull();
      expect(store.wallStarsFor(id)).toBeNull();
    }
    expect(store.earners).toEqual(['kid', 'sib']);
    expect(store.earnerMembers.map((m) => m.id)).toEqual(['kid', 'sib']);
  });

  it('earnerMembers follows family order; sortedAwards is the order the awards were made', async () => {
    family.members = [ROSTER[3]!, ...ROSTER.filter((m) => m.id !== 'sib')];
    await setup({
      awards: [
        { id: 'late', createdAt: `${T}9` } as ChoreAward,
        { id: 'early', createdAt: `${T}1` } as ChoreAward,
      ],
    });
    expect(store.earnerMembers.map((m) => m.id)).toEqual(['sib', 'kid']);
    expect(store.earners).toEqual(['sib', 'kid']);
    expect(store.sortedAwards.map((a) => a.id)).toEqual(['early', 'late']);
  });
});

describe('weekFor', () => {
  it('this week is live (ticks and gifts at once), even when an early record exists for it', async () => {
    const early = record('kid', MON, { stars: 99, marks: 99 }); // a fast clock froze it
    await setup({ marks: ticks('kid', [MON]), weeks: [early], gifts: [gift('kid', MON, 2)] });
    const w = store.weekFor('kid')!;
    expect(w).toMatchObject({ weekStart: MON, stars: 1, bonus: 2, total: 3, full: 7, bar: 7 });
    expect(w.openToday).toBe(0);
    expect(w.ahead).toBe(6);
  });

  it('a closed week reads its record; a closed week with none is null ("No record")', async () => {
    await setup({ weeks: [record('kid', W0, { stars: 5 })] });
    expect(store.weekFor('kid', '2026-11-12')).toMatchObject({ weekStart: W0, stars: 5 });
    expect(store.weekFor('kid', '2026-11-04')).toBeNull();
  });

  it('a record frozen before a week-start change is found by its own first day', async () => {
    // A Sunday week 11-08..11-14 was frozen; the family has since moved to Monday. The short
    // Monday week 11-09..11-15 (only 11-15 left to count) has no record of its own.
    await setup({ weeks: [record('kid', '2026-11-08', { stars: 4 })] });
    expect(store.weekFor('kid', '2026-11-08')).toMatchObject({ weekStart: '2026-11-08', stars: 4 });
    expect(store.weekFor('kid', W0)).toBeNull();
    expect(store.weekFor('kid')!.weekStart).toBe(MON);
  });
});

describe('awards, the arc, the strip, notes, look-back', () => {
  const saved = (over: Partial<ChoreAward> = {}): ChoreAward => ({
    id: 'saved',
    title: 'Disneyland',
    emoji: '🏰',
    kind: 'saved',
    unit: 'stars',
    price: 20,
    weekStart: W0,
    createdBy: 'mom',
    createdAt: T,
    updatedAt: T,
    ...over,
  });

  it('awardsFor counts the closed records and the open week; "as of" leaves later weeks out', async () => {
    await setup({
      weeks: [record('kid', W0, { stars: 7 })],
      marks: ticks('kid', [MON]),
      awards: [saved(), saved({ id: 'week', kind: 'week', price: 1, createdAt: `${T}2` })],
    });
    const now = store.awardsFor('kid');
    expect(now.map((s) => [s.award.id, s.progress.have])).toEqual([
      ['saved', 8],
      ['week', 1],
    ]);
    expect(now[1]!.progress.achievedOn).toBe(MON);
    const asOf = store.awardsFor('kid', W0);
    expect(asOf.map((s) => [s.award.id, s.progress.have])).toEqual([
      ['saved', 7],
      ['week', 7],
    ]);
  });

  it('arcFor: toward the weekly bar, with the badge once achieved', async () => {
    await setup({ marks: ticks('kid', [MON]) });
    expect(store.arcFor('kid')).toEqual({ percent: 14, count: 1, kind: 'week' });
    settings.settings = { choreRewards: { ...ON, barPct: 50 } }; // bar 4
    await setup({ marks: ticks('kid', [MON]), gifts: [gift('kid', MON, 3)] });
    expect(store.arcFor('kid')).toEqual({
      percent: 100,
      count: 4,
      kind: 'week',
      badgeEmoji: '🍦',
    });
  });

  it('arcFor: with no weekly reward, toward the nearest saved-up award; with neither, null', async () => {
    settings.settings = { choreRewards: { ...ON, weeklyOn: false } };
    await setup({ weeks: [record('kid', W0, { stars: 5 })], awards: [saved()] });
    // The count is the stars saved toward that award, so it is spoken as saved up.
    expect(store.arcFor('kid')).toEqual({ percent: 25, count: 5, kind: 'saved' });
    await setup({ weeks: [record('kid', W0, { stars: 5 })] });
    expect(store.arcFor('kid')).toBeNull();
  });

  it('stripFor: the path, its This Week marker and the nearest saved-up award', async () => {
    await setup({
      marks: ticks('kid', [MON]),
      awards: [saved(), saved({ id: 'movie', kind: 'week', price: 10, createdAt: `${T}2` })],
    });
    const strip = store.stripFor('kid')!;
    expect(strip.week.weekStart).toBe(MON);
    expect(strip.path).toMatchObject({ steps: 10, earned: 1, barAt: 6, awardAt: 9, toBar: 6 });
    expect(strip.nearest?.award.id).toBe('saved');
    expect(strip.thisWeek?.id).toBe('movie');
  });

  it('notesFor: today’s and yesterday’s gifts only, newest first', async () => {
    await setup({
      gifts: [
        gift('kid', shiftChoreDay(MON, -2), 1, 'old'),
        gift('kid', shiftChoreDay(MON, -1), 2, 'yesterday'),
        gift('kid', MON, 3, 'today'),
        gift('sib', MON, 4, 'sibling'),
      ],
    });
    expect(store.notesFor('kid').map((g) => g.id)).toEqual(['today', 'yesterday']);
  });

  it('lookbackWeeks: this week and four back, never a fifth', async () => {
    await setup();
    expect(store.lookbackWeeks).toEqual([MON, W0, '2026-11-02', '2026-10-26', '2026-10-19']);
  });

  it('lookbackWeeks after a week-start change: the short week, then the frozen weeks as they were', async () => {
    // Sunday weeks 11-01 and 11-08 were frozen; the family moved to Monday. The Monday week
    // 11-09..11-15 counts only 11-15 (the short week), and the stepper still reaches both.
    await setup({ weeks: [record('kid', '2026-11-01'), record('sib', '2026-11-08')] });
    expect(store.lookbackWeeks).toEqual([MON, W0, '2026-11-08', '2026-11-01', '2026-10-26']);
  });

  it('wallStarsFor: the arc and each chore’s value', async () => {
    await setup({ marks: ticks('kid', [MON]) });
    const bundle = store.wallStarsFor('kid')!;
    expect(bundle.lane).toEqual({ percent: 14, count: 1, kind: 'week' });
    expect(bundle.valueOf({ stars: 3 })).toBe(3);
    expect(bundle.valueOf({})).toBe(1);
  });
});

// ─── Grown-up actions ───────────────────────────────────────────────────────

const ACTIONS: Array<[string, (s: Store, actor: string) => Promise<unknown>]> = [
  ['setRewards', (s, a) => s.setRewards({ barPct: 80 }, a)],
  [
    'saveAward',
    (s, a) => s.saveAward({ title: 'X', emoji: '🎁', kind: 'saved', unit: 'stars', price: 5 }, a),
  ],
  ['deleteAward', (s, a) => s.deleteAward('award-1', a)],
  ['giveStars', (s, a) => s.giveStars({ memberId: 'kid', kind: 'bonus', count: 1 }, a)],
  ['removeGift', (s, a) => s.removeGift('gift-1', a)],
];

describe('who can write what (plan section 10)', () => {
  it.each(
    ACTIONS.flatMap(([name, run]) =>
      ['kid', 'rex', 'ghost', ''].map((actor) => [name, actor, run] as const)
    )
  )('%s refuses actor "%s" with notAdult and writes nothing', async (name, actor, run) => {
    await setup({
      awards: [{ id: 'award-1', kind: 'saved', unit: 'stars' } as ChoreAward],
      gifts: [gift('kid', MON, 1, 'gift-1')],
    });
    expect(await run(store, actor)).toBeNull();
    expect(showToast).toHaveBeenCalledWith('info', 'choreStars.error.notAdult');
    expect(logged('edit-refused')[0]!.context).toEqual({ action: name, detail: 'not-adult' });
    expect(settings.setChoreRewards).not.toHaveBeenCalled();
    expect(Object.values(writes).every((w) => w.mock.calls.length === 0)).toBe(true);
  });

  it.each(ACTIONS)('%s checks the actor before any other guard (feature off)', async (_n, run) => {
    settings.settings = { choreRewards: { on: false } };
    await setup();
    await run(store, 'kid');
    expect(logged('edit-refused')[0]!.context).toMatchObject({ detail: 'not-adult' });
  });
});

describe('setRewards', () => {
  it('turning on stamps startedOn, from a plain copy, and logs on', async () => {
    setRewardsState(undefined);
    await setup();
    expect(await store.setRewards({ on: true }, 'mom')).toBe(true);
    expect(settings.sent[0]).toEqual({ on: true, startedOn: MON });
    expect(logged('rewards-set')[0]!.context).toEqual({ action: 'on', detail: 'on' });
  });

  it('EVERY turn-on from off stamps startedOn again (a pause is never frozen); on while on does not', async () => {
    setRewardsState(undefined);
    await setup();
    await store.setRewards({ on: true }, 'mom');
    chores.todayYmd = '2026-11-20';
    await store.setRewards({ on: false }, 'mom');
    expect(settings.sent[1]).toEqual({ on: false, startedOn: MON });
    chores.todayYmd = '2026-12-09';
    await store.setRewards({ on: true }, 'dad');
    expect(settings.sent[2]).toEqual({ on: true, startedOn: '2026-12-09' });
    // Already on: a repeated turn-on (another device's stale switch) keeps the day.
    chores.todayYmd = '2026-12-10';
    await store.setRewards({ on: true }, 'mom');
    expect(settings.sent[3]).toEqual({ on: true, startedOn: '2026-12-09' });
  });

  it('turning it off from absent is { on: false }, logged as off (there is no "not now")', async () => {
    setRewardsState(undefined);
    await setup();
    await store.setRewards({ on: false }, 'mom');
    expect(settings.sent[0]).toEqual({ on: false });
    expect(logged('rewards-set')[0]!.context).toEqual({ action: 'off', detail: 'on' });
  });

  it('a patch writes the current object with only its keys changed; detail names the keys, never text', async () => {
    await setup();
    await store.setRewards({ barPct: 80, title: '  Pizza  ', weeklyOn: true }, 'mom');
    expect(settings.sent[0]).toEqual({
      ...ON,
      barPct: 80,
      title: 'Pizza',
      weeklyOn: true,
    });
    expect(logged('rewards-set')[0]!.context).toEqual({
      action: 'update',
      detail: 'weekly+bar+reward',
    });
    expect(JSON.stringify(logEvent.mock.calls)).not.toContain('Pizza');
  });

  it('builds from the PROJECTION, not a lagging store copy: a peer’s keys are never written back stale or dropped', async () => {
    await setup();
    // Another grown-up renamed the reward and changed its emoji; this store has not caught up.
    settings.settings = { choreRewards: { ...ON, title: 'Old', emoji: undefined } };
    settings.projected = { ...ON, title: 'Pizza night', emoji: '🍕' };
    await store.setRewards({ barPct: 80 }, 'mom');
    expect(settings.sent[0]).toEqual({ ...ON, title: 'Pizza night', emoji: '🍕', barPct: 80 });
    // And a turn-on decides "from off" by the projection too: on there, so no new stamp.
    settings.settings = { choreRewards: { on: false } };
    await store.setRewards({ on: true }, 'mom');
    expect(settings.sent[1]!.startedOn).toBe(W0);
  });

  it.each([
    ['a bar off the grid', { barPct: 47 }],
    ['a bar too low', { barPct: 40 }],
    ['startedOn sent', { startedOn: '2020-01-01' } as never],
    ['an unknown key', { colour: 'red' } as never],
    ['the retired take-back switch', { takeBack: true } as never],
    ['a title too long', { title: 'x'.repeat(61) }],
    ['a non-boolean switch', { on: 'yes' } as never],
    ['nothing at all', {}],
  ])('%s is the invalid refusal', async (_n, patch) => {
    await setup();
    expect(await store.setRewards(patch, 'mom')).toBeNull();
    expect(logged('edit-refused')[0]!.context).toEqual({ action: 'setRewards', detail: 'invalid' });
    expect(settings.setChoreRewards).not.toHaveBeenCalled();
  });

  it('a failed save resolves null (toasted and reported once by write) and logs no rewards-set', async () => {
    await setup();
    settings.failNext = new Error('disk');
    expect(await store.setRewards({ barPct: 90 }, 'mom')).toBeNull();
    expect(showToast).toHaveBeenCalledWith('error', 'disk', undefined, expect.anything());
    expect(logged('rewards-set')).toEqual([]);
  });
});

describe('turning it off records the books as they stand', () => {
  const FRI = '2026-11-20';
  const NEXT_MON = '2026-11-23';
  const savedUp = {
    id: 'saved',
    title: 'Zoo',
    emoji: '🦁',
    kind: 'saved',
    unit: 'stars',
    price: 100,
    weekStart: W0,
    createdBy: 'mom',
    createdAt: T,
    updatedAt: T,
  } as ChoreAward;

  it('off on Friday, on the next Monday: the off week has a record with its stars, and it counts toward a saved-up special reward', async () => {
    chores.todayYmd = FRI;
    await setup({ marks: ticks('kid', days7(MON).slice(0, 5)), awards: [savedUp] });
    await store.setRewards({ on: false }, 'mom');
    // Written BEFORE the setting, in one batch; the sib earned nothing, so has no record.
    expect(writes.setChoreWeeks).toHaveBeenCalledTimes(1);
    expect(settings.setChoreRewards.mock.invocationCallOrder[0]).toBeGreaterThan(
      writes.setChoreWeeks.mock.invocationCallOrder[0]!
    );
    const written = writes.setChoreWeeks.mock.calls[0]![0] as ChoreWeek[];
    expect(
      written.filter((w) => w.weekStart === MON).map((w) => [w.memberId, w.stars, w.marks])
    ).toEqual([['kid', 5, 5]]);
    // The closed week the close would still write (last week, not yet frozen) goes in the same
    // batch.
    expect(written.filter((w) => w.weekStart === W0).map((w) => w.memberId)).toEqual([
      'kid',
      'sib',
    ]);
    expect(budget.calls).toEqual([]); // a grown-up's action, not an automatic write
    expect(logged('week-recorded-at-off')[0]!.context).toEqual({
      count: 3,
      detail: 'created:3+resettled:0',
    });
    expect(settings.sent.at(-1)!.on).toBe(false);
    // The next Monday, on again: the off week reads its record and counts.
    chores.todayYmd = NEXT_MON;
    await store.setRewards({ on: true }, 'mom');
    expect(store.weekFor('kid', MON)).toMatchObject({ stars: 5, total: 5 });
    const standing = store.awardsFor('kid').find((x) => x.award.id === 'saved')!;
    expect(standing.progress.stars).toBe(5);
    // The close after the turn-on leaves it as it is (the week is before `startedOn`).
    vi.clearAllMocks();
    await store.closeWeeks();
    expect(writes.setChoreWeeks).not.toHaveBeenCalled();
  });

  it('off and on within the same week: nothing is counted twice, and the week later closes with the ticks after the turn-on', async () => {
    setRewardsState({ ...ON, startedOn: MON });
    chores.todayYmd = '2026-11-18'; // Wednesday
    await setup({ marks: ticks('kid', days7(MON).slice(0, 3)) });
    await store.setRewards({ on: false }, 'mom');
    expect(proj.weeks.map((w) => [w.id, w.stars])).toEqual([[`kid:${MON}`, 3]]);
    await store.setRewards({ on: true }, 'mom');
    // The early record is ignored while the week is open: the live week, counted once.
    expect(store.weekFor('kid')).toMatchObject({ stars: 3, total: 3 });
    expect(store.awardsFor('kid')).toEqual([]);
    // Two more ticks, then the week ends: the close re-settles it (more marks), once.
    const more = ticks('kid', days7(MON).slice(3, 5));
    chores.choreMarks = [...chores.choreMarks, ...more];
    proj.marks = [...proj.marks, ...more];
    chores.todayYmd = NEXT_MON;
    await nextTick();
    await store.closeWeeks();
    expect(proj.weeks.filter((w) => w.memberId === 'kid')).toEqual([
      expect.objectContaining({ weekStart: MON, stars: 5, marks: 5 }),
    ]);
    expect(store.weekFor('kid', MON)).toMatchObject({ stars: 5 });
  });

  it('off with nothing earned writes nothing (and logs a count of 0)', async () => {
    setRewardsState({ ...ON, startedOn: MON });
    chores.todayYmd = FRI;
    await setup();
    await store.setRewards({ on: false }, 'mom');
    expect(writes.setChoreWeeks).not.toHaveBeenCalled();
    expect(logged('week-recorded-at-off')[0]!.context).toMatchObject({ count: 0 });
    expect(settings.sent.at(-1)!.on).toBe(false);
  });

  it.each([
    ['a read throws', () => (readFail.next = new Error('disk')), 'write-failed'],
    ['the write throws', () => (proj.failWrite = new Error('disk')), 'write-failed'],
    ['the doc is not loaded', () => (doc.loaded = false), 'not-loaded'],
  ])(
    'a record that cannot be written (%s) refuses the turn-off: null, no setting written, the switch stays on, a critical report and an error toast',
    async (_n, breakIt, detail) => {
      chores.todayYmd = FRI;
      await setup({ marks: ticks('kid', days7(MON).slice(0, 5)) });
      breakIt();
      expect(await store.setRewards({ on: false }, 'mom')).toBeNull();
      proj.failWrite = null;
      readFail.next = null;
      doc.loaded = true;
      expect(settings.setChoreRewards).not.toHaveBeenCalled();
      expect(settings.sent).toEqual([]);
      expect(store.rewards.on).toBe(true);
      expect(store.isOn).toBe(true);
      expect(reportError).toHaveBeenCalledWith(
        expect.objectContaining({
          surface: 'chore-stars',
          severity: 'critical',
          context: { action: 'off-record-failed', detail },
        })
      );
      expect(showToast).toHaveBeenCalledWith(
        'error',
        'choreStars.error.offNotRecorded',
        undefined,
        { silent: true }
      );
      expect(logged('rewards-set')).toEqual([]);
      // Tried again once it works: recorded, then turned off.
      expect(await store.setRewards({ on: false }, 'mom')).toBe(true);
      expect(proj.weeks.some((w) => w.memberId === 'kid' && w.weekStart === MON)).toBe(true);
      expect(settings.sent.at(-1)!.on).toBe(false);
    }
  );

  it('a read-only family can still turn it off: the record is skipped before any write (no gate toast), one info event, no critical report, no error toast', async () => {
    chores.todayYmd = FRI;
    await setup({ marks: ticks('kid', days7(MON).slice(0, 5)) });
    setWriteGate(() => ({ block: true, wouldBlock: false }));
    expect(await store.setRewards({ on: false }, 'mom')).toBe(true);
    expect(writes.setChoreWeeks).not.toHaveBeenCalled();
    expect(reads.marks).not.toHaveBeenCalled();
    expect(settings.sent.at(-1)!.on).toBe(false);
    expect(store.isOn).toBe(false);
    expect(reportError).not.toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();
    expect(logged('off-record-skipped').map((e) => [e.level, e.context])).toEqual([
      ['info', { detail: 'read-only' }],
    ]);
    expect(logged('week-recorded-at-off')).toEqual([]);
    expect(logged('rewards-set')[0]!.context).toMatchObject({ action: 'off' });
  });

  it('a ReadOnlyError from the record write (the gate flipped mid-call) is the same read-only skip, not a failure', async () => {
    chores.todayYmd = FRI;
    await setup({ marks: ticks('kid', days7(MON).slice(0, 5)) });
    proj.failWrite = new ReadOnlyError('choreWeeks');
    expect(await store.setRewards({ on: false }, 'mom')).toBe(true);
    expect(settings.sent.at(-1)!.on).toBe(false);
    expect(reportError).not.toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalledWith(
      'error',
      'choreStars.error.offNotRecorded',
      undefined,
      expect.anything()
    );
    expect(logged('off-record-skipped')[0]!.context).toEqual({ detail: 'read-only' });
  });

  it('a patch that is not a turn-off (or off while already off) records nothing', async () => {
    chores.todayYmd = FRI;
    await setup({ marks: ticks('kid', days7(MON).slice(0, 5)) });
    await store.setRewards({ barPct: 90 }, 'mom');
    setRewardsState({ ...ON, on: false });
    await store.setRewards({ on: false }, 'mom');
    expect(writes.setChoreWeeks).not.toHaveBeenCalled();
    expect(reads.marks).not.toHaveBeenCalled();
  });
});

describe('awards', () => {
  const draft = {
    title: ' Movie night ',
    emoji: '🎬',
    kind: 'week' as const,
    unit: 'stars' as const,
    price: 30,
  };

  it('creates an award counting from this week, logs no title', async () => {
    await setup();
    const a = await store.saveAward({ ...draft, repeats: true }, 'mom');
    expect(writes.createAward.mock.calls[0]![0]).toEqual({
      title: 'Movie night',
      emoji: '🎬',
      kind: 'week',
      unit: 'stars',
      price: 30,
      weekStart: MON,
      createdBy: 'mom',
    });
    expect(a?.id).toBeDefined();
    expect(store.awards).toHaveLength(1);
    expect(logged('award-saved')[0]!.context).toEqual({
      action: 'create',
      kind: 'week',
      detail: 'stars',
      count: 0,
    });
    expect(JSON.stringify(logEvent.mock.calls)).not.toContain('Movie');
  });

  it('chosen kids: stored in family order; every kid chosen is stored as every kid (absent); a non-kid is dropped', async () => {
    await setup();
    await store.saveAward({ ...draft, memberIds: ['sib', 'mom'] }, 'mom');
    expect(writes.createAward.mock.calls[0]![0].memberIds).toEqual(['sib']);
    expect(logged('award-saved')[0]!.context).toMatchObject({ count: 1 });
    await store.saveAward({ ...draft, memberIds: ['sib', 'kid'] }, 'mom');
    expect(writes.createAward.mock.calls[1]![0].memberIds).toBeUndefined();
    // An edit back to every kid deletes the key (a based patch with `memberIds: undefined`).
    const a = store.awards.find((x) => x.memberIds)!;
    await store.saveAward({ ...draft, id: a.id }, 'mom');
    const patch = writes.updateAward.mock.calls[0]![1] as Record<string, unknown>;
    expect('memberIds' in patch && patch.memberIds === undefined).toBe(true);
    expect(store.awards.find((x) => x.id === a.id)).not.toHaveProperty('memberIds');
  });

  it('chosen kids that are not kids at all is the invalid refusal', async () => {
    await setup();
    expect(await store.saveAward({ ...draft, memberIds: ['mom', 'rex'] }, 'mom')).toBeNull();
    expect(logged('edit-refused')[0]!.context).toEqual({ action: 'saveAward', detail: 'invalid' });
  });

  it('a special reward for one kid is read only for that kid (awardsFor, the arc, the strip); a left member id is ignored', async () => {
    const forKid = {
      id: 'kid-only',
      title: 'Zoo',
      emoji: '🦁',
      kind: 'saved',
      unit: 'stars',
      price: 50,
      memberIds: ['kid', 'gone-member'],
      weekStart: W0,
      createdBy: 'mom',
      createdAt: T,
      updatedAt: T,
    } as ChoreAward;
    const thisWeek = { ...forKid, id: 'sib-week', kind: 'week', price: 3, memberIds: ['sib'] };
    setRewardsState({ ...ON, weeklyOn: false });
    await setup({
      awards: [forKid, thisWeek as ChoreAward],
      marks: [...ticks('kid', days7(MON).slice(0, 2)), ...ticks('sib', days7(MON).slice(0, 1))],
    });
    expect(store.awardsFor('kid').map((x) => x.award.id)).toEqual(['kid-only']);
    expect(store.awardsFor('sib').map((x) => x.award.id)).toEqual(['sib-week']);
    // No weekly reward: the kid's arc is toward their own saved-up reward; the sib has none.
    expect(store.arcFor('kid')).toMatchObject({ kind: 'saved', count: 2 });
    expect(store.arcFor('sib')).toBeNull();
    expect(store.stripFor('kid')!.thisWeek).toBeNull();
    expect(store.stripFor('sib')!.thisWeek?.id).toBe('sib-week');
    expect(store.stripFor('sib')!.nearest).toBeNull();
  });

  it('edits with a based patch; switching to This Week drops repeats', async () => {
    await setup();
    const a = (await store.saveAward(
      { title: 'Disney', emoji: '🏰', kind: 'saved', unit: 'weeks', price: 4.5, repeats: true },
      'mom'
    ))!;
    await store.saveAward({ ...draft, id: a.id }, 'dad');
    expect(writes.updateAward.mock.calls[0]).toEqual([
      a.id,
      {
        title: 'Movie night',
        emoji: '🎬',
        kind: 'week',
        unit: 'stars',
        price: 30,
        repeats: undefined,
      },
    ]);
    expect(store.awards[0]).not.toHaveProperty('repeats');
    expect(store.awards[0]!.weekStart).toBe(MON);
  });

  it("an edit that sends back the stored kids keeps them as stored, even when none of them earns stars now (a rename never makes it everyone's)", async () => {
    await setup();
    const a = (await store.saveAward({ ...draft, memberIds: ['sib'] }, 'mom'))!;
    expect(a.memberIds).toEqual(['sib']);
    // The sib leaves; one kid remains. The drawer sends the stored list back with a new name.
    family.members = ROSTER.filter((m) => m.id !== 'sib');
    const renamed = await store.saveAward(
      { ...draft, title: 'Movie night out', id: a.id, memberIds: ['sib'] },
      'mom'
    );
    expect(renamed).not.toBeNull();
    const patch = writes.updateAward.mock.calls.at(-1)![1] as Record<string, unknown>;
    expect(patch).not.toHaveProperty('memberIds');
    expect(patch.title).toBe('Movie night out');
    expect(store.awards[0]!.memberIds).toEqual(['sib']);
    // Not the kid who is left, and not a kid who joins later.
    expect(store.awardsFor('kid').map((s) => s.award.id)).toEqual([]);
    // A real change is still a change: for every kid now.
    await store.saveAward({ ...draft, id: a.id, memberIds: undefined }, 'mom');
    expect(writes.updateAward.mock.calls.at(-1)![1]).toHaveProperty('memberIds', undefined);
    expect(store.awards[0]).not.toHaveProperty('memberIds');
  });

  it.each([
    ['no title', { ...draft, title: '  ' }],
    ['no emoji', { ...draft, emoji: '' }],
    ['a bad kind', { ...draft, kind: 'monthly' as never }],
    ['a fractional stars price', { ...draft, price: 2.5 }],
    ['a zero price', { ...draft, price: 0 }],
    ['weeks with two decimals', { ...draft, unit: 'weeks' as const, price: 1.25 }],
  ])('%s is the invalid refusal', async (_n, d) => {
    await setup();
    expect(await store.saveAward(d, 'mom')).toBeNull();
    expect(logged('edit-refused')[0]!.context).toEqual({ action: 'saveAward', detail: 'invalid' });
    expect(writes.createAward).not.toHaveBeenCalled();
  });

  it('off is refused', async () => {
    settings.settings = { choreRewards: { on: false } };
    await setup();
    expect(await store.saveAward(draft, 'mom')).toBeNull();
    expect(logged('edit-refused')[0]!.context).toMatchObject({ detail: 'off' });
  });

  it('an award removed on another device is notFound, before and during the write', async () => {
    await setup({ awards: [{ ...(draft as object), id: 'a1', weekStart: W0 } as ChoreAward] });
    expect(await store.saveAward({ ...draft, id: 'nope' }, 'mom')).toBeNull();
    expect(logged('edit-refused').at(-1)!.context).toMatchObject({ detail: 'not-found' });
    proj.goneNext = true;
    expect(await store.saveAward({ ...draft, id: 'a1' }, 'mom')).toBeNull();
    expect(showToast).toHaveBeenLastCalledWith('info', 'choreStars.error.notFound');
    expect(store.awards).toEqual([]);
    proj.awards = [{ id: 'a2', kind: 'saved', unit: 'stars' } as ChoreAward];
    await store.loadStars();
    proj.goneNext = true;
    expect(await store.deleteAward('a2', 'mom')).toBeNull();
    expect(logged('award-saved')).toEqual([]);
  });

  it('deletes and logs the kind and unit', async () => {
    await setup({ awards: [{ id: 'a1', kind: 'saved', unit: 'weeks' } as ChoreAward] });
    expect(await store.deleteAward('a1', 'mom')).toBe(true);
    expect(store.awards).toEqual([]);
    expect(logged('award-saved')[0]!.context).toEqual({
      action: 'delete',
      kind: 'saved',
      detail: 'weeks',
    });
  });
});

describe('gifts', () => {
  it('a bonus needs no note, is dated today and logs the count', async () => {
    await setup();
    const g = await store.giveStars({ memberId: 'kid', kind: 'bonus', count: 2 }, 'mom');
    expect(writes.createGift.mock.calls[0]![0]).toEqual({
      memberId: 'kid',
      date: MON,
      stars: 2,
      by: 'mom',
      note: undefined,
    });
    expect(g?.stars).toBe(2);
    expect(store.weekFor('kid')!.bonus).toBe(2);
    expect(logged('stars-given')[0]!.context).toEqual({ action: 'give', count: 2 });
  });

  it('a take-back (always open to a grown-up) is stored negative with its reason; the note never reaches telemetry', async () => {
    await setup({ marks: ticks('kid', [MON]), gifts: [gift('kid', MON, 3)] });
    await store.giveStars(
      { memberId: 'kid', kind: 'take', count: 2, note: ' Left the bikes out ' },
      'mom'
    );
    expect(writes.createGift.mock.calls[0]![0]).toMatchObject({
      stars: -2,
      note: 'Left the bikes out',
    });
    expect(logged('stars-given')[0]!.context).toEqual({ action: 'take', count: 2 });
    expect(JSON.stringify(logEvent.mock.calls)).not.toContain('bikes');
  });

  it.each([
    ['no reason', { kind: 'take', count: 1, note: '  ' }, {}, 'note-required'],
    ['more than the week', { kind: 'take', count: 5, note: 'x' }, {}, 'over-week'],
    ['zero stars', { kind: 'bonus', count: 0 }, {}, 'invalid'],
    ['a long note', { kind: 'bonus', count: 1, note: 'x'.repeat(81) }, {}, 'invalid'],
  ] as const)('%s is refused (%s)', async (_n, input, extra, detail) => {
    settings.settings = { choreRewards: { ...ON, ...extra } };
    await setup({ marks: ticks('kid', [MON]) }); // the kid has 1 star this week
    expect(await store.giveStars({ memberId: 'kid', ...input }, 'mom')).toBeNull();
    expect(logged('edit-refused')[0]!.context).toEqual({ action: 'giveStars', detail });
    expect(writes.createGift).not.toHaveBeenCalled();
  });

  it('over-week names the child and their stars in the toast only', async () => {
    await setup({ marks: ticks('kid', [MON]) });
    await store.giveStars({ memberId: 'kid', kind: 'take', count: 3, note: 'x' }, 'mom');
    expect(showToast).toHaveBeenCalledWith('info', 'over:kid:1');
    expect(JSON.stringify(logEvent.mock.calls)).not.toContain('kid:1');
  });

  it('a grown-up or a pet cannot be given stars (notEarner); off is refused', async () => {
    await setup();
    expect(await store.giveStars({ memberId: 'dad', kind: 'bonus', count: 1 }, 'mom')).toBeNull();
    expect(await store.giveStars({ memberId: 'rex', kind: 'bonus', count: 1 }, 'mom')).toBeNull();
    expect(logged('edit-refused').map((e) => e.context!.detail)).toEqual([
      'not-earner',
      'not-earner',
    ]);
    settings.settings = { choreRewards: { on: false } };
    expect(await store.giveStars({ memberId: 'kid', kind: 'bonus', count: 1 }, 'mom')).toBeNull();
    expect(logged('edit-refused').at(-1)!.context!.detail).toBe('off');
  });

  it('removeGift: removes one in the open week; refuses a finished week and a missing gift', async () => {
    await setup({
      gifts: [gift('kid', MON, 2, 'now'), gift('kid', shiftChoreDay(MON, -1), 1, 'lastweek')],
    });
    expect(await store.removeGift('now', 'mom')).toBe(true);
    expect(store.gifts.map((g) => g.id)).toEqual(['lastweek']);
    expect(logged('gift-removed')[0]!.context).toEqual({ action: 'give' });
    expect(await store.removeGift('lastweek', 'mom')).toBeNull();
    expect(logged('edit-refused')[0]!.context).toEqual({
      action: 'removeGift',
      detail: 'week-closed',
    });
    expect(await store.removeGift('nope', 'mom')).toBeNull();
    expect(logged('edit-refused')[1]!.context!.detail).toBe('not-found');
    expect(writes.removeGift).toHaveBeenCalledTimes(1);
  });

  it('a failed write is toasted by write, resolves null, and is not logged as given', async () => {
    await setup();
    proj.failWrite = new Error('disk');
    expect(await store.giveStars({ memberId: 'kid', kind: 'bonus', count: 1 }, 'mom')).toBeNull();
    expect(showToast).toHaveBeenCalledWith('error', 'disk', undefined, expect.anything());
    expect(logged('stars-given')).toEqual([]);
  });
});

// ─── The achieved moment ────────────────────────────────────────────────────

describe('the achieved banner: claimed only while a banner host is mounted', () => {
  /** Let the store's watcher run and every claim step settle. */
  const settle = async () => {
    for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 0));
  };
  /** The kid has 6 of 7 stars on Sunday, the week's last day; Sunday's chore takes them to 7. */
  async function nearTheBar(): Promise<void> {
    chores.todayYmd = '2026-11-22';
    await setup({ marks: ticks('kid', days7(MON).slice(0, 6)) });
    __setStoresAuthoritativeForTesting(true);
  }
  const tickSunday = () => {
    chores.choreMarks = [...chores.choreMarks, ...ticks('kid', ['2026-11-22'])];
  };
  const untickSunday = () => {
    chores.choreMarks = chores.choreMarks.filter(
      (m) => !(m.kind === 'done' && m.date === '2026-11-22')
    );
  };
  const host = (memberId = 'kid', surface: 'app' | 'wall' = 'app') =>
    store.hostRewardBanner(memberId, surface);

  it('a tick past the bar while the kid’s lane is mounted writes the mark once and plays once', async () => {
    await nearTheBar();
    host('kid', 'wall');
    await settle();
    expect(markWrites.calls).toEqual([]); // 6 of 7: nothing owed
    tickSunday();
    await settle();
    expect(markWrites.calls).toEqual([['kid', MON, REWARD_MARK_REF, 'kid']]);
    expect(banner.calls).toHaveLength(1);
    expect(banner.shown).toBe(1);
    expect(banner.calls[0]!.beanName).toBe('kid');
    expect(logged('reward-achieved')[0]!.context).toEqual({
      kind: 'weekly',
      detail: 'wall',
      stage: 'marked',
    });
    expect(logged('achieved-banner')[0]!.context).toEqual({ detail: 'played' });
    // It waited for this device's ticks of the kid to settle before the banner's own wait.
    expect(ticking.waits).toBe(1);
  });

  it('a marked week never replays: not on a later tick, an untick and re-tick, or a remount (a reload)', async () => {
    await nearTheBar();
    tickSunday();
    const release = host();
    await settle();
    expect(banner.shown).toBe(1);
    untickSunday();
    await settle();
    tickSunday();
    await settle();
    release();
    host();
    await settle();
    expect(markWrites.calls).toHaveLength(1);
    expect(banner.calls).toHaveLength(1);
  });

  it('no host mounted: nothing is claimed, whoever ticks', async () => {
    await nearTheBar();
    tickSunday();
    await settle();
    expect(markWrites.calls).toEqual([]);
    expect(banner.calls).toEqual([]);
    expect(starEvents()).toEqual([]);
  });

  it('a grown-up completes the week from a home card (no host): it plays when the kid’s day is next mounted', async () => {
    await nearTheBar();
    tickSunday(); // the bar-crossing tick is the week's last chore; there is no later tick
    await settle();
    expect(banner.calls).toEqual([]);
    host('kid', 'app');
    await settle();
    expect(markWrites.calls).toEqual([['kid', MON, REWARD_MARK_REF, 'kid']]);
    expect(banner.shown).toBe(1);
  });

  it('leaving during the wait claims nothing; returning plays it', async () => {
    await nearTheBar();
    const release = host('kid', 'wall');
    banner.duringWait = release; // the wall leaves the chore view behind the block celebration
    tickSunday();
    await settle();
    expect(markWrites.calls).toEqual([]);
    expect(banner.shown).toBe(0);
    expect(logged('achieved-banner')[0]!.context).toEqual({ detail: 'host-left' });
    banner.duringWait = null;
    host('kid', 'wall');
    await settle();
    expect(markWrites.calls).toEqual([['kid', MON, REWARD_MARK_REF, 'kid']]);
    expect(banner.shown).toBe(1);
  });

  it('an untick below the bar during the wait drops it; the re-tick plays it', async () => {
    await nearTheBar();
    host();
    banner.duringWait = untickSunday;
    tickSunday();
    await settle();
    expect(logged('achieved-banner')[0]!.context).toEqual({ detail: 'dropped' });
    expect(markWrites.calls).toEqual([]);
    banner.duringWait = null;
    tickSunday();
    await settle();
    expect(markWrites.calls).toEqual([['kid', MON, REWARD_MARK_REF, 'kid']]);
    expect(banner.shown).toBe(1);
  });

  it('the claim waits for this device’s ticks of that kid to settle first', async () => {
    await nearTheBar();
    let release!: () => void;
    ticking.pending = new Promise<void>((r) => (release = r));
    host();
    tickSunday();
    await settle();
    expect(banner.calls).toEqual([]); // the block celebration may not have started yet
    release();
    await settle();
    expect(banner.shown).toBe(1);
  });

  it('a bonus past the bar plays it while a host is mounted (no tick needed)', async () => {
    chores.todayYmd = '2026-11-21';
    await setup({ marks: ticks('kid', days7(MON).slice(0, 5)) });
    __setStoresAuthoritativeForTesting(true);
    host();
    await store.giveStars({ memberId: 'kid', kind: 'bonus', count: 2 }, 'mom');
    await settle();
    expect(markWrites.calls).toHaveLength(1);
    expect(banner.shown).toBe(1);
  });

  it('two hosts of one kid on one device, and two changes at once: one claim, one banner', async () => {
    await nearTheBar();
    host('kid', 'app');
    host('kid', 'wall');
    tickSunday();
    chores.choreMarks = [...chores.choreMarks];
    await settle();
    expect(markWrites.calls).toHaveLength(1);
    expect(banner.calls).toHaveLength(1);
  });

  it('never for a grown-up’s or a pet’s host, while off, with no weekly reward, or on a snapshot copy', async () => {
    await nearTheBar();
    tickSunday();
    __setStoresAuthoritativeForTesting(false);
    const releaseKid = host();
    host('mom');
    host('rex');
    await settle();
    expect(markWrites.calls).toEqual([]); // not authoritative yet
    releaseKid();
    __setStoresAuthoritativeForTesting(true);
    setRewardsState({ ...ON, weeklyOn: false });
    host();
    await settle();
    expect(markWrites.calls).toEqual([]);
    setRewardsState({ ...ON, on: false });
    await settle();
    expect(markWrites.calls).toEqual([]);
    // On, with the weekly reward, authoritative: the kid's host claims (the grown-ups' never).
    setRewardsState({ ...ON });
    await settle();
    expect(markWrites.calls).toEqual([['kid', MON, REWARD_MARK_REF, 'kid']]);
  });

  it('a failed mark write still shows the banner here, once; the next claim retries the mark silently', async () => {
    await nearTheBar();
    host();
    markWrites.fail = true;
    tickSunday();
    await settle();
    expect(banner.shown).toBe(1);
    expect(markWrites.calls).toHaveLength(1);
    expect(logged('reward-achieved')[0]!.context).toMatchObject({ stage: 'unmarked' });
    // A later change re-runs the claim: the latch keeps it to one banner, the mark is retried.
    markWrites.fail = false;
    chores.choreMarks = [...chores.choreMarks];
    await settle();
    expect(markWrites.calls).toHaveLength(2);
    expect(banner.calls).toHaveLength(1);
    chores.choreMarks = [...chores.choreMarks];
    await settle();
    expect(markWrites.calls).toHaveLength(2); // marked now
  });

  it('a mark write that keeps failing is retried once this session, not on every recompute', async () => {
    await nearTheBar();
    host();
    markWrites.fail = true;
    tickSunday();
    await settle();
    for (let i = 0; i < 5; i++) {
      chores.choreMarks = [...chores.choreMarks];
      await settle();
    }
    // The claim's write, then ONE silent retry; the banner played once.
    expect(markWrites.calls).toHaveLength(2);
    expect(banner.calls).toHaveLength(1);
    expect(banner.shown).toBe(1);
  });

  it('while the family is read-only nothing is claimed (no write, no toast, no banner); once writable it is', async () => {
    const readOnly = ref(true);
    setWriteGate(() => ({ block: readOnly.value, wouldBlock: false }));
    await nearTheBar();
    host();
    tickSunday();
    await settle();
    chores.choreMarks = [...chores.choreMarks];
    await settle();
    expect(markWrites.calls).toEqual([]);
    expect(banner.calls).toEqual([]);
    expect(showToast).not.toHaveBeenCalled();
    expect(logged('skipped while the family is read-only')).toHaveLength(1);
    readOnly.value = false;
    await settle();
    expect(markWrites.calls).toEqual([['kid', MON, REWARD_MARK_REF, 'kid']]);
    expect(banner.shown).toBe(1);
  });

  it('the banner outcome (played, waited) is logged as the composable answers it', async () => {
    await nearTheBar();
    banner.result = 'waited';
    host();
    tickSunday();
    await settle();
    expect(logged('achieved-banner')[0]!.context).toEqual({ detail: 'waited' });
  });

  it('a mark another device wrote first shows nothing (skipped-exists)', async () => {
    await nearTheBar();
    const orig = chores.writeCelebratedMark;
    chores.writeCelebratedMark = async () => 'exists';
    host();
    tickSunday();
    await settle();
    expect(banner.shown).toBe(0);
    expect(logged('achieved-banner')[0]!.context).toEqual({ detail: 'skipped-exists' });
    expect(logged('reward-achieved')).toEqual([]);
    chores.writeCelebratedMark = orig;
  });

  it('a throwing check is reported as achieved-check-failed and never escapes', async () => {
    await nearTheBar();
    host();
    const weekFor = chores.weekFor;
    chores.weekFor = () => {
      throw new Error('boom');
    };
    tickSunday();
    await settle();
    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({
        surface: 'chore-stars',
        severity: 'warning',
        context: { action: 'achieved-check-failed' },
      })
    );
    chores.weekFor = weekFor;
  });
});

// ─── The feature off: silent ────────────────────────────────────────────────

describe('a family that never turned stars on', () => {
  it('produces no chore-stars event and no week-close worker read, whatever happens', async () => {
    settings.settings = {};
    await setup({ marks: ticks('kid', days7(W0)) });
    await store.closeWeeks();
    markAuthoritative();
    runLoadMaintenance('reload');
    await __whenLoadMaintenanceIdleForTesting();
    resetProjection();
    chores.todayYmd = '2026-11-17';
    await nextTick();
    __setStoresAuthoritativeForTesting(true);
    store.hostRewardBanner('kid', 'app');
    chores.choreMarks = [...chores.choreMarks, ...ticks('kid', ['2026-11-17'])];
    await new Promise((r) => setTimeout(r, 0));
    expect(starEvents()).toEqual([]);
    expect(reportError).not.toHaveBeenCalled();
    for (const r of Object.values(reads)) expect(r).not.toHaveBeenCalled();
    expect(budget.calls).toEqual([]);
    expect(markWrites.calls).toEqual([]);
  });
});

// ─── Closing a week ─────────────────────────────────────────────────────────

describe('closeWeeks', () => {
  it.each([
    ['absent (never decided)', {}],
    ['{ on: false }', { choreRewards: { on: false } }],
  ])('off (%s): no read, no budget, no write and no log', async (_n, s) => {
    await setup({ marks: ticks('kid', days7(W0)) });
    settings.settings = s;
    await store.closeWeeks();
    for (const r of Object.values(reads)) expect(r).not.toHaveBeenCalled();
    expect(budget.calls).toEqual([]);
    expect(writes.setChoreWeeks).not.toHaveBeenCalled();
    expect(logEvent).not.toHaveBeenCalled();
  });

  it('not loaded: logs week-close-skipped not-loaded and reads nothing', async () => {
    chores.isLoaded = false;
    await store.closeWeeks();
    expect(logged('week-close-skipped')[0]!.context).toEqual({ detail: 'not-loaded' });
    expect(reads.weeks).not.toHaveBeenCalled();
    expect(writes.setChoreWeeks).not.toHaveBeenCalled();
  });

  it('nothing to write: no projection read, no budget, no log', async () => {
    await setup({ marks: ticks('kid', days7(W0)) });
    await store.closeWeeks(); // freezes the week for both kids
    await setup({ marks: ticks('kid', days7(W0)), weeks: proj.weeks });
    await store.closeWeeks();
    for (const r of Object.values(reads)) expect(r).not.toHaveBeenCalled();
    expect(budget.calls).toEqual([]);
    expect(writes.setChoreWeeks).not.toHaveBeenCalled();
    expect(logEvent).not.toHaveBeenCalled();
  });

  it('one batch, one budget slot, then a re-read; logs week-closed with the counts', async () => {
    await setup({ marks: [...ticks('kid', days7(W0)), ...ticks('sib', days7(W0).slice(0, 3))] });
    await store.closeWeeks();
    expect(writes.setChoreWeeks).toHaveBeenCalledTimes(1);
    const written = writes.setChoreWeeks.mock.calls[0]![0] as ChoreWeek[];
    expect(written.map((w) => [w.memberId, w.weekStart, w.marks])).toEqual([
      ['kid', W0, 7],
      ['sib', W0, 3],
    ]);
    expect(budget.calls).toEqual(['chore-week-close']);
    expect(store.weeks.map((w) => w.id).sort()).toEqual([`kid:${W0}`, `sib:${W0}`]);
    expect(logged('week-closed')[0]!.context).toEqual({
      count: 2,
      detail: 'created:2+resettled:0',
    });
  });

  it('plans from the PROJECTION, not the store arrays (marks and gifts)', async () => {
    // The store arrays are stale: three of the kid's ticks and no gift. The projection has all
    // seven and a bonus. The write carries the projection's numbers.
    await setup({ marks: ticks('kid', days7(W0)), gifts: [gift('kid', '2026-11-12', 2)] });
    chores.choreMarks = ticks('kid', days7(W0).slice(0, 3));
    store.gifts = [];
    await store.closeWeeks();
    const written = writes.setChoreWeeks.mock.calls[0]![0] as ChoreWeek[];
    expect(written.find((w) => w.memberId === 'kid')).toMatchObject({
      marks: 7,
      stars: 7,
      bonus: 2,
    });
  });

  it('a gift alone in a week re-settles that week (gifts are fed into the close)', async () => {
    await setup({ marks: ticks('kid', days7(W0)) });
    await store.closeWeeks();
    await setup({
      marks: ticks('kid', days7(W0)),
      weeks: proj.weeks,
      gifts: [gift('kid', '2026-11-14', 3)],
    });
    await store.closeWeeks();
    const written = writes.setChoreWeeks.mock.calls[0]![0] as ChoreWeek[];
    expect(written).toEqual([expect.objectContaining({ memberId: 'kid', bonus: 3 })]);
    expect(logged('week-closed')[0]!.context).toEqual({
      count: 1,
      detail: 'created:0+resettled:1',
    });
  });

  it('a stale store can delay a close, never shape it: the projection already has the records', async () => {
    await setup({ marks: ticks('kid', days7(W0)) });
    await store.closeWeeks();
    // Another device froze the week too; this store's `weeks` has not caught up.
    store.weeks = [];
    vi.clearAllMocks();
    budget.calls = [];
    await store.closeWeeks();
    expect(reads.weeks).toHaveBeenCalledTimes(1); // the store arrays said "write"...
    expect(writes.setChoreWeeks).not.toHaveBeenCalled(); // ...the projection said "nothing to do"
    expect(budget.calls).toEqual([]);
    expect(logged('week-closed')).toEqual([]);
  });

  it('a pause: off for weeks, on again: the off weeks get no record, the turn-on week freezes, and records frozen before the pause still count', async () => {
    const before = '2026-10-19';
    const savedUp = {
      id: 'saved',
      title: 'Disneyland',
      emoji: '🏰',
      kind: 'saved',
      unit: 'stars',
      price: 100,
      weekStart: before,
      createdBy: 'mom',
      createdAt: T,
      updatedAt: T,
    } as ChoreAward;
    // Frozen while on, then off from 10-26; the kid kept ticking through the off weeks.
    setRewardsState({ ...ON, on: false, startedOn: before });
    await setup({
      weeks: [record('kid', before, { stars: 7 })],
      marks: ticks('kid', [...days7('2026-11-02'), ...days7(W0), ...days7(MON).slice(0, 3)]),
      awards: [savedUp],
    });
    // On again on Wednesday of this week: startedOn is that day, not the first turn-on.
    chores.todayYmd = '2026-11-18';
    await store.setRewards({ on: true }, 'mom');
    expect(settings.sent[0]!.startedOn).toBe('2026-11-18');
    // This week is live from its first day (all of Monday to Wednesday counted).
    expect(store.weekFor('kid')!.stars).toBe(3);
    // The next Monday: only the turn-on week is frozen, whole; 11-02 and 11-09 get nothing.
    chores.todayYmd = '2026-11-23';
    await nextTick();
    await store.closeWeeks();
    const written = writes.setChoreWeeks.mock.calls.flatMap((c) => c[0] as ChoreWeek[]);
    expect([...new Set(written.map((w) => w.weekStart))]).toEqual([MON]);
    expect(written.find((w) => w.memberId === 'kid')).toMatchObject({ stars: 3, marks: 3 });
    // The record frozen before the pause still counts toward the saved-up award; the off weeks
    // add nothing.
    const standing = store.awardsFor('kid', MON).find((x) => x.award.id === 'saved')!;
    expect(standing.progress.have).toBe(10);
    expect(store.weekFor('kid', W0)).toBeNull();
  });

  it('a budget refusal writes nothing and logs no week-closed', async () => {
    await setup({ marks: ticks('kid', days7(W0)) });
    budget.allow = false;
    await store.closeWeeks();
    expect(budget.calls).toEqual(['chore-week-close']);
    expect(writes.setChoreWeeks).not.toHaveBeenCalled();
    expect(logged('week-closed')).toEqual([]);
  });

  it('a throw is reported as week-close-failed and never escapes', async () => {
    await setup({ marks: ticks('kid', days7(W0)) });
    proj.failWrite = new Error('disk');
    await expect(store.closeWeeks()).resolves.toBeUndefined();
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({
        surface: 'chore-stars',
        severity: 'warning',
        context: { action: 'week-close-failed' },
      })
    );
    expect(logged('week-closed')).toEqual([]);
  });

  it('fewer-marks is logged at most once a day', async () => {
    // Frozen weeks whose marks have since gone (fewer), seen on two runs the same day.
    await setup({ weeks: [record('kid', W0), record('sib', W0)] });
    await store.closeWeeks();
    await store.closeWeeks();
    expect(logged('week-close-skipped').map((e) => [e.level, e.context])).toEqual([
      ['warn', { detail: 'fewer-marks', count: 2 }],
    ]);
    expect(writes.setChoreWeeks).not.toHaveBeenCalled();
    // A new day: logged again.
    chores.todayYmd = '2026-11-17';
    await store.closeWeeks();
    expect(logged('week-close-skipped')).toHaveLength(2);
  });

  it('late (a bonus after the window) is info and missed is warn, once a day each', async () => {
    // The kid's 11-02 record matches its marks, but a bonus dated 11-03 synced only now, more
    // than 7 days after that week ended (late). The 10-05 week left retention today with no
    // record (missed, both kids). Every other closable week is simply created.
    settings.settings = { choreRewards: { ...ON, startedOn: '2026-09-01' } };
    const old = record('kid', '2026-11-02', {
      done: 1,
      stars: 1,
      days: [1, 0, 0, 0, 0, 0, 0],
      marks: 1,
    });
    await setup({
      marks: ticks('kid', ['2026-11-02']),
      weeks: [old],
      gifts: [gift('kid', '2026-11-03', 2)],
    });
    await store.closeWeeks();
    expect(logged('week-close-skipped').map((e) => [e.level, e.context])).toEqual([
      ['info', { detail: 'late', count: 1 }],
    ]);
    expect(logged('week-close-missed').map((e) => [e.level, e.context])).toEqual([
      ['warn', { count: 2 }],
    ]);
    const written = writes.setChoreWeeks.mock.calls[0]![0] as ChoreWeek[];
    expect(written.some((w) => w.id === 'kid:2026-11-02')).toBe(false); // late is never written
    // The same day again: nothing to write, and both problems were already logged today.
    vi.clearAllMocks();
    await store.closeWeeks();
    expect(logEvent).not.toHaveBeenCalled();
    expect(writes.setChoreWeeks).not.toHaveBeenCalled();
  });

  it('a HIGHER mark count re-settles an old week (no late, at any age inside retention)', async () => {
    settings.settings = { choreRewards: { ...ON, startedOn: '2026-10-26' } };
    const old = record('kid', '2026-11-02', { marks: 1, stars: 1, done: 1 });
    await setup({ marks: ticks('kid', ['2026-11-02', '2026-11-03']), weeks: [old] });
    await store.closeWeeks();
    const written = writes.setChoreWeeks.mock.calls[0]![0] as ChoreWeek[];
    expect(written.find((w) => w.id === 'kid:2026-11-02')).toMatchObject({ marks: 2 });
    expect(logged('week-close-skipped')).toEqual([]);
  });
});

describe('triggers', () => {
  it('is registered as load maintenance: the run after an authoritative reload closes the week', async () => {
    await setup({ marks: ticks('kid', days7(W0)) });
    markAuthoritative();
    runLoadMaintenance('reload');
    await __whenLoadMaintenanceIdleForTesting();
    expect(writes.setChoreWeeks).toHaveBeenCalledTimes(1);
    resetProjection();
  });

  it('a day change closes again only once the stores are authoritative', async () => {
    await setup({ marks: ticks('kid', days7(W0)) });
    chores.todayYmd = '2026-11-17';
    await nextTick();
    await new Promise((r) => setTimeout(r, 0)); // let any close the watch started finish
    expect(writes.setChoreWeeks).not.toHaveBeenCalled();
    expect(budget.calls).toEqual([]);
    __setStoresAuthoritativeForTesting(true);
    chores.todayYmd = '2026-11-18';
    await nextTick();
    await store.closeWeeks(); // joins the run the watch started (single-flight)
    expect(writes.setChoreWeeks).toHaveBeenCalledTimes(1);
  });

  it('single-flight: two calls at once make one write', async () => {
    await setup({ marks: ticks('kid', days7(W0)) });
    await Promise.all([store.closeWeeks(), store.closeWeeks()]);
    expect(writes.setChoreWeeks).toHaveBeenCalledTimes(1);
    expect(budget.calls).toEqual(['chore-week-close']);
  });
});

describe('resetState', () => {
  it('forgets everything, so the next family starts clean', async () => {
    await setup({ weeks: [record('kid', W0)], gifts: [gift('kid', MON, 1)] });
    store.resetState();
    expect([store.weeks, store.gifts, store.awards]).toEqual([[], [], []]);
    expect(store.isLoaded).toBe(false);
  });
});
