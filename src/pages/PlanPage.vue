<script setup lang="ts">
/**
 * Settings → Plan (#95 Phase 5): pick a plan, pay inside the page, land the plan token.
 *
 * WEB ONLY. The route is unreachable on iOS and Android (router `webOnly` guard); nothing here
 * may be linked from a native surface. Mockup: docs/mockups/pricing-plan-and-read-only-2026-09-30.html
 * (functionality first, design tweaks later, per the approval).
 *
 * Three views, chosen by `entitlementStore.state`:
 *   * choosing (beta / trial / read-only): currency pills, the cohort line, two plan cards
 *     (radio group), the interval toggle on the full plan, and the embedded checkout below;
 *   * claiming: right after `onComplete`, while the plan token is fetched and stored;
 *   * active: the plan, renewal date, magic-beans line, Manage plan / Receipts (the Customer
 *     Portal, via `usePlanPortal`), and the paste field for a reissued plan token when the doc
 *     has none (`plan_token_missing`).
 *
 * The claim is the one step money depends on: `claim` returns the token ONCE, and the only
 * other copy is the hash in the billing row. So a claim that fails after a completed payment
 * is `severity: 'critical'` (Slack), keeps the session so the user can retry, and names
 * `--reissue-token` in the console line.
 */
import { computed, onMounted, ref, watch } from 'vue';
import {
  PRICES,
  TRIAL_DAYS,
  familyPrice,
  type CurrencyCode,
  type PlanId,
  type PlanInterval,
} from '@beanies/brand/pricing';
import { useTranslation } from '@/composables/useTranslation';
import { useEntitlementStore } from '@/stores/entitlementStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useFamilyContextStore } from '@/stores/familyContextStore';
import { BILLING_UI_SURFACE } from '@/composables/usePlanPortal';
import PlanPortalActions from '@/components/billing/PlanPortalActions.vue';
import PlanChoiceCard from '@/components/billing/PlanChoiceCard.vue';
import AllowanceMeter from '@/components/billing/AllowanceMeter.vue';
import BeanieIcon from '@/components/ui/BeanieIcon.vue';
import { useRouter } from 'vue-router';
import { usePlanLimits } from '@/composables/usePlanLimits';
import type { UIStringKey } from '@/services/translation/uiStrings';
import { usePlanSummary } from '@/composables/usePlanSummary';
import { useReadOnlyCopy } from '@/composables/useReadOnlyCopy';
import { formatDate } from '@/utils/date';
import { claim, BillingApiError, type CheckoutSession } from '@/services/billing/billingApi';
import { logEvent } from '@/services/telemetry';
import { reportError } from '@/utils/errorReporter';
import { showToast } from '@/composables/useToast';
import { fillTemplate } from '@/utils/fillTemplate';
import BaseButton from '@/components/ui/BaseButton.vue';
import StripeCheckoutFrame from '@/components/billing/StripeCheckoutFrame.vue';

const { t } = useTranslation();
const entitlementStore = useEntitlementStore();
const settingsStore = useSettingsStore();
const familyContextStore = useFamilyContextStore();
const planSummary = usePlanSummary();
const router = useRouter();

const familyId = computed(() => familyContextStore.activeFamilyId);

// ── Choosing ────────────────────────────────────────────────────────────────
const CURRENCIES: CurrencyCode[] = ['USD', 'SGD'];
const currency = ref<CurrencyCode>(settingsStore.settings.baseCurrency === 'SGD' ? 'SGD' : 'USD');
const plan = ref<PlanId>('full');
const interval = ref<PlanInterval>('year');
const table = computed(() => PRICES[currency.value]);
const cohort = computed(() => entitlementStore.cohort);

const basicPrice = computed(() => familyPrice(table.value, 'basic', 'year', cohort.value));
const fullPrice = computed(() => familyPrice(table.value, 'full', interval.value, cohort.value));
const fullMonthly = computed(() => familyPrice(table.value, 'full', 'month', cohort.value).price);

const INTERVALS: PlanInterval[] = ['year', 'month'];
const BASIC_BULLETS = [
  'plan.bullets.basic1',
  'plan.bullets.basic2',
  'plan.bullets.basic3',
] as const;
// The Full allowance is a Terraform value served live (#120): the number when it is known, a
// wordless line when it is not, so the page never states a stale figure.
const { fullPerDay } = usePlanLimits();
const FULL_BULLETS = computed<UIStringKey[]>(() => [
  fullPerDay.value === null ? 'plan.bullets.full1Fallback' : 'plan.bullets.full1',
  'plan.bullets.full2',
  'plan.bullets.full3',
]);

