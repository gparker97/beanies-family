/**
 * The ACTIVE plan in words (#95): one source for the Settings card and the Plan page, so the
 * two can never describe a cancelled or past-due plan differently.
 *
 *   renewing   "magic beans" · Active · "Renews 1 Oct 2027."        CTA Manage Plan
 *   ending     "magic beans" · Ending · "Cancelled. Everything stays included until
 *              1 Oct 2027, then beanies.family goes read-only."               CTA Restart Plan
 *   pastDue    "magic beans" · Payment Issue · "Your last payment didn't go through…"
 *                                                                              CTA Update Card
 *
 * Every CTA opens the Stripe Customer Portal (`usePlanPortal`), which is where a cancelled plan
 * is renewed and a card is updated; the label says what the family will do there. The portal
 * CTA is web-only; native shows the words and nothing else.
 */
import { computed } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { useEntitlementStore } from '@/stores/entitlementStore';
import { formatDate } from '@/utils/date';
import { fillTemplate } from '@/utils/fillTemplate';
import type { UIStringKey } from '@/services/translation/uiStrings';

export type PlanPhase = 'renewing' | 'ending' | 'pastDue';

export function usePlanSummary() {
  const { t } = useTranslation();
  const entitlementStore = useEntitlementStore();

  const phase = computed<PlanPhase>(() => {
    if (entitlementStore.pastDue) return 'pastDue';
    if (entitlementStore.cancelAt) return 'ending';
    return 'renewing';
  });

  const name = computed<string | null>(() =>
    entitlementStore.plan === 'full'
      ? t('plan.name.full')
      : entitlementStore.plan === 'basic'
        ? t('plan.name.basic')
        : null
  );

  const pill = computed<{ key: UIStringKey; tone: 'accent' | 'success' }>(() => {
    switch (phase.value) {
      case 'pastDue':
        return { key: 'plan.pill.paymentIssue', tone: 'accent' };
      case 'ending':
        return { key: 'plan.pill.ending', tone: 'accent' };
      default:
        return { key: 'plan.pill.active', tone: 'success' };
    }
  });

  /** The one sentence under the name. */
  const body = computed<string | null>(() => {
    switch (phase.value) {
      case 'pastDue':
        return t('plan.active.pastDue');
      case 'ending':
        return fillTemplate(t('plan.active.ends'), {
          date: formatDate(entitlementStore.cancelAt!),
        });
      default:
        return entitlementStore.currentPeriodEnd
          ? fillTemplate(t('plan.active.renews'), {
              date: formatDate(entitlementStore.currentPeriodEnd),
            })
          : null;
    }
  });

  /** What the primary portal button says. */
  const ctaKey = computed<UIStringKey>(() => {
    switch (phase.value) {
      case 'pastDue':
        return 'plan.active.updateCard';
      case 'ending':
        return 'plan.active.restart';
      default:
        return 'plan.active.manage';
    }
  });

  return { phase, name, pill, body, ctaKey };
}
