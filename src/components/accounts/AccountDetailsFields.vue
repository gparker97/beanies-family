<script setup lang="ts">
/**
 * The optional account-details fields, rendered inside AccountModal's existing
 * "More Details" collapsible. Extracted so the modal stays thin.
 *
 * The parent owns `const details = reactive<AccountDetails>(…)` and passes it as
 * a plain `:details` bind. This component holds it as a `defineModel` and mutates
 * its fields directly (the object is shared by reference, so the parent's
 * validation computed re-runs). It never REASSIGNS the model, so no
 * `update:details` ever emits — the parent binds one-way and needs no handler.
 * Validation is DERIVED by the parent from the same pure `validateAccountDetails`.
 */
import { computed } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import {
  showsAccountNumber,
  bankFieldsApply,
  cardFieldsApply,
  cryptoFieldsApply,
  formatCardChip,
  validateAccountDetails,
} from '@/utils/accountDetails';
import { CARD_NETWORKS, CARD_NETWORK_LABELS } from '@/constants/accountDetails';
import FormFieldGroup from '@/components/ui/FormFieldGroup.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import BaseSelect from '@/components/ui/BaseSelect.vue';
import AmountInput from '@/components/ui/AmountInput.vue';
import CryptoWalletList from '@/components/accounts/CryptoWalletList.vue';
import type { AccountDetails, AccountType, CardNetwork } from '@/types/models';

// defineModel: the parent owns `const details = reactive<AccountDetails>(…)` and
// binds it here. We mutate the model's fields directly (via v-model on each
// input); the object is shared by reference so the parent's validation computed
// re-runs. Recognized by vue/no-mutating-props as intentionally mutable.
const details = defineModel<AccountDetails>('details', { required: true });
const props = defineProps<{
  type: AccountType | '';
  currency: string;
}>();

const { t } = useTranslation();

const errors = computed(() => validateAccountDetails(details.value, props.type));
/** Resolve an i18n error key to a message (empty string = no error). */
function err(field: string): string {
  const key = errors.value[field];
  return key ? t(key) : '';
}

const networkOptions = CARD_NETWORKS.map((n) => ({ value: n, label: CARD_NETWORK_LABELS[n] }));
const cardChip = computed(() => formatCardChip(details.value.cardNetwork, details.value.cardLast4));

function setNetwork(value: string | number) {
  details.value.cardNetwork = (String(value) || '') as CardNetwork | '';
}
</script>

