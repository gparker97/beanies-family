<script setup lang="ts">
import { ref, computed } from 'vue';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import AmountInput from '@/components/ui/AmountInput.vue';
import FamilyChipPicker from '@/components/ui/FamilyChipPicker.vue';
import FormFieldGroup from '@/components/ui/FormFieldGroup.vue';
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue';
import { BaseCombobox } from '@/components/ui';
import AccountCategoryPicker from '@/components/accounts/AccountCategoryPicker.vue';
import { useFamilyStore } from '@/stores/familyStore';
import { useAccountsStore } from '@/stores/accountsStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useTranslation } from '@/composables/useTranslation';
import { useFormModal } from '@/composables/useFormModal';
import { useCurrencyOptions } from '@/composables/useCurrencyOptions';
import { useInstitutionOptions } from '@/composables/useInstitutionOptions';
import { COUNTRIES } from '@/constants/countries';
import { INSTITUTIONS, OTHER_INSTITUTION_VALUE } from '@/constants/institutions';
import { getSubtypeEmoji } from '@/constants/accountCategories';
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
const accountsStore = useAccountsStore();
const settingsStore = useSettingsStore();
const { currencyOptions } = useCurrencyOptions();
const { options: institutionOptions, removeCustomInstitution } = useInstitutionOptions();
const countryOptions = COUNTRIES.map((c) => ({ value: c.code, label: c.name }));

// Form state
const name = ref('');
const type = ref<AccountType | ''>('');
const balance = ref<number | undefined>(0);
const currency = ref('');
const memberId = ref('');
const institution = ref('');
const institutionCountry = ref('');
const isActive = ref(true);
const includeInNetWorth = ref(true);
const showMoreDetails = ref(false);

// MRU: find most recent institution/country from existing accounts
function getMruDefaults() {
  const latest = accountsStore.accounts
    .filter((a) => a.institution)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  return {
    institution: latest?.institution ?? '',
    institutionCountry: latest?.institutionCountry ?? '',
  };
}

// Reset form when modal opens
const { isEditing, isSubmitting } = useFormModal(
  () => props.account,
  () => props.open,
  {
    onEdit: (account) => {
      name.value = account.name;
      type.value = account.type;
      balance.value = account.balance;
      currency.value = account.currency;
      memberId.value = account.memberId;
      institution.value = account.institution ?? '';
      institutionCountry.value = account.institutionCountry ?? '';
      isActive.value = account.isActive;
      includeInNetWorth.value = account.includeInNetWorth;
      // Auto-expand "More Details" if toggles differ from defaults
      showMoreDetails.value = !account.includeInNetWorth || !account.isActive;
    },
    onNew: () => {
      const mru = getMruDefaults();
      name.value = '';
      type.value = props.defaults?.type ?? '';
      balance.value = 0;
      currency.value = settingsStore.displayCurrency;
      memberId.value = props.defaults?.memberId ?? familyStore.currentMemberId ?? '';
      institution.value = mru.institution;
      institutionCountry.value = mru.institutionCountry;
      isActive.value = true;
      includeInNetWorth.value = true;
      showMoreDetails.value = false;
    },
  }
);

const canSave = computed(() => name.value.trim().length > 0 && type.value !== '');

const modalTitle = computed(() =>
  isEditing.value ? t('accounts.editAccount') : t('accounts.addAccount')
);

const saveLabel = computed(() =>
  isEditing.value ? t('modal.saveAccount') : t('modal.addAccount')
);

