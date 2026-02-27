import { useSyncHighlightStore } from '@/stores/syncHighlightStore';
import { useReducedMotion } from './useReducedMotion';

export function useSyncHighlight() {
  const store = useSyncHighlightStore();
  const { prefersReducedMotion } = useReducedMotion();

  function syncHighlightClass(id: string): string {
    if (prefersReducedMotion.value) return '';
    if (store.isNewFromSync(id)) return 'beanie-sync-in';
    if (store.isModifiedFromSync(id)) return 'beanie-sync-pulse';
    return '';
  }

  return { syncHighlightClass };
}
