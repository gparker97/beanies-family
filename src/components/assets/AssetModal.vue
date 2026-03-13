<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import AmountInput from '@/components/ui/AmountInput.vue';
import CurrencyAmountInput from '@/components/ui/CurrencyAmountInput.vue';
import FamilyChipPicker from '@/components/ui/FamilyChipPicker.vue';
import FrequencyChips from '@/components/ui/FrequencyChips.vue';
import FormFieldGroup from '@/components/ui/FormFieldGroup.vue';
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import { BaseCombobox } from '@/components/ui';
import { useFamilyStore } from '@/stores/familyStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useTranslation } from '@/composables/useTranslation';
import { useFormModal } from '@/composables/useFormModal';
import {
  useInstitutionOptions,
  persistCustomInstitutionIfNeeded,
} from '@/composables/useInstitutionOptions';
import { COUNTRIES } from '@/constants/countries';
import { OTHER_INSTITUTION_VALUE } from '@/constants/institutions';
import type {
  Asset,
  AssetType,
  AssetLoan,
  CreateAssetInput,
  UpdateAssetInput,
} from '@/types/models';

const props = defineProps<{
  open: boolean;
  asset?: Asset | null;
  defaults?: { memberId?: string; type?: AssetType };
}>();

const emit = defineEmits<{
  close: [];
  save: [data: CreateAssetInput | { id: string; data: UpdateAssetInput }];
  delete: [id: string];
}>();

const { t } = useTranslation();
const familyStore = useFamilyStore();
const settingsStore = useSettingsStore();
const { options: institutionOptions, removeCustomInstitution } = useInstitutionOptions();
const countryOptions = COUNTRIES.map((c) => ({ value: c.code, label: c.name }));

// Asset type emoji chip options
const ASSET_TYPE_OPTIONS = [
  { value: '🏠', label: 'Real Estate', icon: '🏠' },
  { value: '🚗', label: 'Vehicle', icon: '🚗' },
  { value: '⛵', label: 'Boat', icon: '⛵' },
  { value: '💎', label: 'Jewelry', icon: '💎' },
  { value: '💻', label: 'Electronics', icon: '💻' },
  { value: '🔧', label: 'Equipment', icon: '🔧' },
  { value: '🎨', label: 'Art', icon: '🎨' },
  { value: '📦', label: 'Collectible', icon: '📦' },
  { value: '📋', label: 'Other', icon: '📋' },
];

const emojiToType: Record<string, AssetType> = {
  '🏠': 'real_estate',
  '🚗': 'vehicle',
  '⛵': 'boat',
  '💎': 'jewelry',
  '💻': 'electronics',
  '🔧': 'equipment',
  '🎨': 'art',
  '📦': 'collectible',
  '📋': 'other',
};

const typeToEmoji: Record<AssetType, string> = {
  real_estate: '🏠',
  vehicle: '🚗',
  boat: '⛵',
  jewelry: '💎',
  electronics: '💻',
  equipment: '🔧',
  art: '🎨',
  collectible: '📦',
  other: '📋',
};

// Form state
const assetEmoji = ref('');
const name = ref('');
const type = ref<AssetType>('real_estate');
const purchaseValue = ref<number | undefined>(undefined);
const currentValue = ref<number | undefined>(undefined);
const currency = ref('');
const memberId = ref('');
const purchaseDate = ref('');
const notes = ref('');
const includeInNetWorth = ref(true);
const showMoreDetails = ref(false);

// Loan state
const hasLoan = ref(false);
const loanAmount = ref<number | undefined>(undefined);
const outstandingBalance = ref<number | undefined>(undefined);
const interestRate = ref<number | undefined>(undefined);
const monthlyPayment = ref<number | undefined>(undefined);
const loanTermMonths = ref<number | undefined>(undefined);
const lender = ref<string | undefined>(undefined);
const lenderCountry = ref<string | undefined>(undefined);
const loanStartDate = ref('');

// Reset form when modal opens
const { isEditing, isSubmitting } = useFormModal(
  () => props.asset,
  () => props.open,
  {
    onEdit: (asset) => {
      assetEmoji.value = typeToEmoji[asset.type] || '📋';
      name.value = asset.name;
      type.value = asset.type;
      purchaseValue.value = asset.purchaseValue;
      currentValue.value = asset.currentValue;
      currency.value = asset.currency;
      memberId.value = asset.memberId;
      purchaseDate.value = asset.purchaseDate ?? '';
      notes.value = asset.notes ?? '';
      includeInNetWorth.value = asset.includeInNetWorth;
      showMoreDetails.value = !asset.includeInNetWorth;

      // Loan
      hasLoan.value = asset.loan?.hasLoan ?? false;
      loanAmount.value = asset.loan?.loanAmount;
      outstandingBalance.value = asset.loan?.outstandingBalance;
      interestRate.value = asset.loan?.interestRate;
      monthlyPayment.value = asset.loan?.monthlyPayment;
      loanTermMonths.value = asset.loan?.loanTermMonths;
      lender.value = asset.loan?.lender;
      lenderCountry.value = asset.loan?.lenderCountry;
      loanStartDate.value = asset.loan?.loanStartDate ?? '';
    },
    onNew: () => {
      assetEmoji.value = props.defaults?.type ? typeToEmoji[props.defaults.type] || '' : '';
      name.value = '';
      type.value = props.defaults?.type ?? 'real_estate';
      purchaseValue.value = undefined;
      currentValue.value = undefined;
      currency.value = settingsStore.displayCurrency;
      memberId.value = props.defaults?.memberId ?? familyStore.currentMemberId ?? '';
      purchaseDate.value = '';
      notes.value = '';
      includeInNetWorth.value = true;
      showMoreDetails.value = false;

      hasLoan.value = false;
      loanAmount.value = undefined;
      outstandingBalance.value = undefined;
      interestRate.value = undefined;
      monthlyPayment.value = undefined;
      loanTermMonths.value = undefined;
      lender.value = undefined;
      lenderCountry.value = undefined;
      loanStartDate.value = '';
    },
  }
);