const modalIcon = computed(() => (type.value ? getSubtypeEmoji(type.value as AccountType) : '🏦'));

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
      icon: getSubtypeEmoji(type.value as AccountType) || undefined,
      name: name.value.trim(),
      type: type.value as AccountType,
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
    :icon="modalIcon"
    icon-bg="var(--tint-silk-20)"
    :save-label="saveLabel"
    :save-disabled="!canSave"
    :is-submitting="isSubmitting"
    :show-delete="isEditing"
    @close="emit('close')"
    @save="handleSave"
    @delete="handleDelete"
  >
    <!-- 1. Account Owner -->
    <FormFieldGroup :label="t('modal.accountOwner')">
      <FamilyChipPicker v-model="memberId" mode="single" />
    </FormFieldGroup>

    <!-- 2. Institution + Country -->
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

    <!-- 3. Account Name (styled like TransactionModal description) -->
    <FormFieldGroup :label="t('modal.accountName')" required>
      <div
        class="focus-within:border-primary-500 rounded-[16px] border-2 border-transparent bg-[var(--tint-slate-5)] px-4 py-3 transition-all duration-200 focus-within:shadow-[0_0_0_3px_rgba(241,93,34,0.1)] dark:bg-slate-700"
      >
        <input
          v-model="name"
          type="text"
          class="font-outfit w-full border-none bg-transparent text-base font-semibold text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-muted)] placeholder:opacity-30 dark:text-gray-100"
          :placeholder="t('modal.accountName')"
        />
      </div>
    </FormFieldGroup>

    <!-- 4. Category / Type (two-level picker) -->
    <FormFieldGroup :label="t('modal.selectCategory')">
      <AccountCategoryPicker v-model="type" />
    </FormFieldGroup>

    <!-- 5. Currency + Balance (side by side, styled like TransactionModal) -->
    <FormFieldGroup :label="t('modal.balance')">
      <div class="flex items-stretch gap-2">
        <div class="relative flex-shrink-0">
          <select
            v-model="currency"
            class="focus:border-primary-500 font-outfit h-full w-[82px] cursor-pointer appearance-none rounded-[16px] border-2 border-transparent bg-[var(--tint-slate-5)] px-3 pr-7 text-center text-sm font-bold text-[var(--color-text)] transition-all duration-200 focus:shadow-[0_0_0_3px_rgba(241,93,34,0.1)] focus:outline-none dark:bg-slate-700 dark:text-gray-100"
          >
            <option v-for="opt in currencyOptions" :key="opt.value" :value="opt.value">
              {{ opt.value }}
            </option>
          </select>
          <div class="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2">
            <svg
              class="h-3 w-3 text-[var(--color-text)] opacity-35"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </div>
        </div>
        <div class="min-w-0 flex-1">
          <AmountInput
            v-model="balance"
            :currency-symbol="currency || settingsStore.displayCurrency"
            font-size="1.8rem"
          />
        </div>
      </div>
    </FormFieldGroup>

    <!-- 6. "More Details..." collapsible -->
    <div>
      <button
        type="button"
        class="font-outfit text-primary-500 text-sm font-semibold transition-colors hover:underline"
        @click="showMoreDetails = !showMoreDetails"
      >
        {{ t('modal.moreDetails') }}
        <span
          class="ml-1 inline-block transition-transform"
          :class="{ 'rotate-180': showMoreDetails }"
          >&#9662;</span
        >
      </button>

      <div v-if="showMoreDetails" class="mt-3 space-y-3">
        <!-- Include in Net Worth toggle -->
        <div
          class="flex items-center justify-between rounded-[14px] bg-[var(--tint-slate-5)] px-4 py-3 dark:bg-slate-700"
        >
          <div>
            <div
              class="font-outfit text-sm font-semibold text-[var(--color-text)] dark:text-gray-200"
            >
              {{ t('modal.includeInNetWorth') }}
            </div>
            <div class="text-xs text-[var(--color-text-muted)]">
              {{ t('modal.includeInNetWorthDesc') }}
            </div>
          </div>
          <ToggleSwitch v-model="includeInNetWorth" />
        </div>

        <!-- Active toggle -->
        <div
          class="flex items-center justify-between rounded-[14px] bg-[var(--tint-slate-5)] px-4 py-3 dark:bg-slate-700"
        >
          <span
            class="font-outfit text-sm font-semibold text-[var(--color-text)] dark:text-gray-200"
          >
            {{ t('form.isActive') }}
          </span>
          <ToggleSwitch v-model="isActive" />
        </div>
      </div>
    </div>
  </BeanieFormModal>
</template>
