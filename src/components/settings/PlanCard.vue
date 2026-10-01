<script setup lang="ts">
/**
 * The Settings plan card (#95): beta, trial, active or read-only, on every platform.
 *
 * It only READS `entitlementStore`; it never computes a state. Mounted by SettingsPage behind
 * the `pricing` flag.
 *
 * NATIVE (iOS / Android) CARRIES NO ACTION IN ANY STATE. No button, link, URL, price or
 * purchase verb (Apple 3.1.3(f), Google Play payments policy); the read-only copy is greg's
 * final wording. That is why the cohort line (a price statement) is web-only too.
 *
 * WEB: "See plans" in beta, trial and read-only, except a STALE read-only; the rule
 * (`showSeePlans`, including "only once the Phase 5 Plan route exists") lives in `useReadOnlyCopy`,
 * shared with the read-only band. "Manage plan" / "Receipts" on the active card open the Stripe
 * Customer Portal through `usePlanPortal` (Phase 5), shared with the Plan page's active card.
 */
import { computed } from 'vue';
import { TRIAL_DAYS } from '@beanies/brand/pricing';
import BaseCard from '@/components/ui/BaseCard.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import { useTranslation } from '@/composables/useTranslation';
import { useEntitlementStore } from '@/stores/entitlementStore';
import { isNative } from '@/services/sync/capabilities';
import { formatDate } from '@/utils/date';
import { fillTemplate } from '@/utils/fillTemplate';
import { useReadOnlyCopy } from '@/composables/useReadOnlyCopy';
import AllowanceMeter from '@/components/billing/AllowanceMeter.vue';
import { isPlanPageReachable } from '@/services/billing/pricingGate';
import PlanPortalActions from '@/components/billing/PlanPortalActions.vue';
import { usePlanSummary } from '@/composables/usePlanSummary';
import type { UIStringKey } from '@/services/translation/uiStrings';

const { t } = useTranslation();
const entitlementStore = useEntitlementStore();
// Shared with ReadOnlyBanner, so the card and the band can never explain it differently.
const { paragraphs: readOnlyParagraphs, showSeePlans, seePlans } = useReadOnlyCopy();
// Web, active: "Plan Details" opens the Plan page (the cancelled / payment-issue detail, the
// token field, the meter). Same reachability rule as "See plans" and the router guard.
const showDetails = computed(() => entitlementStore.state === 'active' && isPlanPageReachable());
// The active plan in words (renewing / ending / payment issue), shared with the Plan page.
const planSummary = usePlanSummary();

// Fixed for the app's lifetime.
const native = isNative();

type PillTone = 'accent' | 'success';

const pill = computed<{ key: UIStringKey; tone: PillTone } | null>(() => {
  switch (entitlementStore.state) {
    case 'beta':
      return { key: 'plan.pill.beta', tone: 'accent' };
    case 'trial':
      return { key: 'plan.pill.trial', tone: 'accent' };
    case 'active':
      return planSummary.pill.value;
    case 'read_only':
      return { key: 'plan.pill.readOnly', tone: 'accent' };
    default:
      return null;
  }
});

/** The trial meter, only for a dated trial. */
const trialDay = computed(() =>
  entitlementStore.state === 'trial' ? entitlementStore.trialDay : null
);
const meterPct = computed(() =>
  trialDay.value === null ? 0 : Math.round((trialDay.value / TRIAL_DAYS) * 100)
);

const cohortLine = computed<string | null>(() => {
  if (native) return null;
  if (entitlementStore.cohort === 'pre_v1') return t('plan.cohort.preV1');
  if (entitlementStore.cohort === 'first_ten') return t('plan.cohort.firstTen');
  return null;
});

/** The lead in bold (the day count, or the plan name), then the sentence, then extra lines. */
const copy = computed<{ lead: string | null; body: string | null; extra: string[] }>(() => {
  const s = entitlementStore.state;
  const extra: string[] = [];

  if (s === 'trial' && trialDay.value !== null && entitlementStore.trialEndsAt) {
    const date = formatDate(entitlementStore.trialEndsAt);
    const body = native
      ? fillTemplate(t('plan.trial.endsNative'), { date })
      : fillTemplate(t('plan.trial.endsWeb'), { date, day: TRIAL_DAYS + 1 });
    if (cohortLine.value) extra.push(cohortLine.value);
    return {
      lead: fillTemplate(t('plan.trial.day'), { day: trialDay.value, total: TRIAL_DAYS }),
      body,
      extra,
    };
  }

  if (s === 'beta' || s === 'trial') {
    // A trial with no end date cannot happen from the server; read it as beta, not blank.
    if (cohortLine.value) extra.push(cohortLine.value);
    return { lead: null, body: t('plan.beta.body'), extra };
  }

  if (s === 'active') {
    if (cohortLine.value) extra.push(cohortLine.value);
    return { lead: planSummary.name.value, body: planSummary.body.value, extra };
  }

  if (s === 'read_only') {
    const [body = null, ...rest] = readOnlyParagraphs.value;
    return { lead: null, body, extra: rest };
  }

  return { lead: null, body: t('plan.unknown'), extra };
});
</script>

<template>
  <BaseCard data-testid="plan-card">
    <div class="flex items-center justify-between gap-3">
      <h3 class="font-outfit text-secondary-500 dark:text-ink text-lg font-semibold">
        {{ t('plan.title') }}
      </h3>
      <span
        v-if="pill"
        data-testid="plan-pill"
        class="dark:bg-surface-overlay rounded-full px-2.5 py-1 text-xs font-semibold"
        :class="
          pill.tone === 'success'
            ? 'dark:text-success-lift bg-[var(--tint-success-10)] text-[#1e8449]'
            : 'text-primary-500 dark:text-accent-lift bg-[var(--tint-orange-8)]'
        "
      >
        {{ t(pill.key) }}
      </span>
    </div>

    <div
      v-if="trialDay !== null"
      data-testid="plan-meter"
      role="progressbar"
      :aria-label="t('plan.trial.meterLabel')"
      :aria-valuenow="trialDay"
      aria-valuemin="1"
      :aria-valuemax="TRIAL_DAYS"
      class="dark:bg-surface-overlay mt-3 h-2 overflow-hidden rounded-full bg-[var(--tint-slate-5)]"
    >
      <!-- Decorative fill: the orange to terracotta gradient reads the same on dark. -->
      <span
        class="block h-full rounded-full bg-gradient-to-r from-[#F15D22] to-[#E67E22] transition-all"
        :style="{ width: `${meterPct}%` }"
      />
    </div>

    <p class="text-secondary-400 dark:text-ink-soft mt-3 text-sm leading-relaxed">
      <strong
        v-if="copy.lead"
        data-testid="plan-lead"
        class="text-secondary-500 dark:text-ink font-medium"
      >
        {{ copy.lead }}
      </strong>
      {{ copy.body }}
    </p>
    <p
      v-for="line in copy.extra"
      :key="line"
      class="text-secondary-400 dark:text-ink-soft mt-2 text-sm leading-relaxed"
    >
      {{ line }}
    </p>
    <AllowanceMeter />

    <BaseButton v-if="showSeePlans" class="mt-4" data-testid="plan-see-plans" @click="seePlans">
      {{ t('plan.action.seePlans') }}
    </BaseButton>
    <!-- "Manage Plan" / "Receipts" (#95 Phase 5): shared with the Plan page. -->
    <PlanPortalActions>
      <BaseButton v-if="showDetails" variant="ghost" data-testid="plan-details" @click="seePlans">
        {{ t('plan.action.details') }}
      </BaseButton>
    </PlanPortalActions>
  </BaseCard>
</template>