function choose(next: PlanId): void {
  plan.value = next;
  if (next === 'basic') interval.value = 'year';
}
function chooseCycle(next: PlanInterval): void {
  choose('full');
  interval.value = next;
}

const { paragraphs: readOnlyParagraphs } = useReadOnlyCopy();
const subtitle = computed(() => {
  switch (entitlementStore.state) {
    case 'trial':
      return fillTemplate(t('plan.page.subtitle.trial'), {
        day: entitlementStore.trialDay ?? 1,
        total: TRIAL_DAYS,
      });
    case 'read_only':
      // Trial ended, lapsed or stale: the same sentence the card and the band use.
      return readOnlyParagraphs.value[0] ?? t('plan.page.subtitle.readOnly');
    case 'active':
      if (planSummary.phase.value === 'pastDue') return t('plan.page.subtitle.pastDue');
      if (planSummary.phase.value === 'ending' && entitlementStore.cancelAt) {
        return fillTemplate(t('plan.page.subtitle.ending'), {
          date: formatDate(entitlementStore.cancelAt),
        });
      }
      return t('plan.page.subtitle.active');
    case 'beta':
      return t('plan.page.subtitle.beta');
    default:
      return t('plan.page.loading');
  }
});

const cohortLine = computed<{ lead: string; bold: string; tail: string } | null>(() => {
  if (cohort.value === 'pre_v1') {
    return {
      lead: t('plan.cohort.page.preV1.lead'),
      bold: t('plan.cohort.page.preV1.bold'),
      tail: t('plan.cohort.page.noCode'),
    };
  }
  if (cohort.value === 'first_ten') {
    return {
      lead: t('plan.cohort.page.firstTen.lead'),
      bold: fillTemplate(t('plan.cohort.page.firstTen.bold'), {
        price: table.value.firstTenMonthly,
      }),
      tail: t('plan.cohort.page.noCode'),
    };
  }
  return null;
});

// ── Claiming ────────────────────────────────────────────────────────────────
type ClaimState = 'idle' | 'working' | 'failed';
const claimState = ref<ClaimState>('idle');
let pendingSession: CheckoutSession | null = null;
/**
 * The token the claim returned but the doc has not stored yet. The Lambda hands it out ONCE
 * (a second claim answers `{}`), so if `setPlanToken` fails the token must be kept here and the
 * retry must store THIS, not claim again; claiming again would "succeed" with no token.
 */
let unstoredToken: string | null = null;
/** The unstored token survives a navigation or reload: sessionStorage, per family, until stored. */
const pendingTokenKey = (id: string) => `beanies:planToken:pending:${id}`;
function rememberPending(id: string, token: string | null): void {
  try {
    if (token) sessionStorage.setItem(pendingTokenKey(id), token);
    else sessionStorage.removeItem(pendingTokenKey(id));
  } catch (err) {
    // Private mode / blocked storage: the in-memory copy still covers a retry on this page.
    logEvent({
      level: 'warn',
      surface: BILLING_UI_SURFACE,
      message: 'pending plan token could not be remembered',
      context: { action: 'token_remember_failed' },
      error: err,
    });
  }
}
function readPending(id: string): string | null {
  try {
    return sessionStorage.getItem(pendingTokenKey(id));
  } catch (err) {
    logEvent({
      level: 'warn',
      surface: BILLING_UI_SURFACE,
      message: 'pending plan token could not be read back',
      context: { action: 'token_recall_failed' },
      error: err,
    });
    return null;
  }
}
/** Claim codes a retry can never fix: drop to idle with the failure copy instead of a retry loop. */
const PERMANENT_CLAIM_CODES = new Set([
  'mismatch',
  'no_subscription',
  'unknown_family',
  'invalid_request',
]);
let claimFailures = 0;

async function onCheckoutComplete(session: CheckoutSession): Promise<void> {
  pendingSession = session;
  await runClaim();
}

