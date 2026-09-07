/**
 * `copyListForMembers` ORCHESTRATION only — the field rules live in
 * `src/utils/__tests__/listSeed.test.ts`, which needs none of this scaffolding.
 *
 * What matters here is the failure contract: exactly one toast and at most one Slack
 * page per outcome, nothing added to the store when the write fails, and a single falsy
 * sentinel returned for every "nothing happened" case.
 */
import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { FamilyList } from '@/types/models';

// The real `ListsNotVisibleError` must come through the mock: the store narrows on it
// with `instanceof`, and a mock without it makes that check throw.
vi.mock('@/services/automerge/repositories/listRepository', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/services/automerge/repositories/listRepository')>();
  return {
    ListsNotVisibleError: actual.ListsNotVisibleError,
    getAllLists: vi.fn().mockResolvedValue([]),
    getListById: vi.fn(),
    createList: vi.fn(),
    createLists: vi.fn(),
    updateList: vi.fn(),
    deleteList: vi.fn(),
  };
});
vi.mock('@/services/automerge/repositories/listCycleRepository', () => ({
  getAllCycles: vi.fn().mockResolvedValue([]),
  archiveCycleAndReset: vi.fn().mockResolvedValue(undefined),
  deleteCycles: vi.fn().mockResolvedValue(undefined),
  deleteListWithCycles: vi.fn().mockResolvedValue(undefined),
}));

const projection = vi.hoisted(() => ({ lists: [] as unknown[] }));
vi.mock('@/services/automerge/projection', () => ({
  list: (name: string) => (name === 'lists' ? projection.lists : []),
  getById: () => undefined,
}));
vi.mock('@/services/automerge/docService', () => ({ isDocLoaded: () => true }));
vi.mock('@/composables/useCelebration', () => ({ celebrate: vi.fn() }));
vi.mock('@/composables/useToday', async () => {
  const { ref } = await import('vue');
  return { useToday: () => ({ today: ref('2026-09-07'), isVisible: ref(true) }) };
});
vi.mock('@/composables/useMemberFiltered', () => ({
  createMemberFiltered: <T>(source: { value: T[] }) => ({
    get value() {
      return source.value;
    },
  }),
}));
vi.mock('@/stores/translationStore', () => ({
  useTranslationStore: () => ({ t: (k: string) => k }),
}));

const members = vi.hoisted(() => ({
  all: [
    { id: 'm-joey', name: 'Joey' },
    { id: 'm-ollie', name: 'Ollie' },
    { id: 'm-greg', name: 'Greg' },
  ],
}));
vi.mock('@/stores/familyStore', () => ({
  useFamilyStore: () => ({ members: members.all, currentMember: { id: 'm-greg' } }),
}));

const toast = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock('@/composables/useToast', () => ({ showToast: toast.fn }));

const reporter = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock('@/utils/errorReporter', () => ({ reportError: reporter.fn }));

const telemetry = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: telemetry.fn }));

const analytics = vi.hoisted(() => ({ fn: vi.fn((r: unknown) => r) }));
vi.mock('@/services/analytics/plausible', () => ({ trackFeature: analytics.fn }));

import { useListStore } from '../listStore';
import * as listRepo from '@/services/automerge/repositories/listRepository';
import { ListsNotVisibleError } from '@/services/automerge/repositories/listRepository';

