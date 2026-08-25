/**
 * "This recipe's photo is still on its way" — shared, per-recipe, app-wide.
 *
 * WHY MODULE-LEVEL STATE rather than a ref inside `useRecipeCapture`: the capture composable
 * is instantiated per page, but the thing that needs to show the waiting state is wherever
 * the photo will LAND — the cookbook card and the recipe detail hero — and the detail page
 * has no capture instance at all. A page-local flag could only drive a floating pill on the
 * page that happened to own the capture, which is why the first attempt at this was invisible
 * to anyone who tapped straight into the recipe, and why it also had to fight the modal
 * z-index stack to be seen.
 *
 * Keyed by recipe id, so two captures in a row cannot leave the wrong card spinning.
 *
 * Deliberately NOT persisted. If the tab closes mid-fetch the photo is simply absent, which
 * the UI already handles; a persisted "pending" that outlived the fetch would be a permanent
 * lie about work nobody is doing.
 */
import { computed, ref } from 'vue';
import { usePhotoStore } from '@/stores/photoStore';
import type { UUID } from '@/types/models';

const pendingIds = ref<string[]>([]);

export function useRecipePhotoPending() {
  function markPending(id: UUID): void {
    if (!pendingIds.value.includes(id)) pendingIds.value = [...pendingIds.value, id];
  }

  function clearPending(id: UUID): void {
    pendingIds.value = pendingIds.value.filter((x) => x !== id);
  }

  /**
   * Reactive per-id predicate for templates, covering the WHOLE wait — not just our half.
   *
   * A captured dish photo goes through two stages: we fetch the bytes from the web (this
   * module's own state), then hand them to the photo store, which queues an upload
   * (`pendingUploadsFor`). Reporting only the first stage would blink the spinner off
   * halfway through, exactly when the store's own upload is still running — so the frame
   * would go back to "no photo" and then suddenly have one. Both stages, one predicate.
   */
  function isPending(id: string | undefined | null): boolean {
    if (!id) return false;
    if (pendingIds.value.includes(id)) return true;
    return usePhotoStore().pendingUploadsFor('recipes', id).length > 0;
  }

  return {
    markPending,
    clearPending,
    isPending,
    /** True while ANY photo is in flight — for coarse, page-level affordances. */
    anyPending: computed(() => pendingIds.value.length > 0),
  };
}
