/**
 * Retiring a recovery kit from Manage Kits, in one place (tracker #99).
 *
 * The `removeMember` shape (`useMemberRemoval.ts`): authorization → confirm → step-up →
 * store → toast, as plain exported functions with no composable state. The authorization
 * check leads and is NOT the step-up below it: the step-up proves the actor is who the
 * session says, `canManagePod` is whether an irreversible, syncing change is theirs to
 * make. `usePermissions()` is the one source of truth for that (reading
 * `currentMember.canManagePod` raw can deny the owner — see `useMintTarget.ts`).
 *
 * `authStore.invalidateRecoveryKit` owns the outcome; this file owns the copy for it, so
 * the store never translates and the two Settings paths (Invalidate, Replace) share one
 * outcome → toast mapping.
 */
import { useAuthStore, type KitInvalidateOutcome } from '@/stores/authStore';
import { usePermissions } from '@/composables/usePermissions';
import { confirm as showConfirm, alert as showAlert } from '@/composables/useConfirm';
import { requireReauth } from '@/composables/useReauth';
import { showToast } from '@/composables/useToast';
import { useTranslationStore } from '@/stores/translationStore';
import { fillTemplate } from '@/utils/fillTemplate';
import { emitKitInvalidateOutcome } from '@/services/telemetry/loginFlowEvents';
import type { RecoveryKitSummary } from '@/services/auth/recoveryKit';

/**
 * Authorization gate shared by both actions. Alerts the person and records the refusal;
 * the store is never reached.
 */
async function assertCanManageKits(kind: 'invalidate' | 'replace'): Promise<boolean> {
  const { canManagePod } = usePermissions();
  if (canManagePod.value) return true;
  emitKitInvalidateOutcome({ outcome: 'refused', kind, errorCode: 'not_authorized' });
  await showAlert({ title: 'confirm.notAllowedTitle', message: 'settings.adminOnly' });
  return false;
}

/**
 * The ONE outcome → copy mapping. `'saved'` is done; any other push result means the
 * tombstone is staged and rides the next save (never rolled back), which is what the info
 * toast says. `'error'` is silent to the reporter because the store already reported it.
 */
export function toastKitInvalidateOutcome(outcome: KitInvalidateOutcome): void {
  const t = useTranslationStore().t;
  if (outcome.invalidated) {
    if (outcome.save === 'saved') showToast('success', t('recovery.kitInvalidated'));
    else showToast('info', t('recovery.kitInvalidateNotSynced'));
    return;
  }
  switch (outcome.refusal) {
    case 'last_kit':
      showToast('error', t('recovery.kitLastKit'));
      return;
    case 'no_envelope':
      showToast('error', t('recovery.podNotOpen'));
      return;
    case 'error':
      showToast('error', t('recovery.kitInvalidateFailed'), undefined, {
        surface: 'recovery-kits',
        silent: true,
      });
      return;
  }
}

/**
 * Invalidate one kit: gate → destructive confirm (names the kit ID, states the old-copy
 * limit) → step-up → store → toast.
 *
 * @returns `true` ONLY when the kit was actually invalidated.
 */
export async function invalidateKit(kit: RecoveryKitSummary): Promise<boolean> {
  if (!(await assertCanManageKits('invalidate'))) return false;
  const t = useTranslationStore().t;
  const confirmed = await showConfirm({
    title: 'recovery.kitInvalidateTitle',
    message: 'recovery.kitInvalidateBody',
    detail: fillTemplate(t('recovery.kitInvalidateLimit'), { kitId: kit.kitId }),
    detailTone: 'caution',
    variant: 'danger',
    confirmLabel: 'recovery.kitInvalidateConfirm',
  });
  if (!confirmed) return false;
  // Step-up AFTER the confirm, so cancelling the confirm never shows a PIN prompt.
  if (!(await requireReauth({ reasonKey: 'recovery.kitReauthReason' }))) return false;

  const outcome = await useAuthStore().invalidateRecoveryKit(kit.kitId, { kind: 'invalidate' });
  toastKitInvalidateOutcome(outcome);
  return outcome.invalidated;
}

/**
 * The approval half of replacing the last live kit: gate → confirm (the two steps, in
 * words) → step-up. The mint and the post-confirm invalidation belong to the host
 * (`RecoverySettings`), which owns the kit modal; this takes no flow instance.
 *
 * @returns whether the person may proceed to mint the replacement.
 */
export async function approveReplace(kit: RecoveryKitSummary): Promise<boolean> {
  if (!(await assertCanManageKits('replace'))) return false;
  const t = useTranslationStore().t;
  const confirmed = await showConfirm({
    title: 'recovery.kitReplaceTitle',
    message: 'recovery.kitReplaceBody',
    detail: fillTemplate(t('recovery.kitRowLabel'), { kitId: kit.kitId }),
    variant: 'info',
    confirmLabel: 'recovery.kitReplaceConfirm',
  });
  if (!confirmed) return false;
  return requireReauth({ reasonKey: 'recovery.kitReauthReason' });
}
