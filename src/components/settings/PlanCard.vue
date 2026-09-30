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
 * WEB: "See plans" in beta, trial and read-only, except a STALE read-only (`showSeePlans`).
 * The plan page arrives in Phase 5 under the route name below, so until it exists the button is
 * not rendered at all rather than pointing somewhere useless. "Manage plan" / "Receipts" on the active card are Phase 5 as well (they
 * need the billing Lambda's portal session) and are deliberately absent here.
 */
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { TRIAL_DAYS } from '@beanies/brand/pricing';
import BaseCard from '@/components/ui/BaseCard.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import { useTranslation } from '@/composables/useTranslation';
import { useEntitlementStore } from '@/stores/entitlementStore';
import { isNative } from '@/services/sync/capabilities';
import { formatDate } from '@/utils/date';
import { fillTemplate } from '@/utils/fillTemplate';
import { OFFLINE_GRACE_DAYS } from '@/constants/entitlement';
import type { UIStringKey } from '@/services/translation/uiStrings';

/** Phase 5 registers `/settings/plan` under this route name; keep the two in step. */
const PLAN_ROUTE_NAME = 'Plan';

const router = useRouter();
const { t } = useTranslation();
const entitlementStore = useEntitlementStore();

// Neither can change while the card is mounted: the platform is fixed, and routes are
// registered at startup.
const native = isNative();
const canSeePlans = !native && router.hasRoute(PLAN_ROUTE_NAME);

type PillTone = 'accent' | 'success';

const pill = computed<{ key: UIStringKey; tone: PillTone } | null>(() => {
  switch (entitlementStore.state) {
    case 'beta':
      return { key: 'plan.pill.beta', tone: 'accent' };
    case 'trial':
      return { key: 'plan.pill.trial', tone: 'accent' };
    case 'active':
      return { key: 'plan.pill.active', tone: 'success' };
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
    const name =
      entitlementStore.plan === 'full'
        ? t('plan.name.full')
        : entitlementStore.plan === 'basic'
          ? t('plan.name.basic')
          : null;
    const renews = entitlementStore.currentPeriodEnd
      ? fillTemplate(t('plan.active.renews'), {
          date: formatDate(entitlementStore.currentPeriodEnd),
        })
      : null;
    if (cohortLine.value) extra.push(cohortLine.value);
    return { lead: name, body: renews, extra };
  }

  if (s === 'read_only') {
    if (entitlementStore.isStale) {
      return {
        lead: null,
        body: fillTemplate(t('readOnly.stale'), { days: OFFLINE_GRACE_DAYS }),
        extra,
      };
    }
    const lapsed = entitlementStore.reason === 'lapsed';
    let body: string;
    if (lapsed) body = t('readOnly.lapsed');
    else body = native ? t('readOnly.native.trialEnded') : t('readOnly.web.trialEnded');
    if (native) extra.push(t('readOnly.native.plansElsewhere'));
    return { lead: null, body, extra };
  }

  return { lead: null, body: t('plan.unknown'), extra };
});

// Never while stale: that family may well be paying and only offline, so offering checkout
// would invite a second subscription. Reconnecting is the fix, and the copy says so.
const showSeePlans = computed(
  () =>
    canSeePlans &&
    !entitlementStore.isStale &&
    ['beta', 'trial', 'read_only'].includes(entitlementStore.state ?? '')
);

function seePlans(): void {
  void router.push({ name: PLAN_ROUTE_NAME });
}
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

    <BaseButton v-if="showSeePlans" class="mt-4" data-testid="plan-see-plans" @click="seePlans">
      {{ t('plan.action.seePlans') }}
    </BaseButton>
  </BaseCard>
</template>