// Derive type from emoji
watch(assetEmoji, (emoji) => {
  if (emoji && emojiToType[emoji]) {
    type.value = emojiToType[emoji]!;
  }
});

const canSave = computed(() => name.value.trim().length > 0 && memberId.value !== '');

const modalTitle = computed(() => (isEditing.value ? t('assets.editAsset') : t('assets.addAsset')));

const saveLabel = computed(() => (isEditing.value ? t('modal.saveAsset') : t('modal.addAsset')));

const modalIcon = computed(() => assetEmoji.value || '🏠');

/** Strip undefined values from loan data (Automerge rejects undefined). */
function cleanLoan(): AssetLoan {
  if (!hasLoan.value) return { hasLoan: false };
  const cleaned: Partial<AssetLoan> = { hasLoan: true };
  if (loanAmount.value !== undefined) cleaned.loanAmount = loanAmount.value;
  if (outstandingBalance.value !== undefined) cleaned.outstandingBalance = outstandingBalance.value;
  if (interestRate.value !== undefined) cleaned.interestRate = interestRate.value;
  if (monthlyPayment.value !== undefined) cleaned.monthlyPayment = monthlyPayment.value;
  if (loanTermMonths.value !== undefined) cleaned.loanTermMonths = loanTermMonths.value;
  if (lender.value) cleaned.lender = lender.value;
  if (lenderCountry.value) cleaned.lenderCountry = lenderCountry.value;
  if (loanStartDate.value) cleaned.loanStartDate = loanStartDate.value;
  return cleaned as AssetLoan;
}

async function handleRemoveCustomInstitution(instName: string) {
  await removeCustomInstitution(instName);
}

async function handleSave() {
  if (!canSave.value) return;
  isSubmitting.value = true;

  try {
    const loan = cleanLoan();
    await persistCustomInstitutionIfNeeded(lender.value);

    const data = {
      name: name.value.trim(),
      type: type.value,
      purchaseValue: purchaseValue.value ?? 0,
      currentValue: currentValue.value ?? 0,
      currency: currency.value,
      memberId: memberId.value,
      purchaseDate: purchaseDate.value || undefined,
      notes: notes.value || undefined,
      includeInNetWorth: includeInNetWorth.value,
      loan,
    };

    if (isEditing.value && props.asset) {
      emit('save', { id: props.asset.id, data: data as UpdateAssetInput });
    } else {
      emit('save', data as CreateAssetInput);
    }
  } finally {
    isSubmitting.value = false;
  }
}

