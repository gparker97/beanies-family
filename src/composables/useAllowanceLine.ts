// The Settings plan card's magic-beans line (#95 Phase 4): "N of M magic beans left today, more
// at 8am." Its own composable so the card gains one import and one line, and the fetch, its
// failure and its copy stay testable without mounting the card.

import { computed, ref, watch } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { useAiCapability } from '@/composables/useAiCapability';
import { useEntitlementStore } from '@/stores/entitlementStore';
import { useFamilyContextStore } from '@/stores/familyContextStore';
import { fetchAllowance } from '@/services/ai/providers/managedProvider';
import { ExtractionProviderError, type AllowanceUsage } from '@/services/ai/types';
import { logEvent } from '@/services/telemetry/logEvent';
import { allowanceResetParts } from '@/utils/allowanceReset';
import { fillTemplate } from '@/utils/fillTemplate';

const SURFACE = 'ai-allowance';

/**
 * The line, or null when it does not apply: only on the managed tier (their own key is
 * unlimited, so there is nothing to count) and only in the trial and active states (beta is
 * not metered; read-only cannot start a managed read at all).
 *
 * Fetched once per family while mounted, the first time the line applies (the entitlement may
 * still be loading when the card mounts), and again only if the active family changes; never on
 * re-render. A failure never throws: it shows "usage isn't
 * available right now" and logs a warning with what to check.
 */
export function useAllowanceLine() {
  const { t } = useTranslation();
  const entitlementStore = useEntitlementStore();
  const familyContextStore = useFamilyContextStore();
  const { tier, planToken } = useAiCapability();

  const usage = ref<AllowanceUsage | null>(null);
  const unavailable = ref(false);

  const applies = computed(
    () =>
      tier.value === 'managed' &&
      (entitlementStore.state === 'trial' || entitlementStore.state === 'active') &&
      Boolean(familyContextStore.activeFamilyId)
  );

  // Which family the line currently describes. A latch on the FAMILY, not a boolean: switching
  // family while the card stays mounted must refetch, and a re-render must not.
  let loadedFor: string | null = null;

  async function load(familyId: string): Promise<void> {
    try {
      const answer = await fetchAllowance({
        familyId,
        ...(planToken.value ? { planToken: planToken.value } : {}),
      });
      // A family switch while this was in flight: the answer is about the old family.
      if (loadedFor === familyId) usage.value = answer;
    } catch (err) {
      if (loadedFor === familyId) unavailable.value = true;
      const code = err instanceof ExtractionProviderError ? err.code : 'unknown';
      console.warn(
        `[ai-allowance] could not read magic-beans usage (${code}). Check the ai-extract Lambda ` +
          'logs for allowance_store_error, that BILLING_TABLE_NAME and USAGE_TABLE are set on it, ' +
          'and that the deployed Lambda understands protocol "allowance".',
        err
      );
      logEvent({
        level: 'warn',
        surface: SURFACE,
        message: 'magic-beans usage read failed',
        context: { action: 'usage_read_failed', error_code: code },
      });
    }
  }

  watch(
    [applies, () => familyContextStore.activeFamilyId],
    ([now, familyId]) => {
      if (!now || !familyId || loadedFor === familyId) return;
      loadedFor = familyId;
      usage.value = null;
      unavailable.value = false;
      void load(familyId);
    },
    { immediate: true }
  );

  const line = computed<string | null>(() => {
    if (!applies.value) return null;
    if (unavailable.value) return t('plan.allowance.unavailable');
    const u = usage.value;
    if (!u) return null;
    // Non-null by construction: `fetchAllowance` (`parseAllowance`) rejects an unparseable
    // `resetsAt` before it can get here, so a second fallback would be unreachable.
    const reset = allowanceResetParts(u.resetsAt)!;
    const left = Math.max(0, u.limit - u.used);
    return u.period === 'month'
      ? fillTemplate(t('plan.allowance.month'), { left, limit: u.limit, date: reset.date })
      : fillTemplate(t('plan.allowance.day'), { left, limit: u.limit, time: reset.time });
  });

  return { line };
}
