/**
 * useScrapbookFeed tests.
 *
 * Focused on the milestone-merge behavior added in the 2026-05-07 plan:
 *   - milestones merge into the feed alongside favorites/sayings/notes
 *   - sort uses occurredOn for milestones, createdAt for everything else
 *   - family-wide milestones (memberId === null) always pass the bean filter
 *   - malformed occurredOn falls back to createdAt + reportError fires
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ref } from 'vue';
import type { FavoriteItem, MemberNote, Milestone, SayingItem, UUID } from '@/types/models';

const { reportErrorMock, favRef, sayRef, noteRef, mileRef } = vi.hoisted(() => ({
  reportErrorMock: vi.fn(),
  favRef: { value: [] as FavoriteItem[] },
  sayRef: { value: [] as SayingItem[] },
  noteRef: { value: [] as MemberNote[] },
  mileRef: { value: [] as Milestone[] },
}));

vi.mock('@/utils/errorReporter', () => ({
  reportError: reportErrorMock,
}));

vi.mock('@/stores/favoritesStore', () => ({
  useFavoritesStore: () => ({
    get favorites() {
      return favRef.value;
    },
  }),
}));
vi.mock('@/stores/sayingsStore', () => ({
  useSayingsStore: () => ({
    get sayings() {
      return sayRef.value;
    },
  }),
}));
vi.mock('@/stores/memberNotesStore', () => ({
  useMemberNotesStore: () => ({
    get notes() {
      return noteRef.value;
    },
  }),
}));
vi.mock('@/stores/milestonesStore', () => ({
  useMilestonesStore: () => ({
    get milestones() {
      return mileRef.value;
    },
    safeCategoryFor: (m: Milestone) => m.category,
  }),
}));

import { useScrapbookFeed, type ScrapType } from '@/composables/useScrapbookFeed';

function milestone(overrides: Partial<Milestone> = {}): Milestone {
  return {
    id: `m-${Math.random().toString(36).slice(2, 8)}`,
    memberId: 'bean-1',
    category: 'birthday',
    title: 'Birthday',
    occurredOn: '2026-04-15',
    createdAt: '2026-04-15T00:00:00.000Z',
    updatedAt: '2026-04-15T00:00:00.000Z',
    ...overrides,
  };
}

function saying(overrides: Partial<SayingItem> = {}): SayingItem {
  return {
    id: `s-${Math.random().toString(36).slice(2, 8)}`,
    memberId: 'bean-1',
    words: 'kids say the funniest things',
    createdAt: '2026-04-15T00:00:00.000Z',
    updatedAt: '2026-04-15T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  favRef.value = [];
  sayRef.value = [];
  noteRef.value = [];
  mileRef.value = [];
});

function makeOptions(overrides?: { memberIds?: UUID[]; types?: ScrapType[] }) {
  return {
    memberIds: ref<UUID[]>(overrides?.memberIds ?? ['bean-1', 'bean-2']),
    contentTypes: ref<Set<ScrapType>>(new Set(overrides?.types ?? [])),
  };
}

describe('useScrapbookFeed — milestone merge', () => {
  it('merges milestones into the feed with type "milestone"', () => {
    mileRef.value = [milestone({ id: 'm-1' })];
    sayRef.value = [saying({ id: 's-1' })];

    const { entries } = useScrapbookFeed(makeOptions());
    const types = entries.value.map((e) => e.type).sort();
    expect(types).toEqual(['milestone', 'saying']);
  });

  it('milestone sort uses occurredOn (not createdAt)', () => {
    // A milestone that "happened" recently but was added long ago should
    // sort newer than a saying added today.
    mileRef.value = [
      milestone({
        id: 'm-recent-event',
        occurredOn: '2026-05-01',
        createdAt: '2024-01-01T00:00:00.000Z',
      }),
    ];
    sayRef.value = [
      saying({
        id: 's-today',
        createdAt: '2026-04-30T00:00:00.000Z',
      }),
    ];

    const { entries } = useScrapbookFeed(makeOptions());
    expect(entries.value.map((e) => e.id)).toEqual(['m-recent-event', 's-today']);
  });

  it('family-wide milestone (memberId=null) passes the bean filter', () => {
    mileRef.value = [
      milestone({ id: 'm-fam', memberId: null }),
      milestone({ id: 'm-bean1', memberId: 'bean-1' }),
      milestone({ id: 'm-bean2', memberId: 'bean-2' }),
    ];

    const { entries } = useScrapbookFeed(makeOptions({ memberIds: ['bean-1'] }));
    const ids = entries.value.map((e) => e.id).sort();
    expect(ids).toEqual(['m-bean1', 'm-fam']);
  });

  it('milestone-only contentTypes filter still includes family-wide entries', () => {
    mileRef.value = [
      milestone({ id: 'm-fam', memberId: null }),
      milestone({ id: 'm-bean', memberId: 'bean-1' }),
    ];
    sayRef.value = [saying({ id: 's-1' })];

    const { entries } = useScrapbookFeed(makeOptions({ types: ['milestone'] }));
    expect(entries.value.map((e) => e.type)).toEqual(['milestone', 'milestone']);
  });
});

describe('useScrapbookFeed — silent-failure paths', () => {
  it('malformed milestone occurredOn falls back to createdAt + reports', () => {
    mileRef.value = [
      milestone({
        id: 'm-bad',
        occurredOn: 'garbage',
        createdAt: '2026-04-15T00:00:00.000Z',
      }),
    ];

    const { entries } = useScrapbookFeed(makeOptions());

    // Item still rendered, sorted under createdAt
    expect(entries.value.map((e) => e.id)).toEqual(['m-bad']);
    expect(reportErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        surface: 'useScrapbookFeed',
        message: 'invalid occurredOn date',
        context: expect.objectContaining({ itemId: 'm-bad' }),
      })
    );
  });

  it('milestone with no createdAt is skipped (not crashed on)', () => {
    mileRef.value = [
      milestone({ id: 'm-good' }),
      // Cast to any to simulate corrupt doc data
      { ...milestone({ id: 'm-bad' }), createdAt: undefined as unknown as string },
    ];

    const { entries } = useScrapbookFeed(makeOptions());
    expect(entries.value.map((e) => e.id)).toEqual(['m-good']);
  });
});
