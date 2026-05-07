/**
 * useFamilyTimeline tests (v2 — filter-less).
 *
 * Composable surface shrunk in 2026-05-07 redesign: no filter options,
 * sort is ASCENDING (oldest first), all milestones included. Filter
 * chrome moved out of scope — if a future feature needs scoping, add
 * a separate search surface.
 *
 * Covers:
 *   - Year grouping ascending (oldest year first)
 *   - Sort within each year ascending (oldest first)
 *   - Empty state
 *   - Malformed occurredOn → safeOccurredOn fallback prevents NaN year bucket
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Milestone } from '@/types/models';

const { reportErrorMock, milestonesRef } = vi.hoisted(() => ({
  reportErrorMock: vi.fn(),
  milestonesRef: { value: [] as Milestone[] },
}));

vi.mock('@/utils/errorReporter', () => ({
  reportError: reportErrorMock,
}));

vi.mock('@/stores/milestonesStore', () => ({
  useMilestonesStore: () => ({
    get milestones() {
      return milestonesRef.value;
    },
    safeCategoryFor: (m: Milestone) => m.category,
  }),
}));

import { useFamilyTimeline } from '@/composables/useFamilyTimeline';

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

beforeEach(() => {
  vi.clearAllMocks();
  milestonesRef.value = [];
});

describe('useFamilyTimeline — chronological year buckets', () => {
  it('groups by year ascending (oldest first), sorted ASC within each year', () => {
    milestonesRef.value = [
      milestone({ id: 'm-2026-may', occurredOn: '2026-05-01' }),
      milestone({ id: 'm-2024', occurredOn: '2024-08-01' }),
      milestone({ id: 'm-2026-jan', occurredOn: '2026-01-15' }),
      milestone({ id: 'm-2025', occurredOn: '2025-12-31' }),
    ];

    const { yearBuckets } = useFamilyTimeline();

    expect(yearBuckets.value.map((b) => b.year)).toEqual([2024, 2025, 2026]);
    expect(yearBuckets.value[2]?.milestones.map((m) => m.id)).toEqual(['m-2026-jan', 'm-2026-may']);
  });

  it('emits an empty list when no milestones exist', () => {
    const { yearBuckets, isEmpty, totalCount } = useFamilyTimeline();
    expect(yearBuckets.value).toEqual([]);
    expect(isEmpty.value).toBe(true);
    expect(totalCount.value).toBe(0);
  });

  it('totalCount reflects the full set (no filtering)', () => {
    milestonesRef.value = [
      milestone({ id: 'm-1', memberId: 'bean-1' }),
      milestone({ id: 'm-2', memberId: 'bean-2' }),
      milestone({ id: 'm-3', memberId: null }),
    ];
    const { totalCount } = useFamilyTimeline();
    expect(totalCount.value).toBe(3);
  });
});

describe('useFamilyTimeline — silent-failure paths', () => {
  it('malformed occurredOn falls back to createdAt — no NaN year bucket', () => {
    milestonesRef.value = [
      milestone({
        id: 'm-bad',
        occurredOn: 'not-a-date',
        createdAt: '2026-04-15T00:00:00.000Z',
      }),
    ];

    const { yearBuckets } = useFamilyTimeline();

    expect(yearBuckets.value.map((b) => b.year)).toEqual([2026]);
    expect(reportErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        surface: 'familyTimeline',
        message: 'invalid occurredOn date',
      })
    );
  });
});
