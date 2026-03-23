<script setup lang="ts">
import { computed } from 'vue';
import ToggleSwitch from './ToggleSwitch.vue';
import ConditionalSection from './ConditionalSection.vue';
import EntityLinkDropdown from './EntityLinkDropdown.vue';
import InfoHintBadge from './InfoHintBadge.vue';
import { useAccountsStore } from '@/stores/accountsStore';
import { useTranslation } from '@/composables/useTranslation';
import { formatCurrencyWithCode } from '@/composables/useCurrencyDisplay';
import { formatMonthYearShort } from '@/utils/date';
import type { CurrencyCode } from '@/types/models';

const props = withDefaults(
  defineProps<{
    modelValue: boolean;
    payFromAccountId: string;
    paymentAmount: number;
    currency: string;
    startDate?: string;
    frequency?: 'monthly' | 'yearly';
  }>(),
  { frequency: 'monthly' }
);

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  'update:payFromAccountId': [value: string];
}>();

const { t } = useTranslation();
const accountsStore = useAccountsStore();

// Filter to active, non-loan, non-credit-card accounts matching the entity's currency
const payableAccounts = computed(() =>
  accountsStore.activeAccounts
    .filter((a) => a.type !== 'loan' && a.type !== 'credit_card' && a.currency === props.currency)
    .map((a) => ({
      id: a.id,
      icon: a.icon || '🏦',
      label: a.name,
    }))
);

const selectedAccountName = computed(() => {
  if (!props.payFromAccountId) return '';
  const acct = accountsStore.accounts.find((a) => a.id === props.payFromAccountId);
  return acct?.name ?? '';
});

const summaryText = computed(() => {
  if (!props.payFromAccountId || !selectedAccountName.value) return '';
  const amt = formatCurrencyWithCode(props.paymentAmount, props.currency as CurrencyCode);
  const freqSuffix = props.frequency === 'yearly' ? '/yr' : '/mo';
  const dateStr = props.startDate
    ? formatMonthYearShort(new Date(props.startDate + 'T00:00:00'))
    : '';
  return `${amt}${freqSuffix} from ${selectedAccountName.value}${dateStr ? ` starting ${dateStr}` : ''}`;
});
</script>

<template>
  <div class="space-y-3">
    <div
      class="flex cursor-pointer items-center justify-between"
      @click="emit('update:modelValue', !modelValue)"
    >
      <div class="flex items-center gap-1.5">
        <span class="font-outfit text-sm font-semibold text-[var(--color-text)]">
          {{ t('recurringPrompt.createPayment') }}
        </span>
        <InfoHintBadge :text="t('recurringPrompt.createPaymentHint')" />
      </div>
      <ToggleSwitch
        :model-value="modelValue"
        @click.stop
        @update:model-value="emit('update:modelValue', $event)"
      />
    </div>

    <ConditionalSection :show="modelValue">
      <div class="space-y-3">
        <div
          class="font-outfit text-xs font-semibold tracking-[0.1em] text-[var(--color-text)] uppercase opacity-35"
        >
          {{ t('recurringPrompt.payFrom') }}
        </div>
        <EntityLinkDropdown
          :model-value="payFromAccountId"
          :items="payableAccounts"
          :placeholder="t('recurringPrompt.payFrom')"
          empty-text="No matching accounts"
          default-icon="🏦"
          @update:model-value="emit('update:payFromAccountId', $event ?? '')"
        />
        <p v-if="summaryText" class="text-xs font-medium text-[var(--color-text-muted)]">
          {{ summaryText }}
        </p>
      </div>
    </ConditionalSection>
  </div>
</template>
