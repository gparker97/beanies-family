import { useFamilyStore } from '@/stores/familyStore';
import { useTranslation } from '@/composables/useTranslation';
import { showToast } from '@/composables/useToast';
import type { UIStringKey } from '@/services/translation/uiStrings';

/**
 * Shared helper for composables that need to attribute a user-initiated
 * action. Returns `currentMember.id` with owner fallback. If neither is
 * available (no family loaded, edge-case session), fires an error toast
 * and logs a developer-facing console.error, then returns `null`.
 *
 * Callers branch on the return value: `null` means "abort" for
 * hard-blocking cases, or "proceed without audit" for best-effort cases.
 *
 * Replaces the inline author-resolution that used to live in
 * useAdjustBalance; now also consumed by useContributeToGoal. Centralises
 * the failure UX so both callers surface errors the same way.
 */
export function useAuthoringMember() {
  const familyStore = useFamilyStore();
  const { t } = useTranslation();

  function resolveOrToast(opts: {
    callerTag: string;
    toastTitleKey: UIStringKey;
    toastHelpKey: UIStringKey;
  }): string | null {
    const author = familyStore.currentMember?.id ?? familyStore.owner?.id ?? null;
    if (!author) {
      console.error(`[${opts.callerTag}] no authorable member`);
      showToast('error', t(opts.toastTitleKey), t(opts.toastHelpKey));
    }
    return author;
  }

  return { resolveOrToast };
}
