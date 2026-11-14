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
import type { Chore, ChoreBlockStarts, ChoreMark, FamilyMember } from '@/types/models';

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
  weekFor: (memberId: string) =>
    choreWeekRecord(chores.list, markIndex.value, memberId, clock.ymd, 1, livingIds.value),
  ...choreActions,
};

export const choreStoreModule = { useChoreStore: () => choreStoreFake };

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
  choreActions.loadChores.mockResolvedValue(undefined);
}
