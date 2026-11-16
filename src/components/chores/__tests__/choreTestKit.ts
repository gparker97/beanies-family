/**
 * Shared fakes for the choreboard component and page tests (#146). The stores are replaced by
 * small reactive fakes whose READS go through the real pure rules (`utils/chores.ts`), so the
 * tests exercise the same read model the app does; every WRITE is a `vi.fn` to assert on.
 *
 * Use from a test with an async mock factory, e.g.
 *   vi.mock('@/stores/choreStore', async () => (await import('./choreTestKit')).choreStoreModule);
 * This module must not import any module a test mocks.
 */
import { computed, reactive } from 'vue';
import { vi } from 'vitest';
import {
  DEFAULT_CHORE_BLOCK_STARTS,
  beanChoreDay,
  indexMarks,
  orphanChores,
  sortChores,
  choreWeekRecord,
} from '@/utils/chores';
import type {
  Chore,
  ChoreBlockStarts,
  ChoreMark,
  ChoreStarGift,
  FamilyMember,
} from '@/types/models';

export const NOW = '2026-11-13T07:42:00.000Z';
/** Friday 2026-11-13, 7:42: Morning is the block happening now. */
export const clock = reactive({ ymd: '2026-11-13', hhmm: '07:42' });

function member(id: string, name: string, over: Partial<FamilyMember> = {}): FamilyMember {
  return {
    id,
    name,
    email: `${id}@example.test`,
    role: 'member',
    ageGroup: 'child',
    color: '#3b82c4',
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  } as FamilyMember;
}

export const MEMBERS: FamilyMember[] = [
  member('mom', 'Mama Bean', { role: 'owner', ageGroup: 'adult' }),
  member('dad', 'Papa Bean', { ageGroup: 'adult' }),
  member('kid', 'Pip'),
  member('sib', 'Juno'),
  member('rex', 'Rex', { isPet: true }),
];

export function chore(id: string, over: Partial<Chore> = {}): Chore {
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

export function doneMark(memberId: string, choreId: string, date = clock.ymd): ChoreMark {
  return {
    id: `done:${memberId}:${date}:${choreId}`,
    kind: 'done',
    memberId,
    date,
    ref: choreId,
    by: memberId,
    createdAt: NOW,
    updatedAt: NOW,
  } as ChoreMark;
}

// ── familyStore ──────────────────────────────────────────────────────────────

export const family = reactive({
  members: [...MEMBERS] as FamilyMember[],
  currentMemberId: 'mom' as string | null,
});

const humans = computed(() => family.members.filter((m) => !m.isPet));
const familyStoreFake = {
  get members() {
    return family.members;
  },
  get humans() {
    return humans.value;
  },
  get sortedHumans() {
    return humans.value;
  },
  get sortedMembers() {
    return family.members;
  },
  get currentMemberId() {
    return family.currentMemberId;
  },
  get currentMember() {
    return family.members.find((m) => m.id === family.currentMemberId);
  },
  initialsById: new Map<string, string>(),
};

export const familyStoreModule = { useFamilyStore: () => familyStoreFake };

/** `starStore.earnerMembers` for a star fake: the given kids as members, in family order. */
export const earnerMembersOf = (ids: readonly string[]): FamilyMember[] =>
  familyStoreFake.sortedHumans.filter((m) => ids.includes(m.id));

/** `starStore.sortedAwards` for a star fake: the order the awards were made. */
export const sortedAwardsOf = <A extends { createdAt?: string }>(awards: readonly A[]): A[] =>
  [...awards].sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));

// ── choreStore ───────────────────────────────────────────────────────────────

export const chores = reactive({
  list: [] as Chore[],
  marks: [] as ChoreMark[],
  starts: { ...DEFAULT_CHORE_BLOCK_STARTS } as ChoreBlockStarts,
});

const livingIds = computed(() => new Set(humans.value.map((m) => m.id)));
const markIndex = computed(() => indexMarks(chores.marks));

export const choreActions = {
  loadChores: vi.fn(async () => {}),
  toggleChore: vi.fn(),
  createChore: vi.fn(),
  updateChore: vi.fn(),
  deleteChore: vi.fn(),
  removeChoresForMember: vi.fn(),
  setNotifyParentsFor: vi.fn(),
  reorderChores: vi.fn(),
  setBlockStarts: vi.fn(),
  addChores: vi.fn(),
  copyChores: vi.fn(),
};

const choreStoreFake = {
  get chores() {
    return chores.list;
  },
  get sortedChores() {
    return sortChores(chores.list);
  },
  get livingIds() {
    return livingIds.value;
  },
  get starts() {
    return chores.starts;
  },
  get orphans() {
    return orphanChores(chores.list, livingIds.value);
  },
  isLoaded: true,
  choreById: (id: string) => chores.list.find((c) => c.id === id),
  choreDayFor: (memberId: string) =>
    beanChoreDay(
      chores.list,
      markIndex.value,
      memberId,
      { ymd: clock.ymd, hhmm: clock.hhmm },
      chores.starts,
      livingIds.value
    ),
  get todayYmd() {
    return clock.ymd;
  },
  weekFor: (memberId: string, weekOfYmd: string = clock.ymd, weekStartDay = 1) =>
    choreWeekRecord(
      chores.list,
      markIndex.value,
      memberId,
      weekOfYmd,
      weekStartDay,
      livingIds.value
    ),
  ...choreActions,
};

