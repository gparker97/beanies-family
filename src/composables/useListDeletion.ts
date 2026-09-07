/**
 * Deleting a Beanie List, in one place.
 *
 * The detail drawer and the shelf tile both need confirm → delete, so without this the
 * sequence would exist twice the moment the tile gained its delete icon.
 *
 * It also closes a silent failure that is live today: `listStore.deleteList` returns
 * `false` WITHOUT throwing when the list is no longer in the projection, so `wrapAsync`'s
 * toast never fires — and `ListDetailModal.handleDelete` discarded that boolean and
 * emitted `deleted` + `close` regardless, shutting the drawer as though the delete had
 * worked. Exactly the class `useMemberRemoval` was written to close. Adding a second
 * call site without fixing it would have made it two silent failures instead of one.
 *
 * Authorization is deliberately absent, unlike `useMemberRemoval`. `ListDetailModal`
 * already passes `:show-delete="true"` unconditionally with no permission gate, so every
 * member can already delete any list from the drawer; the tile button is a second door
 * onto an existing surface, not a new one. If list deletion should be gated, this is the
 * single place to do it — but doing it here now would silently change drawer behaviour
 * that nothing asked to change.
 *
 * No router or emit dependency: closing/navigating stays at the call site, keyed on the
 * return value, so a third call site can reuse this without growing a branch.
 */
import { confirm as showConfirm } from '@/composables/useConfirm';
import { showToast } from '@/composables/useToast';
import { useListStore } from '@/stores/listStore';
import { useTranslationStore } from '@/stores/translationStore';
import { reportError } from '@/utils/errorReporter';

/**
 * Confirm, then delete.
 *
 * @returns `true` ONLY when the list was actually deleted, so callers can close or
 *   navigate on success and only on success.
 */
export async function confirmAndDeleteList(id: string): Promise<boolean> {
  const ok = await showConfirm({
    title: 'lists.detail.deleteConfirm.title',
    message: 'lists.detail.deleteConfirm.message',
    variant: 'danger',
  });
  if (!ok) return false;

  const deleted = await useListStore().deleteList(id);

  // `null` means the action THREW, and `wrapAsync` has already shown an error toast and
  // reported it. Saying anything here would stack a second sticky toast and a duplicate
  // report on one failure — which is why `deleteList` distinguishes the two at all.
  if (deleted === null) return false;

  if (deleted === false) {
    // The refused path: `deleteList` reported it at `warning` but told the user nothing,
    // so the drawer used to close as though it had worked. Say it, where a person is
    // watching.
    showToast('error', useTranslationStore().t('lists.detail.deleteFailed'));
    reportError({
      surface: 'lists',
      message: 'deleteList refused — the list was not removed',
      severity: 'warning',
      context: { action: 'delete_returned_false' },
    });
    return false;
  }
  return true;
}
