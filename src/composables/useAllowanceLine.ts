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

  // Which family AND token the line currently describes. A latch on both, not a boolean:
  // switching family while the card stays mounted must refetch, a re-render must not, and the
  // plan token ARRIVING must refetch too. On a page refresh the card mounts before the family
  // file (and `settings.planToken` in it) has loaded, so the first read goes out without the
  // token and the server answers the basic tier; that read must not stick.
  let loadedFor: string | null = null;
  // ...and the PLAN: a switch in the portal (full ↔ basic) changes the allowance tier.
  const latchKey = (familyId: string) =>
    `${familyId}|${planToken.value ?? ''}|${entitlementStore.plan ?? ''}`;

  async function load(familyId: string): Promise<void> {
    const key = latchKey(familyId);
    try {
      const answer = await fetchAllowance({
        familyId,
        ...(planToken.value ? { planToken: planToken.value } : {}),
      });
      // A family switch (or the token arriving) while this was in flight: the answer is stale.
      if (loadedFor === key) usage.value = answer;
    } catch (err) {
      if (loadedFor === key) unavailable.value = true;
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
    [applies, () => familyContextStore.activeFamilyId, planToken, () => entitlementStore.plan],
    ([now, familyId]) => {
      if (!now || !familyId || loadedFor === latchKey(familyId)) return;
      loadedFor = latchKey(familyId);
      usage.value = null;
      unavailable.value = false;
      void load(familyId);
    },
    { immediate: true }
  );

  /**
   * What is left, or null when the line does not apply, usage could not be read or has not
   * arrived yet. The one place `limit - used` is computed; `line`, `pct` and `brief` derive from it.
   */
  const remaining = computed<{
    left: number;
    limit: number;
    period: AllowanceUsage['period'];
  } | null>(() => {
    const u = usage.value;
    if (!applies.value || unavailable.value || !u) return null;
    return { left: Math.max(0, u.limit - u.used), limit: u.limit, period: u.period };
  });

  const line = computed<string | null>(() => {
    if (!applies.value) return null;
    if (unavailable.value) return t('plan.allowance.unavailable');
    const u = usage.value;
    const r = remaining.value;
    if (!u || !r) return null;
    // Non-null by construction: `fetchAllowance` (`parseAllowance`) rejects an unparseable
    // `resetsAt` before it can get here, so a second fallback would be unreachable.
    const reset = allowanceResetParts(u.resetsAt)!;
    // Both periods name the reset date AND local time: "resets on 2 Oct at 8:00am" reads the
    // same whether the window is a day or a month.
    const key = r.period === 'month' ? 'plan.allowance.month' : 'plan.allowance.day';
    return fillTemplate(t(key), {
      left: r.left,
      limit: r.limit,
      date: reset.date,
      time: reset.time,
    });
  });

  /** For the meter: how much of the allowance is LEFT, 0..100 (the sentence says "left", so the
   *  bar shrinks as beans are used), or null when the line does not apply. */
  const pct = computed<number | null>(() => {
    const r = remaining.value;
    if (!r || r.limit <= 0) return null;
    return Math.min(100, Math.round((r.left / r.limit) * 100));
  });

  /** The compact line for the FAB composer: no reset time (that stays on Settings/Plan), and null
   *  whenever `remaining` is, so a failed read shows nothing there (it still logs). */
  const brief = computed<string | null>(() => {
    const r = remaining.value;
    if (!r) return null;
    const key = r.period === 'month' ? 'plan.allowance.briefMonth' : 'plan.allowance.briefDay';
    return fillTemplate(t(key), { left: r.left, limit: r.limit });
  });

  return { line, pct, brief };
}
