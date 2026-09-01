/**
 * Removing a bean, in one place (#80).
 *
 * MeetTheBeansPage and BeanDetailPage carried the same owner-check → confirm → delete
 * sequence, so adding the step-up to both would have made it a third and fourth copy of a
 * security-relevant flow. It lives here once instead.
 *
 * Also closes a pre-existing silent failure this change would otherwise have built on
 * top of: `familyStore.deleteMember` returns `false` WITHOUT throwing when the repository
 * reports no such row, so `wrapAsync`'s toast never fires. Both pages discarded that
 * boolean, and BeanDetailPage navigated away as though a failed deletion had succeeded.
 *
 * No router dependency: navigation stays at the call site, keyed on the return value, so
 * a third page can reuse this without growing a routing branch.
 */
import { useFamilyStore } from '@/stores/familyStore';
import { usePermissions } from '@/composables/usePermissions';
import { confirm as showConfirm, alert as showAlert } from '@/composables/useConfirm';
import { requireReauth } from '@/composables/useReauth';
import { showToast } from '@/composables/useToast';
import { useTranslationStore } from '@/stores/translationStore';
import { reportError } from '@/utils/errorReporter';

/**
 * Authorization → owner-check → confirm → step-up → delete.
 *
 * The authorization check leads, and it is NOT the same thing as the step-up below it.
 * The step-up asks the actor to prove they are who the session says (authentication); it
 * says nothing about whether that person may remove anyone — a child prompted for their
 * own PIN passes it every time. `canManagePod` is the check that a permanent, syncing,
 * irreversible deletion is theirs to make. Before this composable the rule lived only in
 * `:can-manage` props on two templates, so anything reaching the flow another way (a
 * deep link, the console) removed a sibling unchallenged. `ResetMemberPinModal` keeps the
 * same pair for the same reason.
 *
 * @returns `true` ONLY when the member was actually removed, so callers can navigate on
 *   success and only on success.
 */
export async function removeMember(id: string): Promise<boolean> {
  const familyStore = useFamilyStore();
  const { canManagePod } = usePermissions();
  const target = familyStore.members.find((m) => m.id === id);

  if (!canManagePod.value) {
    await showAlert({
      title: 'confirm.notAllowedTitle',
      message: 'family.removeNotAllowed',
    });
    reportError({
      surface: 'member-removal',
      message: 'removal refused: actor lacks canManagePod',
      severity: 'warning',
      context: { action: 'delete_refused_unauthorized', member_id_tail: id.slice(-6) },
    });
    return false;
  }

  if (target?.role === 'owner') {
    await showAlert({
      title: 'confirm.cannotDeleteOwnerTitle',
      message: 'family.cannotDeleteOwner',
    });
    return false;
  }

  if (
    !(await showConfirm({ title: 'confirm.deleteMemberTitle', message: 'family.deleteConfirm' }))
  ) {
    return false;
  }

  // Step-up AFTER the confirm, so cancelling the confirm never shows a PIN prompt.
  if (!(await requireReauth())) return false;

  const removed = await familyStore.deleteMember(id);
  if (!removed) {
    // Previously invisible: no throw, so no toast, and the caller navigated anyway.
    const t = useTranslationStore().t;
    showToast('error', t('family.deleteFailed'));
    reportError({
      surface: 'member-removal',
      message: 'deleteMember returned false',
      severity: 'warning',
      context: { action: 'delete_returned_false', member_id_tail: id.slice(-6) },
    });
    return false;
  }
  return true;
}