function handleDelete() {
  if (props.asset) {
    emit('delete', props.asset.id);
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
    <!-- 1. Owner picker -->
    <FormFieldGroup :label="t('modal.owner')" required>
      <FamilyChipPicker v-model="memberId" mode="single" />
    </FormFieldGroup>

    <!-- 2. Asset type picker (emoji chips) -->
    <FormFieldGroup :label="t('modal.selectCategory')" required>
      <FrequencyChips v-model="assetEmoji" :options="ASSET_TYPE_OPTIONS" />
    </FormFieldGroup>

    <!-- 3. Asset name (styled transparent input) -->
    <FormFieldGroup :label="t('assets.assetName')" required>
      <input
        v-model="name"
        type="text"
        class="font-outfit w-full border-none bg-transparent text-lg font-bold text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-muted)] placeholder:opacity-30 dark:text-gray-100"
        :placeholder="t('assets.assetName')"
      />
    </FormFieldGroup>

    <!-- 4. Purchase Value + Currency -->
    <FormFieldGroup :label="t('common.purchaseValue')">
      <CurrencyAmountInput v-model:amount="purchaseValue" v-model:currency="currency" />
    </FormFieldGroup>

    <!-- 5. Current Value -->
    <FormFieldGroup :label="t('common.currentValue')">
      <AmountInput
        v-model="currentValue"
        :currency-symbol="currency || settingsStore.displayCurrency"
        font-size="1.2rem"
      />
    </FormFieldGroup>

    <!-- 6. Purchase date -->
    <FormFieldGroup :label="t('assets.purchaseDate')" optional>
      <BaseInput v-model="purchaseDate" type="date" />
    </FormFieldGroup>

    <!-- 7. Notes -->
    <FormFieldGroup :label="t('form.notes')" optional>
      <input
        v-model="notes"
        type="text"
        class="w-full border-none bg-transparent text-sm text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-muted)] placeholder:opacity-30 dark:text-gray-100"
        placeholder="Additional details about this asset..."
      />
    </FormFieldGroup>

    <!-- 8. More Details collapsible -->
    <div>
      <button
        type="button"
        class="font-outfit text-primary-500 hover:text-primary-600 text-sm font-semibold"
        @click="showMoreDetails = !showMoreDetails"
      >
        {{ t('modal.moreDetails') }} {{ showMoreDetails ? '▴' : '▾' }}
      </button>

      <div v-if="showMoreDetails" class="mt-3 space-y-3">
        <!-- Include in Net Worth toggle -->
        <div
          class="flex items-center justify-between rounded-[14px] bg-[var(--tint-slate-5)] px-4 py-3 dark:bg-slate-800"
        >
          <div>
            <div
              class="font-outfit text-sm font-semibold text-[var(--color-text)] dark:text-gray-100"
            >
              {{ t('form.includeInNetWorth') }}
            </div>
            <div class="text-xs text-[var(--color-text-muted)]">
              {{ t('assets.includeInNetWorthDesc') }}
            </div>
          </div>
          <ToggleSwitch v-model="includeInNetWorth" />
        </div>
      </div>
    </div>

    <!-- 9. Has a Loan toggle -->
    <div
      class="flex cursor-pointer items-center justify-between rounded-[14px] bg-[var(--tint-slate-5)] px-4 py-3 dark:bg-slate-800"
      @click="hasLoan = !hasLoan"
    >
      <div>
        <div class="font-outfit text-sm font-semibold text-[var(--color-text)] dark:text-gray-100">
          {{ t('assets.hasLoan') }}
        </div>
        <div class="text-xs text-[var(--color-text-muted)]">
          {{ t('assets.hasLoanDesc') }}
        </div>
      </div>
      <ToggleSwitch v-model="hasLoan" @click.stop />
    </div>

    <!-- Loan sub-form (shown when hasLoan is on) -->
    <div v-if="hasLoan" class="space-y-4 rounded-2xl bg-[var(--tint-orange-8)] p-4">
      <div class="font-outfit text-primary-500 text-sm font-semibold">
        {{ t('assets.loanDetails') }}
      </div>

      <div class="grid grid-cols-2 gap-4">
        <FormFieldGroup :label="t('assets.originalLoanAmount')">
          <AmountInput
            v-model="loanAmount"
            :currency-symbol="currency || settingsStore.displayCurrency"
            font-size="1rem"
            bg-class="bg-white/70 dark:bg-slate-800/70"
          />
        </FormFieldGroup>
        <FormFieldGroup :label="t('assets.outstandingBalance')">
          <AmountInput
            v-model="outstandingBalance"
            :currency-symbol="currency || settingsStore.displayCurrency"
            font-size="1rem"
            bg-class="bg-white/70 dark:bg-slate-800/70"
          />
        </FormFieldGroup>
      </div>

      <div class="grid grid-cols-2 gap-4">
        <FormFieldGroup :label="t('assets.interestRate')">
          <BaseInput v-model="interestRate" type="number" placeholder="5.0" step="0.01" />
        </FormFieldGroup>
        <FormFieldGroup :label="t('assets.monthlyPayment')">
          <AmountInput
            v-model="monthlyPayment"
            :currency-symbol="currency || settingsStore.displayCurrency"
            font-size="1rem"
            bg-class="bg-white/70 dark:bg-slate-800/70"
          />
        </FormFieldGroup>
      </div>

      <FormFieldGroup :label="t('assets.loanTerm')">
        <BaseInput v-model="loanTermMonths" type="number" placeholder="360" />
      </FormFieldGroup>

      <div class="grid grid-cols-2 gap-4">
        <FormFieldGroup :label="t('assets.lender')">
          <BaseCombobox
            v-model="lender"
            :options="institutionOptions"
            :placeholder="t('form.searchInstitutions')"
            :search-placeholder="t('form.searchInstitutions')"
            :other-value="OTHER_INSTITUTION_VALUE"
            :other-label="t('form.other')"
            :other-placeholder="t('form.enterCustomName')"
            @custom-removed="handleRemoveCustomInstitution"
          />
        </FormFieldGroup>
        <FormFieldGroup :label="t('form.country')">
          <BaseCombobox
            v-model="lenderCountry"
            :options="countryOptions"
            :placeholder="t('form.searchCountries')"
            :search-placeholder="t('form.searchCountries')"
          />
        </FormFieldGroup>
      </div>

      <FormFieldGroup :label="t('assets.loanStartDate')">
        <BaseInput v-model="loanStartDate" type="date" />
      </FormFieldGroup>
    </div>
  </BeanieFormModal>
</template>
