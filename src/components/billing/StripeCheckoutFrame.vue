<script setup lang="ts">
/**
 * Stripe Embedded Checkout inside the Plan page (#95 Phase 5).
 *
 * `@stripe/stripe-js` is imported DYNAMICALLY inside this component so `loadStripe` (which
 * injects `js.stripe.com`) never runs at app boot and never ships in a native bundle: the Plan
 * route is web-only and this component only exists on it.
 *
 * Flow: `createCheckoutSession` (our Lambda picks the Price and any cohort discount) →
 * `createEmbeddedCheckoutPage({ fetchClientSecret, onComplete })` → the iframe → `onComplete`
 * emits `complete` with the session so the page can claim the plan token. `onComplete` is the
 * ONLY claim trigger; nothing is fulfilled from here (the webhook lands the subscription).
 *
 * There is no Appearance API on Embedded Checkout (dahlia): the iframe's colours come from the
 * per-session `branding_settings` the Lambda sets from the `theme` we send, so the frame is
 * re-created when the app switches theme while mounted (rare, cheap).
 *
 * Every failure is typed: `stripe_js_load_failed` (CSP / ad-block, retry), or a
 * `BillingApiError` code from the session call, shown in the page's error slot with a retry.
 */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { PlanId, PlanInterval } from '@beanies/brand/pricing';
import { useDarkMode } from '@/composables/useDarkMode';
import { useEntitlementStore } from '@/stores/entitlementStore';
import { useTranslation } from '@/composables/useTranslation';
import { BILLING_UI_SURFACE } from '@/composables/usePlanPortal';
import {
  createCheckoutSession,
  BillingApiError,
  type CheckoutSession,
} from '@/services/billing/billingApi';
import { logEvent } from '@/services/telemetry';
import { reportError } from '@/utils/errorReporter';
import BaseButton from '@/components/ui/BaseButton.vue';

const props = defineProps<{
  familyId: string;
  plan: PlanId;
  interval: PlanInterval;
  currency: 'usd' | 'sgd';
}>();

const emit = defineEmits<{
  /** The customer paid inside the frame. Carries the session used, for the claim. */
  (e: 'complete', session: CheckoutSession): void;
}>();

const { t } = useTranslation();
const { isDark } = useDarkMode();

const mountEl = ref<HTMLElement | null>(null);
const status = ref<'loading' | 'ready' | 'error'>('loading');
const errorKey = ref<
  | 'plan.error.stripeJs'
  | 'plan.error.notConfigured'
  | 'plan.error.checkoutUnavailable'
  | 'plan.error.alreadySubscribed'
>('plan.error.checkoutUnavailable');

type EmbeddedCheckout = { mount(el: HTMLElement): void; destroy(): void };
let checkout: EmbeddedCheckout | null = null;
let generation = 0;

function destroyCheckout(): void {
  try {
    checkout?.destroy();
  } catch (err) {
    // A destroy on an already-torn-down frame is harmless; it is logged so it is not silent.
    logEvent({
      level: 'debug',
      surface: BILLING_UI_SURFACE,
      message: 'checkout destroy threw',
      context: { action: 'checkout_destroy' },
      error: err,
    });
  }
  checkout = null;
}

