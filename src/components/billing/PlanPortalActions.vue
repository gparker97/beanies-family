<script setup lang="ts">
/**
 * "Manage Plan" / "Receipts" (#95 Phase 5): the one button pair for the two surfaces that offer
 * the Customer Portal (the Settings `PlanCard` and the Plan page's active card). The rule for
 * WHEN they show and what a failure says lives in `usePlanPortal`; this is only the markup, so a
 * label or test id cannot drift between the two.
 */
import BaseButton from '@/components/ui/BaseButton.vue';
import { useTranslation } from '@/composables/useTranslation';
import { usePlanPortal } from '@/composables/usePlanPortal';
import { usePlanSummary } from '@/composables/usePlanSummary';

defineProps<{
  /** Show the one-line explanation of what Manage Plan opens (the Plan page does; the card does not). */
  finePrint?: boolean;
}>();

const { t } = useTranslation();
const { showManage, opening, openPortal } = usePlanPortal();
// Manage Plan / Restart Plan / Update Card: the primary label follows the plan's phase.
const { ctaKey } = usePlanSummary();
</script>

<template>
  <template v-if="showManage">
    <div class="mt-4 flex flex-wrap gap-2">
      <BaseButton
        variant="secondary"
        :loading="opening"
        data-testid="plan-manage"
        @click="openPortal"
      >
        {{ t(ctaKey) }}
      </BaseButton>
      <BaseButton
        variant="ghost"
        :disabled="opening"
        data-testid="plan-receipts"
        @click="openPortal"
      >
        {{ t('plan.active.receipts') }}
      </BaseButton>
      <!-- Extra buttons that belong on the same row (the card's "Plan Details"). -->
      <slot />
    </div>
    <p v-if="finePrint" class="text-secondary-400 dark:text-ink-faint mt-3 text-xs">
      {{ t('plan.active.finePrint') }}
    </p>
  </template>
</template>