async function runClaim(): Promise<void> {
  const session = pendingSession;
  const id = familyId.value;
  if (!session || !id || claimState.value === 'working') return;
  claimState.value = 'working';
  try {
    let planToken = unstoredToken ?? readPending(id);
    if (!planToken) {
      const answer = await claim({
        familyId: id,
        sessionId: session.sessionId,
        clientSecret: session.clientSecret,
      });
      planToken = answer.planToken ?? null;
      unstoredToken = planToken;
      rememberPending(id, planToken);
    }
    if (planToken) {
      await settingsStore.setPlanToken(planToken);
      unstoredToken = null;
      rememberPending(id, null);
    }
    claimFailures = 0;
    logEvent({
      level: 'info',
      surface: BILLING_UI_SURFACE,
      message: 'plan claimed',
      context: {
        action: 'claim_ok',
        plan: plan.value,
        detail: planToken ? 'token_stored' : 'already_claimed',
      },
    });
    await entitlementStore.refresh({ force: true });
    pendingSession = null;
    claimState.value = 'idle';
    showToast('success', t('plan.claim.done.title'), t('plan.claim.done.message'));
  } catch (err) {
    const code = err instanceof BillingApiError ? err.code : 'unknown';
    const httpStatus = err instanceof BillingApiError ? err.httpStatus : 0;
    const permanent = PERMANENT_CLAIM_CODES.has(code);
    claimFailures += 1;
    // A retry can fix a dropped connection or a throttle; it cannot fix a mismatch. Permanent
    // codes drop straight back to the page (the paste field is reachable there) with the copy.
    claimState.value = permanent ? 'idle' : 'failed';
    if (permanent) {
      pendingSession = null;
      showToast('error', t('plan.claim.permanent.title'), t('plan.claim.permanent.message'));
    }
    // Money was taken and the plan is not applied: this is the one critical billing event.
    console.error(
      `[billing] payment completed but the plan token was not issued or stored for family ${id} (${code}). ` +
        'If the claim keeps failing, run scripts/billing-cohort.mjs --reissue-token <familyId> --apply and paste the token on the Plan page; check the billing Lambda logs for claim_refused.'
    );
    // Critical (Slack) only once a retry has failed too, or for a code no retry can fix: a single
    // dropped connection or 429 between payment and claim is not "money taken, plan lost".
    reportError({
      surface: BILLING_UI_SURFACE,
      message: `[billing] claim failed after a completed checkout (${code})`,
      error: err,
      severity: permanent || claimFailures > 1 ? 'critical' : 'error',
      context: {
        action: 'claim_failed',
        error_code: code,
        http_status: httpStatus,
        plan: plan.value,
      },
    });
  }
}

/** Leave the failed view; the unstored token (if any) stays remembered for the next visit. */
function dismissClaim(): void {
  claimState.value = 'idle';
}

// ── Active ──────────────────────────────────────────────────────────────────
const cohortShort = computed(() =>
  cohort.value === 'pre_v1'
    ? t('plan.cohort.preV1')
    : cohort.value === 'first_ten'
      ? t('plan.cohort.firstTen')
      : null
);

// A token minted on an earlier visit but never stored (the page was left mid-failure) is
// stored the moment the page is back, before any button is needed.
watch(
  familyId,
  (id) => {
    if (!id || claimState.value === 'working') return;
    const pending = readPending(id);
    // A lapsed-then-resubscribed family still holds the OLD token in its doc: having a token is not
    // "the right token", so the pending one is compared to what the doc has.
    if (!pending || pending === settingsStore.settings.planToken) return;
    unstoredToken = pending;
    claimState.value = 'working';
    void settingsStore
      .setPlanToken(pending)
      .then(() => {
        unstoredToken = null;
        rememberPending(id, null);
        claimState.value = 'idle';
        logEvent({
          level: 'info',
          surface: BILLING_UI_SURFACE,
          message: 'pending plan token stored',
          context: { action: 'token_recovered' },
        });
      })
      .catch((err) => {
        claimState.value = 'failed';
        reportError({
          surface: BILLING_UI_SURFACE,
          message: '[billing] a pending plan token could not be stored on return to the Plan page',
          error: err,
          severity: 'error',
          context: { action: 'token_recover_failed' },
        });
      });
  },
  { immediate: true }
);

// A visit to this page is a deliberate "show me my plan": ask the registry now rather than show
// the hourly cache, so a cancel or card change made elsewhere (the portal, another device) is
// what the family sees. Forced (past the 5-minute floor); the GET is cheap and the visit is rare.
onMounted(() => {
  void entitlementStore.refresh({ force: true });
});