<template>
  <div class="space-y-4">
    <p class="text-xs text-[var(--color-text-muted)]">
      {{ t('accountDetails.section.caption') }}
    </p>

    <!-- Account number — hidden for cash + crypto -->
    <FormFieldGroup
      v-if="showsAccountNumber(type)"
      :label="t('accountDetails.field.accountNumber')"
    >
      <BaseInput v-model="details.accountNumber" type="text" placeholder="000123456789" />
    </FormFieldGroup>

    <!-- Common -->
    <FormFieldGroup :label="t('accountDetails.field.onlineBankingUrl')">
      <BaseInput v-model="details.onlineBankingUrl" type="url" placeholder="https://…" />
    </FormFieldGroup>
    <FormFieldGroup :label="t('accountDetails.field.onlineBankingUserId')">
      <BaseInput v-model="details.onlineBankingUserId" type="text" />
    </FormFieldGroup>

    <!-- Bank details (checking / savings). Fields stack full-width — the long
         uppercase labels ("ROUTING / SORT CODE") overlap in a tight 3-column
         grid inside the drawer. -->
    <div v-if="bankFieldsApply(type)" class="space-y-3 rounded-2xl bg-[var(--tint-orange-8)] p-4">
      <div class="font-outfit text-sm font-semibold text-[var(--color-text)]">
        {{ t('accountDetails.bank.title') }}
      </div>
      <FormFieldGroup :label="t('accountDetails.field.routingNumber')">
        <BaseInput v-model="details.routingNumber" type="text" placeholder="021000021" />
      </FormFieldGroup>
      <FormFieldGroup :label="t('accountDetails.field.iban')">
        <BaseInput v-model="details.iban" type="text" class="font-mono" placeholder="GB29 NWBK …" />
      </FormFieldGroup>
      <FormFieldGroup :label="t('accountDetails.field.swiftBic')">
        <BaseInput v-model="details.swiftBic" type="text" placeholder="CHASUS33" />
      </FormFieldGroup>
      <FormFieldGroup v-if="type === 'savings'" :label="t('accountDetails.field.interestRate')">
        <BaseInput
          v-model="details.savingsInterestRate"
          type="number"
          step="0.01"
          min="0"
          placeholder="0.0"
          :hint="t('accountDetails.field.interestRateHint')"
        />
      </FormFieldGroup>
    </div>

    <!-- Credit card details -->
    <div v-if="cardFieldsApply(type)" class="space-y-3 rounded-2xl bg-[var(--tint-orange-8)] p-4">
      <div class="font-outfit text-sm font-semibold text-[var(--color-text)]">
        {{ t('accountDetails.card.title') }}
      </div>
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormFieldGroup :label="t('accountDetails.field.cardNetwork')">
          <BaseSelect
            :model-value="details.cardNetwork"
            :options="networkOptions"
            :placeholder="t('accountDetails.field.cardNetwork')"
            @update:model-value="setNetwork"
          />
        </FormFieldGroup>
        <FormFieldGroup :label="t('accountDetails.field.cardLast4')" :error="!!err('cardLast4')">
          <div class="flex items-center gap-2">
            <BaseInput
              v-model="details.cardLast4"
              type="text"
              inputmode="numeric"
              maxlength="4"
              placeholder="1234"
              class="flex-1"
              :error="err('cardLast4')"
            />
            <span
              v-if="cardChip"
              class="font-outfit inline-flex shrink-0 items-center gap-1 rounded-full bg-[#2C3E50] px-2.5 py-1 text-xs font-semibold text-white"
            >
              {{ cardChip }}
            </span>
          </div>
        </FormFieldGroup>
      </div>
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormFieldGroup :label="t('accountDetails.field.cardExpiry')" :error="!!err('cardExpiry')">
          <BaseInput
            v-model="details.cardExpiry"
            type="text"
            maxlength="5"
            placeholder="MM/YY"
            :error="err('cardExpiry')"
          />
        </FormFieldGroup>
        <FormFieldGroup
          :label="t('accountDetails.field.statementDay')"
          :error="!!err('statementDay')"
        >
          <BaseInput
            v-model="details.statementDay"
            type="number"
            min="1"
            max="31"
            placeholder="1–31"
            :error="err('statementDay')"
          />
        </FormFieldGroup>
        <FormFieldGroup
          :label="t('accountDetails.field.paymentDueDay')"
          :error="!!err('paymentDueDay')"
        >
          <BaseInput
            v-model="details.paymentDueDay"
            type="number"
            min="1"
            max="31"
            placeholder="1–31"
            :error="err('paymentDueDay')"
          />
        </FormFieldGroup>
      </div>
      <FormFieldGroup :label="t('accountDetails.field.creditLimit')">
        <AmountInput v-model="details.creditLimit" :currency-symbol="currency" font-size="1.1rem" />
      </FormFieldGroup>
      <p class="text-xs text-[var(--color-text-muted)]">
        <span aria-hidden="true">🔒</span> {{ t('accountDetails.card.cvvNote') }}
      </p>
    </div>

    <!-- Crypto wallets -->
    <div v-if="cryptoFieldsApply(type)" class="space-y-3 rounded-2xl bg-[var(--tint-silk-20)] p-4">
      <div class="font-outfit text-sm font-semibold text-[var(--color-text)]">
        {{ t('accountDetails.crypto.title') }}
      </div>
      <p class="text-xs text-[var(--color-text-muted)]">
        {{ t('accountDetails.crypto.publicOnly') }}
      </p>
      <CryptoWalletList :model-value="details.wallets" />
    </div>

    <!-- Notes -->
    <FormFieldGroup :label="t('accountDetails.field.notes')">
      <textarea
        v-model="details.notes"
        rows="2"
        class="focus:border-primary-500 dark:bg-surface-overlay dark:text-ink w-full rounded-[14px] border-2 border-transparent bg-[var(--tint-slate-5)] px-4 py-2.5 text-base text-[var(--color-text)] transition-all focus:shadow-[0_0_0_3px_rgba(241,93,34,0.1)] focus:outline-none"
        :placeholder="t('accountDetails.field.notesPlaceholder')"
      />
    </FormFieldGroup>
  </div>
</template>