export const choreStoreModule = { useChoreStore: () => choreStoreFake };

// ── starStore (#148): the day head registers as the reward banner's host ─────

/**
 * The star store's surface the chore views read, OFF by default (so every pre-stars test sees the
 * board exactly as before). A test turns it on with `stars.on` and seeds what the getters answer.
 */
export const stars = reactive({
  on: false,
  /** The kids (living, non-adult): who `valueFor` answers for. */
  earners: [] as string[],
  arcs: {} as Record<
    string,
    { percent: number; count: number; kind?: 'week' | 'saved'; badgeEmoji?: string }
  >,
  /** What `notesFor` answers per kid (already today's and yesterday's, newest first). */
  notes: {} as Record<string, ChoreStarGift[]>,
  /** What `stripFor` answers per kid. */
  strips: {} as Record<string, unknown>,
  /** The weeks the stepper offers, newest first (empty while off). */
  lookback: [] as string[],
});
/** Every banner host registered and not yet released, as `memberId:surface`. */
export const bannerHosts: string[] = [];
export const starActions = {
  hostRewardBanner: vi.fn((memberId: string, surface: string) => {
    const key = `${memberId}:${surface}`;
    bannerHosts.push(key);
    return () => {
      const i = bannerHosts.indexOf(key);
      if (i >= 0) bannerHosts.splice(i, 1);
    };
  }),
  setRewards: vi.fn(async (): Promise<true | null> => true),
  giveStars: vi.fn(async (): Promise<unknown> => ({})),
};
const starStoreFake = {
  get isOn() {
    return stars.on;
  },
  get earners() {
    return stars.earners;
  },
  /** The earners as members, in family order (the real getter's shape). */
  get earnerMembers() {
    return earnerMembersOf(stars.earners);
  },
  get sortedAwards() {
    return [];
  },
  get rewards() {
    return { on: stars.on, weeklyOn: true, title: 'Ice cream', emoji: '🍦', barPct: 80 };
  },
  get lookbackWeeks() {
    return stars.on ? stars.lookback : [];
  },
  get awards() {
    return [];
  },
  get gifts() {
    return [];
  },
  weekFor: () => null,
  awardsFor: () => [],
  arcFor: (memberId: string) => (stars.on ? (stars.arcs[memberId] ?? null) : null),
  notesFor: (memberId: string) => (stars.on ? (stars.notes[memberId] ?? []) : []),
  stripFor: (memberId: string) => (stars.on ? (stars.strips[memberId] ?? null) : null),
  valueFor: (memberId: string) =>
    stars.on && stars.earners.includes(memberId) ? (c: { stars?: number }) => c.stars ?? 1 : null,
  ...starActions,
};
export const starStoreModule = { useStarStore: () => starStoreFake };

// ── usePermissions ───────────────────────────────────────────────────────────

/** The session is a grown-up (the real `isAdultMember` rule, without importing it). */
const isAdult = computed(() => {
  const me = familyStoreFake.currentMember;
  return !!me && !me.isPet && (me.role === 'owner' || me.ageGroup === 'adult');
});
export const permissionsModule = { usePermissions: () => ({ isAdult }) };

export const choreClockModule = {
  useChoreClock: () => ({ choreClock: computed(() => ({ ymd: clock.ymd, hhmm: clock.hhmm })) }),
};

export const translationModule = {
  useTranslation: () => ({ t: (k: string) => k, currentLanguage: computed(() => 'en') }),
};

// ── vue-router ───────────────────────────────────────────────────────────────

export const route = reactive({
  path: '/choreboard',
  query: {} as Record<string, string | string[] | undefined>,
});
export const routerFns = {
  replace: vi.fn(async (to: { query?: Record<string, string | string[] | undefined> }) => {
    route.query = { ...(to.query ?? {}) };
  }),
  push: vi.fn(async (to: { query?: Record<string, string | string[] | undefined> }) => {
    route.query = { ...(to.query ?? {}) };
  }),
};
export const routerModule = { useRoute: () => route, useRouter: () => routerFns };

/** Put every fake back to a family of four (plus Rex) with no chores, seen by Mama Bean. */
export function resetKit(): void {
  family.members = [...MEMBERS];
  family.currentMemberId = 'mom';
  chores.list = [];
  chores.marks = [];
  chores.starts = { ...DEFAULT_CHORE_BLOCK_STARTS };
  clock.ymd = '2026-11-13';
  clock.hhmm = '07:42';
  route.query = {};
  routerFns.replace.mockClear();
  routerFns.push.mockClear();
  for (const fn of Object.values(choreActions)) fn.mockReset();
  starActions.hostRewardBanner.mockClear();
  bannerHosts.length = 0;
  starActions.setRewards.mockReset();
  starActions.setRewards.mockResolvedValue(true);
  stars.on = false;
  stars.earners = [];
  stars.arcs = {};
  stars.notes = {};
  stars.strips = {};
  stars.lookback = [];
  starActions.giveStars.mockReset();
  starActions.giveStars.mockResolvedValue({});
  choreActions.loadChores.mockResolvedValue(undefined);
}
