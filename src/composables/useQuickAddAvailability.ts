import { computed, type Ref } from 'vue';
import { usePermissions } from '@/composables/usePermissions';
import { isItemFlagEnabled } from '@/constants/navigation';
import {
  QUICK_ADD_ITEMS,
  type QuickAddItem,
  type QuickAddPermission,
} from '@/constants/quickAddItems';

/**
 * Shared quick-add availability — the single source of truth for whether the
 * current member may act on a quick-add item (dev-flag + permission). Consumed
 * by BOTH `QuickAddSheet` (which layers its caller-supplied `allowedActions`
 * filter on top) and `QuickAddFab` (which hides entirely when nothing is
 * available), so the FAB can never drift out of sync with what the sheet shows.
 *
 * MUST be called inside a component `setup` — `usePermissions()` reads Pinia
 * stores, so this is deliberately a per-call composable, NOT a computed on the
 * `useQuickAdd` module singleton (which has no Pinia context).
 */
export function useQuickAddAvailability() {
  const { canViewFinances, canEditActivities } = usePermissions();

  // Exhaustive map keyed by the permission union: adding a new
  // `QuickAddPermission` becomes a compile error here (fail-closed) rather than
  // silently mapping to a default or falling through to "allowed".
  const permissionGate: Record<QuickAddPermission, Ref<boolean>> = {
    finance: canViewFinances,
    activities: canEditActivities,
  };

  /** Flag + permission gate — the sheet adds its caller-filter after this. */
  function itemAllowedForMember(item: QuickAddItem): boolean {
    return isItemFlagEnabled(item) && permissionGate[item.requiredPermission].value;
  }

  /** True when at least one quick-add item is available to this member. */
  const hasAnyQuickAddOption = computed(() => QUICK_ADD_ITEMS.some(itemAllowedForMember));

  return { itemAllowedForMember, hasAnyQuickAddOption };
}
