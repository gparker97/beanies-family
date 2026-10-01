/**
 * "Manage plan" / "Receipts" (#95 Phase 5): open Stripe's hosted Customer Portal.
 *
 * ONE composable for the two surfaces that offer it (the Settings `PlanCard` and the Plan
 * page's active card), so the token rule, the navigation and the failure copy cannot drift.
 *
 * Web only: native carries no purchase or management affordance (Apple 3.1.3(f)). The portal
 * needs the family's plan token; a paying family whose token is missing from the doc
 * (`plan_token_missing`) or does not match gets a calm "we've been told" and the event pages
 * (critical) with the recovery, which is refund + subscribe again. No paste, no reissue.
 *
 * The portal opens in a NEW TAB (greg, 2026-10-01): the app keeps its state (no cold start, no
 * PIN lock on the way back) and a receipt is a glance-and-close. The URL only exists after an
 * await, and `window.open` after an await is popup-blocked, so a blank tab is opened
 * synchronously inside the click and pointed at the portal once the Lambda answers. When the
 * popup is blocked (null), the same tab is used instead; the portal's `return_url` brings the
 * family back to `/settings/plan` either way.
 *
 * Because the app tab stays alive, a cancel or a plan switch made in the portal is picked up by
 * a FORCED entitlement refresh the first time this tab regains focus afterwards (the hourly poll
 * and its five-minute floor would otherwise show the old plan for a while).
 */
import { computed, ref } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { showToast } from '@/composables/useToast';
import { useEntitlementStore } from '@/stores/entitlementStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useFamilyContextStore } from '@/stores/familyContextStore';
import { isNative } from '@/services/sync/capabilities';
import { createPortalSession, BillingApiError } from '@/services/billing/billingApi';
import { logEvent } from '@/services/telemetry';
import { reportError } from '@/utils/errorReporter';

export const BILLING_UI_SURFACE = 'billing-ui';

/**
 * One forced refresh the next time this tab is visible again after a portal was opened, so
 * whatever the family did there shows on the card at once. MODULE scope, not per instance: the
 * Settings card and the Plan page both use this composable, and one return must mean one
 * refresh. One-shot: the listener removes itself, and the next portal visit re-arms it.
 */
/** Follow-up asks after the first return-from-portal refresh (webhook latency). */
export const PORTAL_RETURN_RECHECKS_MS = [6_000, 25_000] as const;

let armed = false;
function armRefreshOnReturn(): void {
  if (armed || typeof document === 'undefined') return;
  armed = true;
  const onReturn = (): void => {
    if (document.visibilityState !== 'visible') return;
    document.removeEventListener('visibilitychange', onReturn);
    window.removeEventListener('focus', onReturn);
    armed = false;
    logEvent({
      level: 'info',
      surface: BILLING_UI_SURFACE,
      message: 'back from the portal; refreshing the plan',
      context: { action: 'portal_return_refresh' },
    });
    // The first ask races Stripe's webhook (a family switching straight back from the portal
    // beats `customer.subscription.updated` by a second or two), so ask again shortly after,
    // twice, past the five-minute floor each time. The row converges; the card follows.
    const store = useEntitlementStore();
    void store.refresh({ force: true });
    for (const delayMs of PORTAL_RETURN_RECHECKS_MS) {
      setTimeout(() => void store.refresh({ force: true }), delayMs);
    }
  };
  document.addEventListener('visibilitychange', onReturn);
  window.addEventListener('focus', onReturn);
}

export function usePlanPortal() {
  const { t } = useTranslation();
  const entitlementStore = useEntitlementStore();
  const settingsStore = useSettingsStore();
  const familyContextStore = useFamilyContextStore();
  const native = isNative();
  const opening = ref(false);

  /** Manage / Receipts are offered on the web, on an active plan, never while stale. */
  const showManage = computed(
    () => !native && entitlementStore.state === 'active' && !entitlementStore.isStale
  );
  const hasToken = computed(() => Boolean(settingsStore.settings.planToken));

  async function openPortal(): Promise<void> {
    if (opening.value) return;
    const familyId = familyContextStore.activeFamilyId;
    const planToken = settingsStore.settings.planToken;
    if (!familyId) return;
    if (!planToken) {
      // A paying family with no token in its doc: never the family's problem to fix (there is
      // deliberately no paste or reissue). Page with the recovery, show the calm message.
      reportError({
        surface: BILLING_UI_SURFACE,
        message: `[billing] a paying family's doc holds no plan token, so the portal cannot open. Recovery is the one path that mints tokens: refund the current period in the Stripe Dashboard and ask the family to choose the plan again; the claim writes a fresh token. There is deliberately no token paste or reissue.`,
        severity: 'critical',
        context: { action: 'portal_failed', error_code: 'token_missing' },
      });
      showToast(
        'error',
        t('plan.error.portalUnavailable.title'),
        t('plan.error.portalUnavailable.badToken')
      );
      return;
    }
    opening.value = true;
    // Synchronously, inside the gesture: a blank tab that the awaited URL will fill.
    let tab: Window | null = null;
    try {
      tab = window.open('', '_blank');
      if (tab) tab.opener = null;
    } catch (err) {
      // A browser that throws here (not just returns null) still gets the same-tab fallback.
      tab = null;
      logEvent({
        level: 'warn',
        surface: BILLING_UI_SURFACE,
        message: 'window.open threw; falling back to the same tab for the portal',
        context: { action: 'portal_open_threw' },
        error: err,
      });
    }
    try {
      const { url } = await createPortalSession({ familyId, planToken });
      logEvent({
        level: 'info',
        surface: BILLING_UI_SURFACE,
        message: 'portal opened',
        context: { action: 'portal_opened', detail: tab ? 'new_tab' : 'same_tab' },
      });
      armRefreshOnReturn();
      if (tab && !tab.closed) tab.location.href = url;
      else window.location.assign(url);
    } catch (err) {
      if (tab && !tab.closed) tab.close();
      const code = err instanceof BillingApiError ? err.code : 'unknown';
      const httpStatus = err instanceof BillingApiError ? err.httpStatus : 0;
      // A token that does not match the row is never something a family can fix: it arises
      // only from a reissue or a settings overwrite. So it PAGES (critical) with the
      // remediation, and the family gets a calm "we've been told", not instructions.
      const badToken = code === 'bad_token';
      reportError({
        surface: BILLING_UI_SURFACE,
        message: badToken
          ? `[billing] a paying family's plan token does not match its billing row. Recovery is the one path that mints tokens: refund the current period in the Stripe Dashboard and ask the family to choose the plan again; the claim writes a fresh token. There is deliberately no token paste or reissue.`
          : `[billing] the Customer Portal could not be opened (${code}).`,
        error: err,
        severity: badToken ? 'critical' : 'error',
        context: { action: 'portal_failed', error_code: code, http_status: httpStatus },
      });
      showToast(
        'error',
        t('plan.error.portalUnavailable.title'),
        code === 'bad_token'
          ? t('plan.error.portalUnavailable.badToken')
          : t('plan.error.portalUnavailable.message')
      );
    } finally {
      opening.value = false;
    }
  }

  return { showManage, hasToken, opening, openPortal };
}