function list(overrides: Partial<FamilyList> = {}): FamilyList {
  return {
    id: 'l-1',
    title: 'Saturday Chores',
    emoji: '🧹',
    category: 'kids',
    ownerId: 'm-joey',
    items: [{ id: 'i-1', title: 'Make the bed', completed: false }],
    lifecycle: 'oneoff',
    completed: false,
    createdBy: 'm-greg',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

const reportsAt = (severity: string) =>
  reporter.fn.mock.calls.filter((c) => c[0]?.severity === severity);

beforeEach(() => {
  setActivePinia(createPinia());
  projection.lists = [list()];
  vi.clearAllMocks();
});

describe('listStore.copyListForMembers', () => {
  it('creates one list per bean in a single batch and mirrors them in one array write', async () => {
    const created = [list({ id: 'c-1' }), list({ id: 'c-2' })];
    vi.mocked(listRepo.createLists).mockResolvedValue(created);
    const store = useListStore();

    const result = await store.copyListForMembers('l-1', ['m-joey', 'm-ollie'], "{bean}'s Chores");

    expect(result).toEqual(created);
    // ONE call, not one per bean — that is the whole point of the batch.
    expect(listRepo.createLists).toHaveBeenCalledTimes(1);
    expect(vi.mocked(listRepo.createLists).mock.calls[0][0]).toHaveLength(2);
    expect(store.lists).toEqual(created);
    expect(analytics.fn).toHaveBeenCalledTimes(1);
    expect(telemetry.fn).toHaveBeenCalledWith(
      expect.objectContaining({ context: expect.objectContaining({ action: 'copy_completed' }) })
    );
    expect(reportsAt('critical')).toHaveLength(0);
  });

  it('returns null and warns — without paging — when the source is already gone', async () => {
    projection.lists = [];
    const store = useListStore();

    const result = await store.copyListForMembers('l-1', ['m-joey'], '{bean}');

    expect(result).toBeNull();
    expect(listRepo.createLists).not.toHaveBeenCalled();
    // A race with another device is not a defect: warn and tell the user, never page.
    expect(reportsAt('warning')).toHaveLength(1);
    expect(reportsAt('critical')).toHaveLength(0);
    expect(toast.fn).toHaveBeenCalledWith('error', 'lists.copy.sourceGone');
  });

  it('pages with unknown-member and creates nothing when an id does not resolve', async () => {
    const store = useListStore();

    const result = await store.copyListForMembers('l-1', ['m-ghost'], '{bean}');

    expect(result).toBeNull();
    expect(listRepo.createLists).not.toHaveBeenCalled();
    expect(store.lists).toEqual([]);
    const critical = reportsAt('critical');
    expect(critical).toHaveLength(1);
    expect(critical[0][0].context).toMatchObject({
      action: 'copy_failed',
      error_code: 'unknown-member',
    });
  });

  it('tells the user the copies may exist when the batch commits but stays invisible', async () => {
    // The verify error fires AFTER the commit, so "nothing was created" would be a lie
    // that invites a retry and a second set of copies.
    vi.mocked(listRepo.createLists).mockRejectedValue(new ListsNotVisibleError(2, 2));
    const store = useListStore();

    const result = await store.copyListForMembers('l-1', ['m-joey', 'm-ollie'], '{bean}');

    expect(result).toBeNull();
    const critical = reportsAt('critical');
    expect(critical).toHaveLength(1);
    expect(critical[0][0].context).toMatchObject({ error_code: 'verify-missing' });
    expect(critical[0][0].message).not.toContain('nothing was created');
    // Our own translated message, silent so the page above is not doubled.
    expect(toast.fn).toHaveBeenCalledWith(
      'error',
      'lists.copy.verifyFailed',
      undefined,
      expect.objectContaining({ silent: true })
    );
  });

  it('never puts a raw member id in front of the user', async () => {
    const store = useListStore();
    await store.copyListForMembers('l-1', ['m-ghost'], '{bean}');
    // `wrapAsync` would toast `e.message` verbatim; the store owns this one instead.
    expect(toast.fn).toHaveBeenCalledWith(
      'error',
      'lists.copy.unknownMember',
      undefined,
      expect.objectContaining({ silent: true })
    );
    const shown = toast.fn.mock.calls.map((c) => String(c[1])).join(' ');
    expect(shown).not.toContain('m-ghost');
  });

  it('adds nothing to the store and pages exactly once when the batch write throws', async () => {
    vi.mocked(listRepo.createLists).mockRejectedValue(new Error('worker down'));
    const store = useListStore();

    const result = await store.copyListForMembers('l-1', ['m-joey', 'm-ollie'], '{bean}');

    // The batch is atomic, so a failure means ZERO copies — never one of two.
    expect(store.lists).toEqual([]);
    // `?? null` folds the thrown `undefined` into the same sentinel as a graceful stop,
    // which is why callers must branch on falsy rather than on `=== null`.
    expect(result).toBeNull();
    const critical = reportsAt('critical');
    expect(critical).toHaveLength(1);
    expect(critical[0][0].context).toMatchObject({
      action: 'copy_failed',
      error_code: 'batch-write-threw',
    });
    expect(telemetry.fn).not.toHaveBeenCalledWith(
      expect.objectContaining({ context: expect.objectContaining({ action: 'copy_completed' }) })
    );
  });
});
