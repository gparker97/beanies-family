<script setup lang="ts">
import { ref, computed } from 'vue';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import FrequencyChips from '@/components/ui/FrequencyChips.vue';
import AmountInput from '@/components/ui/AmountInput.vue';
import FamilyChipPicker from '@/components/ui/FamilyChipPicker.vue';
import FormFieldGroup from '@/components/ui/FormFieldGroup.vue';
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue';
import BaseSelect from '@/components/ui/BaseSelect.vue';
import { BaseCombobox } from '@/components/ui';
import { useFamilyStore } from '@/stores/familyStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useTranslation } from '@/composables/useTranslation';
import { useFormModal } from '@/composables/useFormModal';
import { useCurrencyOptions } from '@/composables/useCurrencyOptions';
import { useInstitutionOptions } from '@/composables/useInstitutionOptions';
import { COUNTRIES } from '@/constants/countries';
import { INSTITUTIONS, OTHER_INSTITUTION_VALUE } from '@/constants/institutions';
import type { Account, AccountType, CreateAccountInput, UpdateAccountInput } from '@/types/models';

const props = defineProps<{
  open: boolean;
  account?: Account | null;
  defaults?: { memberId?: string; type?: AccountType };
}>();

const emit = defineEmits<{
  close: [];
  save: [data: CreateAccountInput | { id: string; data: UpdateAccountInput }];
  delete: [id: string];
}>();

const { t } = useTranslation();
const familyStore = useFamilyStore();
const settingsStore = useSettingsStore();
const { currencyOptions } = useCurrencyOptions();
const { options: institutionOptions, removeCustomInstitution } = useInstitutionOptions();
const countryOptions = COUNTRIES.map((c) => ({ value: c.code, label: c.name }));

// Icon chip options for account types
const ACCOUNT_ICON_OPTIONS = [
  { value: '🏦', label: 'Bank', icon: '🏦' },
  { value: '🐷', label: 'Savings', icon: '🐷' },
  { value: '💳', label: 'Credit Card', icon: '💳' },
  { value: '📈', label: 'Investment', icon: '📈' },
  { value: '💵', label: 'Cash', icon: '💵' },
  { value: '🏠', label: 'Property', icon: '🏠' },
  { value: '🎓', label: 'Education', icon: '🎓' },
  { value: '🔒', label: 'Locked', icon: '🔒' },
  { value: '📦', label: 'Other', icon: '📦' },
];

// Account type chips
const accountTypeOptions = computed(() => [
  { value: 'checking', label: '🏦 ' + t('accounts.type.checking') },
  { value: 'savings', label: '🐷 ' + t('accounts.type.savings') },
  { value: 'investment', label: '📈 ' + t('accounts.type.investment') },
  { value: 'credit_card', label: '💳 ' + t('accounts.type.credit_card') },
  { value: 'cash', label: '💵 ' + t('accounts.type.cash') },
]);

// Form state
const icon = ref('');
const name = ref('');
const type = ref<AccountType>('checking');
const balance = ref<number | undefined>(0);
const currency = ref('');
const memberId = ref('');
const institution = ref('');
const institutionCountry = ref('');
const isActive = ref(true);
const includeInNetWorth = ref(true);

// Reset form when modal opens
const { isEditing, isSubmitting } = useFormModal(
  () => props.account,
  () => props.open,
  {
    onEdit: (account) => {
      icon.value = account.icon ?? '';
      name.value = account.name;
      type.value = account.type;
      balance.value = account.balance;
      currency.value = account.currency;
      memberId.value = account.memberId;
      institution.value = account.institution ?? '';
      institutionCountry.value = account.institutionCountry ?? '';
      isActive.value = account.isActive;
      includeInNetWorth.value = account.includeInNetWorth;
    },
    onNew: () => {
      icon.value = '';
      name.value = '';
      type.value = props.defaults?.type ?? 'checking';
      balance.value = 0;
      currency.value = settingsStore.displayCurrency;
      memberId.value = props.defaults?.memberId ?? familyStore.currentMemberId ?? '';
      institution.value = '';
      institutionCountry.value = '';
      isActive.value = true;
      includeInNetWorth.value = true;
    },
  }
);

const canSave = computed(() => name.value.trim().length > 0);

const modalTitle = computed(() =>
  isEditing.value ? t('accounts.editAccount') : t('accounts.addAccount')
);

const saveLabel = computed(() =>
  isEditing.value ? t('modal.saveAccount') : t('modal.addAccount')
);

async function handleRemoveCustomInstitution(instName: string) {
  await removeCustomInstitution(instName);
}

