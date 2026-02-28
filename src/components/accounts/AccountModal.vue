<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import EmojiPicker from '@/components/ui/EmojiPicker.vue';
import FrequencyChips from '@/components/ui/FrequencyChips.vue';
import AmountInput from '@/components/ui/AmountInput.vue';
import FamilyChipPicker from '@/components/ui/FamilyChipPicker.vue';
import FormFieldGroup from '@/components/ui/FormFieldGroup.vue';
import ConditionalSection from '@/components/ui/ConditionalSection.vue';
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue';
import BaseSelect from '@/components/ui/BaseSelect.vue';
import { BaseCombobox } from '@/components/ui';
import { useFamilyStore } from '@/stores/familyStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useTranslation } from '@/composables/useTranslation';
import { useCurrencyOptions } from '@/composables/useCurrencyOptions';
import { useInstitutionOptions } from '@/composables/useInstitutionOptions';
import { COUNTRIES } from '@/constants/countries';
import { INSTITUTIONS, OTHER_INSTITUTION_VALUE } from '@/constants/institutions';
import type { Account, AccountType, CreateAccountInput, UpdateAccountInput } from '@/types/models';

const props = defineProps<{
  open: boolean;
  account?: Account | null;
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

const isEditing = computed(() => !!props.account);
const showMoreDetails = ref(false);
const isSubmitting = ref(false);

// Emoji options for account types
const ACCOUNT_EMOJIS = [
  { emoji: '🏦', label: 'Bank' },
  { emoji: '🐷', label: 'Savings' },
  { emoji: '💳', label: 'Credit Card' },
  { emoji: '📈', label: 'Investment' },
  { emoji: '💵', label: 'Cash' },
  { emoji: '🏠', label: 'Property' },
  { emoji: '🎓', label: 'Education' },
  { emoji: '🔒', label: 'Locked' },
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
watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return;
    if (props.account) {
      const a = props.account;
      icon.value = a.icon ?? '';
      name.value = a.name;
      type.value = a.type;
      balance.value = a.balance;
      currency.value = a.currency;
      memberId.value = a.memberId;
      institution.value = a.institution ?? '';
      institutionCountry.value = a.institutionCountry ?? '';
      isActive.value = a.isActive;
      includeInNetWorth.value = a.includeInNetWorth;
      showMoreDetails.value = !!(a.institution || a.institutionCountry);
    } else {
      icon.value = '';
      name.value = '';
      type.value = 'checking';
      balance.value = 0;
      currency.value = settingsStore.displayCurrency;
      memberId.value = familyStore.currentMemberId || '';
      institution.value = '';
      institutionCountry.value = '';
      isActive.value = true;
      includeInNetWorth.value = true;
      showMoreDetails.value = false;
    }
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
    <!-- 1. Emoji Picker -->
    <FormFieldGroup :label="t('modal.pickIcon')">
      <EmojiPicker v-model="icon" :options="ACCOUNT_EMOJIS" />
    </FormFieldGroup>

    <!-- 2. Account name -->
    <div>
      <input
        v-model="name"
        type="text"
        class="font-outfit w-full border-none bg-transparent text-[1.1rem] font-bold text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-muted)] placeholder:opacity-30 dark:text-gray-100"
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

    <!-- 5. Currency -->
    <FormFieldGroup :label="t('form.currency')">
      <BaseSelect v-model="currency" :options="currencyOptions" />
    </FormFieldGroup>

    <!-- 6. Owner -->
    <FormFieldGroup :label="t('modal.owner')">
      <FamilyChipPicker v-model="memberId" mode="single" show-shared />
    </FormFieldGroup>

    <!-- 7. Include in net worth toggle -->
    <div
      class="flex items-center justify-between rounded-[14px] bg-[var(--tint-slate-5)] px-4 py-3 dark:bg-slate-700"
    >
      <div>
        <div
          class="font-outfit text-[0.8rem] font-semibold text-[var(--color-text)] dark:text-gray-200"
        >
          {{ t('modal.includeInNetWorth') }}
        </div>
        <div class="text-[0.65rem] text-[var(--color-text-muted)]">
          {{ t('modal.includeInNetWorthDesc') }}
        </div>
      </div>
      <ToggleSwitch v-model="includeInNetWorth" />
    </div>

    <!-- More details toggle -->
    <button
      type="button"
      class="font-outfit text-primary-500 hover:text-terracotta-400 flex w-full cursor-pointer items-center gap-2 rounded-xl py-2 text-sm font-semibold transition-colors"
      @click="showMoreDetails = !showMoreDetails"
    >
      <svg
        class="h-4 w-4 transition-transform"
        :class="{ 'rotate-180': showMoreDetails }"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        stroke-width="2"
      >
        <path d="M19 9l-7 7-7-7" />
      </svg>
      {{ t('modal.moreDetails') }}
    </button>

    <ConditionalSection :show="showMoreDetails">
      <div class="space-y-4">
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

        <!-- Active toggle -->
        <div
          class="flex items-center justify-between rounded-[14px] bg-[var(--tint-slate-5)] px-4 py-3 dark:bg-slate-700"
        >
          <div
            class="font-outfit text-[0.8rem] font-semibold text-[var(--color-text)] dark:text-gray-200"
          >
            {{ t('form.isActive') }}
          </div>
          <ToggleSwitch v-model="isActive" />
        </div>
      </div>
    </ConditionalSection>
  </BeanieFormModal>
</template>
