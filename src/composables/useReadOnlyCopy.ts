/**
 * Why this family is read-only, in the words each platform may use (#95).
 *
 * ONE SOURCE FOR TWO SURFACES. The Settings `PlanCard` and the app-wide `ReadOnlyBanner` must say
 * the same thing, and the native wording is greg's final, App Review-safe copy: no link, URL,
 * price or purchase verb (Apple 3.1.3(f), Google Play payments policy). A second hand-written
 * copy of this choice would be a second place for native copy to drift.
 *
 * The choice, in order:
 *   - STALE (an open-ended answer older than the offline grace window): the device only needs to
 *     reconnect, so that is all it says, on every platform, with the enforced number of days;
 *   - LAPSED (a plan ended): the lapsed sentence;
 *   - otherwise (the trial ended): the native or the web sentence.
 * Native then adds "plans can't be chosen here" (never while stale: nothing needs choosing).
 *
 * "SEE PLANS" IS DECIDED HERE TOO (`showSeePlans`), for the same reason: web only (native carries
 * no purchase affordance), only once the Plan route exists (Phase 5; until then no button that
 * goes nowhere), only in beta, trial or read-only, and NEVER while stale: that family may well
 * be paying and only offline, so offering checkout would invite a second subscription.
 */
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { useTranslation } from '@/composables/useTranslation';
import { useEntitlementStore } from '@/stores/entitlementStore';
import { isNative } from '@/services/sync/capabilities';
import { fillTemplate } from '@/utils/fillTemplate';
import { OFFLINE_GRACE_DAYS, PLAN_ROUTE_NAME } from '@/constants/entitlement';
import { isPlanPageReachable } from '@/services/billing/pricingGate';

export function useReadOnlyCopy() {
  const { t } = useTranslation();
  const entitlementStore = useEntitlementStore();
  const router = useRouter();
  // Neither changes for the app's lifetime: the platform is fixed, routes register at startup.
  const native = isNative();
  // Whether the Plan page is REACHABLE here (cloud web build with Stripe, flag on, not native)
  // is the router guard's own predicate, so "See plans" can never lead to a bounce.
  const planRouteExists = router.hasRoute(PLAN_ROUTE_NAME) && isPlanPageReachable();

  /** The read-only explanation, one string per paragraph. Meaningful only in `read_only`. */
  const paragraphs = computed<string[]>(() => {
    if (entitlementStore.isStale) {
      return [fillTemplate(t('readOnly.stale'), { days: OFFLINE_GRACE_DAYS })];
    }
    let lead: string;
    if (entitlementStore.reason === 'lapsed') lead = t('readOnly.lapsed');
    else lead = native ? t('readOnly.native.trialEnded') : t('readOnly.web.trialEnded');
    return native ? [lead, t('readOnly.native.plansElsewhere')] : [lead];
  });

  /** Whether to offer "See plans"; see the header. */
  const showSeePlans = computed(
    () =>
      planRouteExists &&
      !entitlementStore.isStale &&
      ['beta', 'trial', 'read_only'].includes(entitlementStore.state ?? '')
  );

  function seePlans(): void {
    void router.push({ name: PLAN_ROUTE_NAME });
  }

  return { paragraphs, showSeePlans, seePlans };
}
