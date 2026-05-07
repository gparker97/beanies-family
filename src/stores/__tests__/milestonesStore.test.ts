/**
 * milestonesStore tests.
 *
 * Covers:
 *   - CRUD: create / update / delete update reactive state.
 *   - byMember filter sorts occurredOn DESC.
 *   - familyWide filter (memberId === null) sorts occurredOn DESC.
 *   - Repo failures surface via wrapAsync (toast + reportError) without
 *     leaving state inconsistent.
 *   - Unknown category at read time → safeCategoryFor falls back to
 *     'custom' + once-per-session reportError per unknown category.
 *   - reset() clears state + the per-session unknown-category dedup set.
 */
import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Milestone } from '@/types/models';

const { reportErrorMock } = vi.hoisted(() => ({
  reportErrorMock: vi.fn(),
}));

vi.mock('@/services/automerge/repositories/milestoneRepository', () => ({
  getAllMilestones: vi.fn().mockResolvedValue([]),
  createMilestone: vi.fn(),
  updateMilestone: vi.fn(),
  deleteMilestone: vi.fn(),
}));

vi.mock('@/utils/errorReporter', () => ({
  reportError: reportErrorMock,
}));

vi.mock('@/composables/useToast', () => ({
  showToast: vi.fn(),
}));

vi.mock('@/stores/translationStore', () => ({
  useTranslationStore: () => ({ t: (k: string) => k }),
}));

import { useMilestonesStore } from '../milestonesStore';
import * as milestoneRepo from '@/services/automerge/repositories/milestoneRepository';

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

describe('milestonesStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  describe('CRUD', () => {
    it('createMilestone appends on success', async () => {
      const store = useMilestonesStore();
      const created = milestone({ id: 'm-new', title: 'Lost a tooth' });
      vi.mocked(milestoneRepo.createMilestone).mockResolvedValue(created);

      const result = await store.createMilestone({
        memberId: 'bean-1',
        category: 'lost_tooth',
        title: 'Lost a tooth',
        occurredOn: '2026-05-01',
      });

      expect(result).toEqual(created);
      expect(store.milestones).toContainEqual(created);
    });

    it('createMilestone returns null on repo error and leaves state empty', async () => {
      const store = useMilestonesStore();
      vi.mocked(milestoneRepo.createMilestone).mockRejectedValue(new Error('boom'));

      const result = await store.createMilestone({
        memberId: 'bean-1',
        category: 'birthday',
        title: 'Birthday',
        occurredOn: '2026-04-15',
      });

      expect(result).toBeNull();
      expect(store.milestones).toEqual([]);
    });

    it('updateMilestone replaces the matching entry', async () => {
      const store = useMilestonesStore();
      vi.mocked(milestoneRepo.getAllMilestones).mockResolvedValue([
        milestone({ id: 'm-1', title: 'Original' }),
      ]);
      await store.loadMilestones();

      vi.mocked(milestoneRepo.updateMilestone).mockResolvedValue(
        milestone({ id: 'm-1', title: 'Updated' })
      );

      const result = await store.updateMilestone('m-1', { title: 'Updated' });
      expect(result?.title).toBe('Updated');
      expect(store.milestones[0]?.title).toBe('Updated');
    });

    it('deleteMilestone removes from state', async () => {
      const store = useMilestonesStore();
      vi.mocked(milestoneRepo.getAllMilestones).mockResolvedValue([
        milestone({ id: 'm-1' }),
        milestone({ id: 'm-2' }),
      ]);
      await store.loadMilestones();

      vi.mocked(milestoneRepo.deleteMilestone).mockResolvedValue(true);
      await store.deleteMilestone('m-1');

      expect(store.milestones.map((m) => m.id)).toEqual(['m-2']);
    });
  });

  describe('byMember + familyWide filters', () => {
    it("byMember returns this bean's milestones sorted occurredOn DESC", async () => {
      const store = useMilestonesStore();
      vi.mocked(milestoneRepo.getAllMilestones).mockResolvedValue([
        milestone({ id: 'm-old', memberId: 'bean-1', occurredOn: '2024-01-01' }),
        milestone({ id: 'm-new', memberId: 'bean-1', occurredOn: '2026-04-01' }),
        milestone({ id: 'm-other', memberId: 'bean-2', occurredOn: '2025-01-01' }),
        milestone({ id: 'm-family', memberId: null, occurredOn: '2025-06-01' }),
      ]);
      await store.loadMilestones();

      const list = store.byMember('bean-1').value;
      expect(list.map((m) => m.id)).toEqual(['m-new', 'm-old']);
    });

    it('familyWide returns only memberId=null entries, sorted DESC', async () => {
      const store = useMilestonesStore();
      vi.mocked(milestoneRepo.getAllMilestones).mockResolvedValue([
        milestone({ id: 'fam-old', memberId: null, occurredOn: '2024-05-01' }),
        milestone({ id: 'fam-new', memberId: null, occurredOn: '2026-06-01' }),
        milestone({ id: 'm-bean', memberId: 'bean-1' }),
      ]);
      await store.loadMilestones();

      expect(store.familyWide.map((m) => m.id)).toEqual(['fam-new', 'fam-old']);
    });
  });

  describe('safeCategoryFor — runtime defense for unknown categories', () => {
    it('returns the category as-is when known', () => {
      const store = useMilestonesStore();
      const m = milestone({ category: 'graduation' });
      expect(store.safeCategoryFor(m)).toBe('graduation');
    });

    it('falls back to "custom" + reports once per unknown category', () => {
      const store = useMilestonesStore();
      const m1 = milestone({ id: 'm-1', category: 'future_thing' as never });
      const m2 = milestone({ id: 'm-2', category: 'future_thing' as never });

      expect(store.safeCategoryFor(m1)).toBe('custom');
      expect(store.safeCategoryFor(m2)).toBe('custom');

      // Same unknown category — reportError fires only once
      expect(reportErrorMock).toHaveBeenCalledTimes(1);
      expect(reportErrorMock).toHaveBeenCalledWith(
        expect.objectContaining({
          surface: 'milestonesStore',
          message: 'unknown milestone category',
        })
      );
    });

    it('reports separately for distinct unknown categories', () => {
      const store = useMilestonesStore();
      store.safeCategoryFor(milestone({ category: 'cat_a' as never }));
      store.safeCategoryFor(milestone({ category: 'cat_b' as never }));
      expect(reportErrorMock).toHaveBeenCalledTimes(2);
    });

    it('reset() clears the dedup set so the same unknown category re-reports', () => {
      const store = useMilestonesStore();
      store.safeCategoryFor(milestone({ category: 'cat_a' as never }));
      expect(reportErrorMock).toHaveBeenCalledTimes(1);

      store.reset();
      store.safeCategoryFor(milestone({ category: 'cat_a' as never }));
      expect(reportErrorMock).toHaveBeenCalledTimes(2);
    });
  });

  describe('fresh-doc behavior', () => {
    it('loadMilestones with empty repo leaves store empty without error', async () => {
      const store = useMilestonesStore();
      vi.mocked(milestoneRepo.getAllMilestones).mockResolvedValue([]);
      await store.loadMilestones();
      expect(store.milestones).toEqual([]);
      expect(store.error).toBeNull();
    });
  });
});