const view = computed<'loading' | 'stale' | 'choosing' | 'claiming' | 'active'>(() => {
  if (claimState.value !== 'idle') return 'claiming';
  // No answer yet (a new device before the forced refresh lands): never mount a checkout for a
  // family that may well be paying; wait for the state.
  if (!entitlementStore.state) return 'loading';
  // An unverified cached answer (offline too long): that family may be paying too, so no
  // checkout is offered, exactly as "See plans" hides for it.
  if (entitlementStore.isStale) return 'stale';
  return entitlementStore.state === 'active' ? 'active' : 'choosing';
});

// A family that becomes active while choosing (a webhook landed first, another device paid)
// is moved off the checkout so it cannot pay twice.
watch(
  () => entitlementStore.state,
  (s) => {
    if (s === 'active' && claimState.value === 'idle') pendingSession = null;
  }
);
</script>

<template>
  <!-- No data-testid on this root: the router-view forwards its own `app-content` onto page roots. -->
  <div class="space-y-6">
    <!-- This page is reached from Settings; give the way back, like the Bean Pod pages do. -->
    <button
      type="button"
      class="font-outfit text-primary-500 dark:text-accent-lift inline-flex items-center gap-1 text-sm font-semibold hover:underline"
      data-testid="plan-back"
      @click="router.push('/settings')"
    >
      <BeanieIcon name="chevron-left" size="xs" />
      {{ t('plan.backToSettings') }}
    </button>
    <header
      class="dark:from-surface-overlay dark:to-surface-raised rounded-[var(--sq)] bg-gradient-to-br from-[rgba(174,214,241,0.35)] to-[rgba(241,93,34,0.08)] px-5 py-5 sm:px-8 sm:py-7"
    >
      <div class="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1
            class="font-outfit text-secondary-500 dark:text-ink text-2xl leading-tight font-bold sm:text-3xl"
          >
            {{ t('plan.title') }}
          </h1>
          <p class="text-secondary-400 dark:text-ink-soft mt-1 text-sm" data-testid="plan-subtitle">
            {{ subtitle }}
          </p>
        </div>
        <div
          v-if="view === 'choosing'"
          role="group"
          :aria-label="t('plan.currency.label')"
          class="flex gap-2"
        >
          <button
            v-for="c in CURRENCIES"
            :key="c"
            type="button"
            :aria-pressed="currency === c"
            :data-testid="`plan-currency-${c}`"
            class="rounded-full border px-3 py-1 text-xs font-semibold transition-colors"
            :class="
              currency === c
                ? 'border-primary-500 text-primary-500 dark:text-accent-lift dark:bg-surface-overlay bg-[var(--tint-orange-8)]'
                : 'text-secondary-400 dark:text-ink-soft dark:border-line-strong border-secondary-200'
            "
            @click="currency = c"
          >
            {{ PRICES[c].label }}
          </button>
        </div>
      </div>
    </header>

    <!-- ── Active ─────────────────────────────────────────────────────────── -->
    <section
      v-if="view === 'active'"
      data-testid="plan-active"
      class="dark:bg-surface-raised rounded-[var(--sq)] bg-white p-5 shadow-[var(--card-shadow)]"
    >
      <div class="flex items-center justify-between gap-3">
        <h2 class="font-outfit text-secondary-500 dark:text-ink text-lg font-semibold">
          {{ planSummary.name.value ?? t('plan.title') }}
        </h2>
        <span
          data-testid="plan-active-pill"
          class="dark:bg-surface-overlay rounded-full px-2.5 py-1 text-xs font-semibold"
          :class="
            planSummary.pill.value.tone === 'success'
              ? 'dark:text-success-lift bg-[var(--tint-success-10)] text-[#1e8449]'
              : 'text-primary-500 dark:text-accent-lift bg-[var(--tint-orange-8)]'
          "
        >
          {{ t(planSummary.pill.value.key) }}
        </span>
      </div>
      <p
        v-if="planSummary.body.value"
        data-testid="plan-active-body"
        class="text-secondary-400 dark:text-ink-soft mt-3 text-sm"
      >
        {{ planSummary.body.value }}
      </p>
      <p v-if="cohortShort" class="text-secondary-400 dark:text-ink-soft mt-2 text-sm">
        {{ cohortShort }}
      </p>
      <AllowanceMeter />

      <PlanPortalActions fine-print />
    </section>

    <!-- ── Claiming ───────────────────────────────────────────────────────── -->
    <section
      v-else-if="view === 'claiming'"
      data-testid="plan-claiming"
      class="dark:bg-surface-raised rounded-[var(--sq)] bg-white p-5 text-center shadow-[var(--card-shadow)]"
    >
      <template v-if="claimState === 'working'">
        <p class="text-secondary-500 dark:text-ink text-sm">{{ t('plan.claim.working') }}</p>
      </template>
      <template v-else>
        <p class="text-secondary-500 dark:text-ink text-sm font-semibold">
          {{ t('plan.claim.failed.title') }}
        </p>
        <p class="text-secondary-400 dark:text-ink-soft mt-2 text-sm">
          {{ t('plan.claim.failed.message') }}
        </p>
        <div class="mt-4 flex flex-wrap justify-center gap-2">
          <BaseButton data-testid="plan-claim-retry" @click="runClaim">{{
            t('plan.claim.retry')
          }}</BaseButton>
          <BaseButton variant="ghost" data-testid="plan-claim-dismiss" @click="dismissClaim">{{
            t('plan.claim.dismiss')
          }}</BaseButton>
        </div>
      </template>
    </section>

    <!-- ── Not yet known / unverified: nothing to buy here ─────────────────── -->
    <p
      v-else-if="view === 'loading' || view === 'stale'"
      data-testid="plan-waiting"
      class="text-secondary-400 dark:text-ink-soft text-sm"
    >
      {{ view === 'loading' ? t('plan.page.loading') : readOnlyParagraphs[0] }}
    </p>

    <!-- ── Choosing ───────────────────────────────────────────────────────── -->
    <template v-else>
      <p
        v-if="cohortLine"
        data-testid="plan-cohort-line"
        class="text-secondary-500 dark:text-ink rounded-2xl bg-[var(--tint-silk-20)] px-4 py-2.5 text-sm dark:bg-[rgb(174_214_241/12%)]"
      >
        <span aria-hidden="true">🌱</span>
        {{ cohortLine.lead }}
        <strong class="dark:text-silk-lift font-semibold text-[#2c6a93]">{{
          cohortLine.bold
        }}</strong>
        {{ cohortLine.tail }}
      </p>

      <div role="radiogroup" :aria-label="t('plan.select.aria')" class="grid gap-4 md:grid-cols-2">
        <PlanChoiceCard
          plan="basic"
          :selected="plan === 'basic'"
          name-key="plan.name.basic"
          for-key="plan.basic.for"
          :price="basicPrice.price"
          :list="basicPrice.list"
          per-key="plan.per.year"
          :bullets="BASIC_BULLETS"
          @choose="choose"
        />
        <PlanChoiceCard
          plan="full"
          :selected="plan === 'full'"
          name-key="plan.name.full"
          for-key="plan.full.for"
          :price="fullPrice.price"
          :list="fullPrice.list"
          :per-key="interval === 'month' ? 'plan.per.month' : 'plan.per.year'"
          :bullets="FULL_BULLETS"
          :vars="{ count: fullPerDay }"
          @choose="choose"
        >
          <div
            role="group"
            :aria-label="t('plan.cycle.label')"
            class="dark:bg-surface-overlay mt-3 inline-flex rounded-xl bg-[var(--tint-slate-5)] p-0.5 text-xs font-semibold"
          >
            <button
              v-for="cycle in INTERVALS"
              :key="cycle"
              type="button"
              :aria-pressed="interval === cycle"
              :data-testid="`plan-cycle-${cycle}`"
              class="rounded-lg px-3 py-1.5 transition-colors"
              :class="
                interval === cycle
                  ? 'text-secondary-500 dark:text-ink dark:bg-surface-raised bg-white shadow-sm'
                  : 'text-secondary-400 dark:text-ink-soft'
              "
              @click.stop="chooseCycle(cycle)"
            >
              {{
                cycle === 'year'
                  ? t('plan.cycle.yearly')
                  : fillTemplate(t('plan.cycle.monthly'), { price: fullMonthly })
              }}
            </button>
          </div>
        </PlanChoiceCard>
      </div>

      <StripeCheckoutFrame
        v-if="familyId"
        :family-id="familyId"
        :plan="plan"
        :interval="interval"
        :currency="currency === 'SGD' ? 'sgd' : 'usd'"
        @complete="onCheckoutComplete"
      />
    </template>
  </div>
</template>