async function mountCheckout(): Promise<void> {
  const myGen = ++generation;
  // A family that is already paying never gets a session created for it (a remount racing a
  // refresh that just landed `active`); the page swaps to the active view on its own.
  if (useEntitlementStore().state === 'active') return;
  destroyCheckout();
  status.value = 'loading';
  let session: CheckoutSession | null = null;

  let stripeMod: typeof import('@stripe/stripe-js');
  // An unset key is a BUILD defect (the deploy secret, or a local .env), not a content blocker:
  // its own code and copy, so the firehose never files it as ad-block noise.
  const publishableKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;
  if (!publishableKey) {
    fail(
      'plan.error.notConfigured',
      'checkout_failed',
      new Error('VITE_STRIPE_PUBLISHABLE_KEY unset'),
      0,
      'not_configured'
    );
    return;
  }
  try {
    stripeMod = await import('@stripe/stripe-js');
  } catch (err) {
    if (myGen !== generation) return;
    fail('plan.error.stripeJs', 'stripe_js_load_failed', err, 0);
    return;
  }
  const stripe = await stripeMod.loadStripe(publishableKey).catch(() => null);
  // Every await above may resolve after a retry or a plan change started a newer mount; a stale
  // mount must not flip the newer one's status.
  if (myGen !== generation) return;
  if (!stripe) {
    fail(
      'plan.error.stripeJs',
      'stripe_js_load_failed',
      new Error('loadStripe returned null (blocked?)'),
      0
    );
    return;
  }

  try {
    // The session is created HERE, before Stripe is involved: a `fetchClientSecret` that rejects
    // is swallowed inside Stripe's iframe ("Timed out waiting for client secret") and never
    // reaches this catch, so a refused session (dev_origin, price_missing, upstream) would show
    // a spinner forever instead of the error state with its retry. Found in the browser walk.
    session = await createCheckoutSession({
      familyId: props.familyId,
      plan: props.plan,
      interval: props.interval,
      currency: props.currency,
      theme: isDark.value ? 'dark' : 'light',
    });
    if (myGen !== generation) return;
    const secret = session.clientSecret;
    const instance = await stripe.createEmbeddedCheckoutPage({
      fetchClientSecret: async () => secret,
      onComplete: () => {
        logEvent({
          level: 'info',
          surface: BILLING_UI_SURFACE,
          message: 'checkout complete',
          context: { action: 'checkout_complete', plan: props.plan },
        });
        if (session) emit('complete', session);
      },
    });
    if (myGen !== generation) {
      instance.destroy();
      return;
    }
    checkout = instance;
    if (mountEl.value) checkout.mount(mountEl.value);
    status.value = 'ready';
    logEvent({
      level: 'info',
      surface: BILLING_UI_SURFACE,
      message: 'checkout mounted',
      context: { action: 'checkout_mounted', plan: props.plan, dry_run: false },
    });
  } catch (err) {
    if (myGen !== generation) return;
    const code = err instanceof BillingApiError ? err.code : 'unknown';
    const httpStatus = err instanceof BillingApiError ? err.httpStatus : 0;
    if (code === 'already_subscribed') {
      // Another device paid, or the webhook landed first: an expected outcome, not a failure.
      status.value = 'error';
      errorKey.value = 'plan.error.alreadySubscribed';
      logEvent({
        level: 'info',
        surface: BILLING_UI_SURFACE,
        message: 'checkout refused: the family already has a plan',
        context: { action: 'checkout_refused', error_code: code, plan: props.plan },
      });
      void useEntitlementStore().refresh({ force: true });
      return;
    }
    fail('plan.error.checkoutUnavailable', 'checkout_failed', err, httpStatus, code);
  }
}

function fail(
  key: typeof errorKey.value,
  action: string,
  err: unknown,
  httpStatus: number,
  code = 'stripe_js_load_failed'
): void {
  status.value = 'error';
  errorKey.value = key;
  reportError({
    surface: BILLING_UI_SURFACE,
    message:
      action === 'stripe_js_load_failed'
        ? '[billing] Stripe.js could not load: a content blocker or CSP is refusing js.stripe.com, or VITE_STRIPE_PUBLISHABLE_KEY is unset in the build. The page offers a retry.'
        : `[billing] checkout could not start (${code}). price_missing / coupon_unset are Dashboard objects (docs/runbooks/pricing-launch.md); billing_upstream is Stripe or STRIPE_SECRET_KEY.`,
    error: err,
    severity: 'error',
    context: { action, error_code: code, http_status: httpStatus, plan: props.plan },
  });
}

onMounted(() => void mountCheckout());
onBeforeUnmount(() => {
  generation++;
  if (remountTimer) clearTimeout(remountTimer);
  destroyCheckout();
});
// A new plan, interval, currency or theme is a new session: the Lambda chooses the Price and
// the branding per session. DEBOUNCED: a family clicking basic → full → Monthly → SGD in two
// seconds must not create five Stripe sessions (and trip the route's burst-5 throttle); only the
// choice they settle on becomes a session.
const REMOUNT_DEBOUNCE_MS = 450;
let remountTimer: ReturnType<typeof setTimeout> | null = null;
watch([() => props.plan, () => props.interval, () => props.currency, isDark], () => {
  if (remountTimer) clearTimeout(remountTimer);
  generation++; // a stale in-flight mount must not land while the family is still choosing
  status.value = 'loading';
  remountTimer = setTimeout(() => {
    remountTimer = null;
    void mountCheckout();
  }, REMOUNT_DEBOUNCE_MS);
});
</script>

<template>
  <div
    data-testid="checkout-frame"
    class="dark:bg-surface-raised dark:border-line border-secondary-100 rounded-[var(--sq)] border bg-white p-3 sm:p-5"
  >
    <p
      v-if="status === 'loading'"
      class="text-secondary-400 dark:text-ink-soft py-8 text-center text-sm"
    >
      {{ t('plan.checkout.loading') }}
    </p>
    <div v-else-if="status === 'error'" class="py-6 text-center">
      <p class="text-secondary-500 dark:text-ink text-sm">{{ t(errorKey) }}</p>
      <BaseButton
        v-if="errorKey !== 'plan.error.alreadySubscribed'"
        variant="secondary"
        size="sm"
        class="mt-3"
        data-testid="checkout-retry"
        @click="mountCheckout"
      >
        {{ t('plan.checkout.retry') }}
      </BaseButton>
    </div>
    <!-- Stripe mounts its iframe here; kept in the DOM in every state so a retry has a target. -->
    <div ref="mountEl" :class="status === 'ready' ? '' : 'hidden'" />
  </div>
</template>
