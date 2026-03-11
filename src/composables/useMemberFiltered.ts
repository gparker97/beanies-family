import { computed, type Ref, type ComputedRef } from 'vue';
import { useMemberFilterStore } from '@/stores/memberFilterStore';

/**
 * Creates a computed that filters items by the global member filter.
 * Items whose getMemberId returns null/undefined are always included
 * (e.g. family-wide goals, unassigned todos).
 */
export function createMemberFiltered<T>(
  items: Ref<T[]> | ComputedRef<T[]>,
  getMemberIds: (item: T) => string | string[] | undefined | null
): ComputedRef<T[]> {
  return computed(() => {
    const memberFilter = useMemberFilterStore();
    if (!memberFilter.isInitialized || memberFilter.isAllSelected) {
      return items.value;
    }
    return items.value.filter((item) => {
      const ids = getMemberIds(item);
      if (!ids || (Array.isArray(ids) && ids.length === 0)) return true;
      if (Array.isArray(ids)) return ids.some((id) => memberFilter.isMemberSelected(id));
      return memberFilter.isMemberSelected(ids);
    });
  });
}