async function persistCustomInstitutionIfNeeded(instName: string | undefined) {
  if (!instName?.trim()) return;
  const isKnown =
    INSTITUTIONS.some((i) => i.name === instName) ||
    settingsStore.customInstitutions.includes(instName);
  if (!isKnown) {
    await settingsStore.addCustomInstitution(instName.trim());
  }
}

async function handleSave() {
  if (!canSave.value) return;
  isSubmitting.value = true;
  try {
    const data = {
      icon: icon.value || undefined,
      name: name.value.trim(),
      type: type.value,
      balance: balance.value ?? 0,
      currency: currency.value,
      memberId: memberId.value,
      institution: institution.value || undefined,
      institutionCountry: institutionCountry.value || undefined,
      isActive: isActive.value,
      includeInNetWorth: includeInNetWorth.value,
    };

    await persistCustomInstitutionIfNeeded(institution.value);

    if (isEditing.value && props.account) {
      emit('save', { id: props.account.id, data: data as UpdateAccountInput });
    } else {
      emit('save', data as CreateAccountInput);
    }
  } finally {
    isSubmitting.value = false;
  }
}

function handleDelete() {
  if (props.account) {
    emit('delete', props.account.id);
  }
}
</script>

<template>
  <BeanieFormModal
    :open="open"
    :title="modalTitle"
    :icon="icon || '🏦'"
    icon-bg="var(--tint-silk-20)"
    :save-label="saveLabel"
    :save-disabled="!canSave"
    :is-submitting="isSubmitting"
    :show-delete="isEditing"
    @close="emit('close')"
    @save="handleSave"
    @delete="handleDelete"
  >
    <!-- 1. Icon Picker -->
    <FormFieldGroup :label="t('modal.selectCategory')">
      <FrequencyChips v-model="icon" :options="ACCOUNT_ICON_OPTIONS" />
    </FormFieldGroup>

    <!-- 2. Account name -->
    <div>
      <input
        v-model="name"
        type="text"
        class="font-outfit w-full border-none bg-transparent text-lg font-bold text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-muted)] placeholder:opacity-30 dark:text-gray-100"
        :placeholder="t('modal.accountName')"
      />
    </div>

    <!-- 3. Account type chips -->
    <FormFieldGroup :label="t('modal.accountType')">
      <FrequencyChips v-model="type" :options="accountTypeOptions" />
    </FormFieldGroup>

    <!-- 4. Balance (hero) -->
    <AmountInput
      v-model="balance"
      :currency-symbol="currency || settingsStore.displayCurrency"
      font-size="1.6rem"
      :label="t('modal.balance')"
    />

    <!-- 5. Institution + Country -->
    <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
      <BaseCombobox
        v-model="institution"
        :options="institutionOptions"
        :label="t('form.institution')"
        :placeholder="t('form.searchInstitutions')"
        :search-placeholder="t('form.searchInstitutions')"
        :other-value="OTHER_INSTITUTION_VALUE"
        :other-label="t('form.other')"
        :other-placeholder="t('form.enterCustomName')"
        @custom-removed="handleRemoveCustomInstitution"
      />
      <BaseCombobox
        v-model="institutionCountry"
        :options="countryOptions"
        :label="t('form.country')"
        :placeholder="t('form.searchCountries')"
        :search-placeholder="t('form.searchCountries')"
      />
    </div>

    <!-- 6. Currency -->
    <FormFieldGroup :label="t('form.currency')">
      <BaseSelect v-model="currency" :options="currencyOptions" />
    </FormFieldGroup>

    <!-- 7. Owner -->
    <FormFieldGroup :label="t('modal.owner')">
      <FamilyChipPicker v-model="memberId" mode="single" show-shared />
    </FormFieldGroup>

    <!-- 8. Include in net worth toggle -->
    <div
      class="flex items-center justify-between rounded-[14px] bg-[var(--tint-slate-5)] px-4 py-3 dark:bg-slate-700"
    >
      <div>
        <div class="font-outfit text-sm font-semibold text-[var(--color-text)] dark:text-gray-200">
          {{ t('modal.includeInNetWorth') }}
        </div>
        <div class="text-xs text-[var(--color-text-muted)]">
          {{ t('modal.includeInNetWorthDesc') }}
        </div>
      </div>
      <ToggleSwitch v-model="includeInNetWorth" />
    </div>

    <!-- 9. Active toggle -->
    <div
      class="flex items-center justify-between rounded-[14px] bg-[var(--tint-slate-5)] px-4 py-3 dark:bg-slate-700"
    >
      <span class="font-outfit text-sm font-semibold text-[var(--color-text)] dark:text-gray-200">
        {{ t('form.isActive') }}
      </span>
      <ToggleSwitch v-model="isActive" />
    </div>
  </BeanieFormModal>
</template>
