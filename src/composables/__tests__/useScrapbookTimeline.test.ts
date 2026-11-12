/**
 * useScrapbookTimeline: the reactive wrapper over `buildScrapbookTimeline`.
 *
 * The month and sort rules are pinned in `utils/__tests__/scrapbookTimeline.test.ts`; this file
 * pins the wiring: the whole-family roster (departed beans stay hidden) and the reactive filters.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ref } from 'vue';
import type { FavoriteItem, Milestone, UUID } from '@/types/models';
import type { ScrapType } from '@/composables/useScrapbookFeed';

const { favRef, mileRef, membersRef } = vi.hoisted(() => ({
  favRef: { value: [] as FavoriteItem[] },
  mileRef: { value: [] as Milestone[] },
  membersRef: { value: [] as { id: string }[] },
}));

vi.mock('@/utils/errorReporter', () => ({ reportError: vi.fn() }));
vi.mock('@/stores/favoritesStore', () => ({
  useFavoritesStore: () => ({
    get favorites() {
      return favRef.value;
    },
  }),
}));
vi.mock('@/stores/sayingsStore', () => ({ useSayingsStore: () => ({ sayings: [] }) }));
vi.mock('@/stores/memberNotesStore', () => ({ useMemberNotesStore: () => ({ notes: [] }) }));
vi.mock('@/stores/milestonesStore', () => ({
  useMilestonesStore: () => ({
    get milestones() {
      return mileRef.value;
    },
  }),
}));
vi.mock('@/stores/familyStore', () => ({
  useFamilyStore: () => ({
    get members() {
      return membersRef.value;
    },
  }),
}));

import { useScrapbookTimeline } from '@/composables/useScrapbookTimeline';

function favorite(id: string, memberId: string, createdAt: string): FavoriteItem {
  return { id, memberId, createdAt, updatedAt: createdAt } as unknown as FavoriteItem;
}

function familyMilestone(id: string, occurredOn: string): Milestone {
  return {
    id,
    memberId: null,
    category: 'birthday',
    title: 'Moment',
    occurredOn,
    createdAt: `${occurredOn}T00:00:00.000Z`,
    updatedAt: `${occurredOn}T00:00:00.000Z`,
  } as Milestone;
}

beforeEach(() => {
  membersRef.value = [{ id: 'm1' }, { id: 'm2' }];
  favRef.value = [
    favorite('f1', 'm1', '2026-11-05T02:00:00.000Z'),
    favorite('f2', 'm2', '2026-10-05T02:00:00.000Z'),
    favorite('gone', 'm9', '2026-11-06T02:00:00.000Z'),
  ];
  mileRef.value = [familyMilestone('fam', '2026-09-01')];
});

const ALL = new Set<ScrapType>(['milestone', 'favorite', 'saying', 'note']);

describe('useScrapbookTimeline', () => {
  it("hides a departed bean's entries and keeps family moments", () => {
    const { months } = useScrapbookTimeline({ memberId: null, types: ALL });
    expect(months.value.flatMap((m) => m.entries.map((e) => e.id))).toEqual(['f1', 'f2', 'fam']);
  });

  it('follows the bean and the type set reactively', () => {
    const memberId = ref<UUID | null>(null);
    const types = ref<ReadonlySet<ScrapType>>(ALL);
    const { months, isEmpty } = useScrapbookTimeline({ memberId, types: () => types.value });

    memberId.value = 'm2';
    expect(months.value.flatMap((m) => m.entries.map((e) => e.id))).toEqual(['f2', 'fam']);

    types.value = new Set(['favorite']);
    expect(months.value.flatMap((m) => m.entries.map((e) => e.id))).toEqual(['f2']);

    types.value = new Set();
    expect(months.value).toEqual([]);
    expect(isEmpty.value).toBe(true);
  });
});
