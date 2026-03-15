<script setup lang="ts">
import { computed } from 'vue';
import EntityLinkDropdown from './EntityLinkDropdown.vue';
import { useAssetsStore } from '@/stores/assetsStore';
import { useAccountsStore } from '@/stores/accountsStore';
import { useTranslation } from '@/composables/useTranslation';
import { formatCurrencyWithCode } from '@/composables/useCurrencyDisplay';
import type { CurrencyCode } from '@/types/models';

defineProps<{
  modelValue?: string;
}>();

defineEmits<{
  'update:modelValue': [value: string | undefined];
}>();

const { t } = useTranslation();
const assetsStore = useAssetsStore();
const accountsStore = useAccountsStore();

const items = computed(() => [
  // Asset loans — loanId = asset.id
  ...assetsStore.assets
    .filter((a) => a.loan?.hasLoan && (a.loan.outstandingBalance ?? 0) > 0)
    .map((a) => ({
      id: a.id,
      icon: '🏠',
      label: a.name,
      secondary: a.loan!.monthlyPayment
        ? formatCurrencyWithCode(a.loan!.monthlyPayment, a.currency as CurrencyCode) + '/mo'
        : undefined,
    })),
  // Standalone loan accounts — exclude auto-linked accounts (linkedAssetId)
  ...accountsStore.accounts
    .filter((a) => a.type === 'loan' && a.isActive && a.balance > 0 && !a.linkedAssetId)
    .map((a) => ({
      id: a.id,
      icon: '🏦',
      label: a.name,
      secondary: a.monthlyPayment
        ? formatCurrencyWithCode(a.monthlyPayment, a.currency as CurrencyCode) + '/mo'
        : undefined,
    })),
]);
</script>

<template>
  <EntityLinkDropdown
    :model-value="modelValue"
    :items="items"
    :placeholder="t('txLink.selectLoan')"
    :empty-text="t('txLink.noLoans')"
    default-icon="🏦"
    @update:model-value="$emit('update:modelValue', $event)"
  />
</template>
