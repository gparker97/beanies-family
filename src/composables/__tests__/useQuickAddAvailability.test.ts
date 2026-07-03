/**
 * useQuickAddAvailability — the shared flag+permission predicate behind both
 * QuickAddSheet's item filter and QuickAddFab's visibility. Pins that:
 *  - itemAllowedForMember gates finance items on canViewFinances and activities
 *    items on canEditActivities (fail-closed exhaustive map);
 *  - hasAnyQuickAddOption is false only when the member can act on nothing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref } from 'vue';
import { QUICK_ADD_ITEMS } from '@/constants/quickAddItems';

const canViewFinances = ref(true);
const canEditActivities = ref(true);
vi.mock('@/composables/usePermissions', () => ({
  usePermissions: () => ({ canViewFinances, canEditActivities }),
}));
// All dev flags on, so gating is purely permission-driven in these tests.
vi.mock('@/config/flags', () => ({ isFlagEnabled: () => true }));

import { useQuickAddAvailability } from '@/composables/useQuickAddAvailability';

const financeItem = QUICK_ADD_ITEMS.find((i) => i.requiredPermission === 'finance')!;
const activityItem = QUICK_ADD_ITEMS.find((i) => i.requiredPermission === 'activities')!;

beforeEach(() => {
  canViewFinances.value = true;
  canEditActivities.value = true;
});

describe('useQuickAddAvailability', () => {
  it('allows a finance item only with canViewFinances', () => {
    const { itemAllowedForMember } = useQuickAddAvailability();
    expect(itemAllowedForMember(financeItem)).toBe(true);
    canViewFinances.value = false;
    expect(itemAllowedForMember(financeItem)).toBe(false);
  });

  it('allows an activities item only with canEditActivities', () => {
    const { itemAllowedForMember } = useQuickAddAvailability();
    expect(itemAllowedForMember(activityItem)).toBe(true);
    canEditActivities.value = false;
    expect(itemAllowedForMember(activityItem)).toBe(false);
  });

  it('hasAnyQuickAddOption is true when either permission is held', () => {
    const { hasAnyQuickAddOption } = useQuickAddAvailability();
    expect(hasAnyQuickAddOption.value).toBe(true);

    canEditActivities.value = false; // finance-only
    expect(hasAnyQuickAddOption.value).toBe(true);

    canViewFinances.value = false; // activities-only... but now also off
    canEditActivities.value = true;
    expect(hasAnyQuickAddOption.value).toBe(true);
  });

  it('hasAnyQuickAddOption is false only when the member can act on nothing', () => {
    const { hasAnyQuickAddOption } = useQuickAddAvailability();
    canViewFinances.value = false;
    canEditActivities.value = false;
    expect(hasAnyQuickAddOption.value).toBe(false);
  });
});
