<script setup lang="ts">
/**
 * Repeatable labelled PUBLIC-wallet list for crypto accounts.
 *
 * The parent's `details.wallets` array is bound here as a `defineModel`; this
 * component mutates it in place (`push`/`splice`) and mutates each row object's
 * fields. The array is shared by reference so the parent sees every change; it
 * never reassigns the model, so no `update:modelValue` emits.
 *
 * Never stores a seed phrase or private key — public addresses only.
 */
import { useTranslation } from '@/composables/useTranslation';
import { generateUUID } from '@/utils/id';
import { walletRowError } from '@/utils/accountDetails';
import { CRYPTO_CHAINS, CRYPTO_CHAIN_LABELS } from '@/constants/accountDetails';
import FormFieldGroup from '@/components/ui/FormFieldGroup.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import BaseSelect from '@/components/ui/BaseSelect.vue';
import type { CryptoChain, CryptoWallet } from '@/types/models';

// defineModel: the parent owns the reactive `wallets` array (part of its
// `details` object). We mutate this model in place (push/splice); the array is
// shared by reference, so the parent sees every change. Recognized by
// vue/no-mutating-props as intentionally mutable.
const wallets = defineModel<CryptoWallet[]>({ required: true });

const { t } = useTranslation();

const chainOptions = CRYPTO_CHAINS.map((c) => ({ value: c, label: CRYPTO_CHAIN_LABELS[c] }));

function addWallet() {
  wallets.value.push({ id: generateUUID(), label: '', address: '', chain: undefined });
}

function removeWallet(index: number) {
  wallets.value.splice(index, 1);
}

function setChain(wallet: CryptoWallet, value: string | number) {
  wallet.chain = (String(value) || undefined) as CryptoChain | undefined;
}

/** Resolved per-row error message ('' = valid). */
function rowError(wallet: CryptoWallet): string {
  const key = walletRowError(wallet);
  return key ? t(key) : '';
}
</script>

<template>
  <div class="space-y-3">
    <div
      v-for="(wallet, index) in wallets"
      :key="wallet.id"
      class="rounded-2xl border border-[var(--divider,rgba(44,62,80,0.08))] bg-white p-3.5 shadow-sm dark:border-slate-600 dark:bg-slate-700"
    >
      <div class="mb-2.5 flex items-center gap-2">
        <span
          class="bg-primary-500/15 text-primary-500 font-outfit grid h-5 w-5 place-items-center rounded-md text-xs font-bold"
          aria-hidden="true"
        >
          {{ index + 1 }}
        </span>
        <span
          class="font-outfit text-xs font-semibold tracking-[0.1em] text-[var(--color-text)] uppercase opacity-35 dark:text-gray-300"
        >
          {{ t('accountDetails.wallets.walletLabel') }}
        </span>
        <button
          type="button"
          class="hover:text-primary-500 ml-auto grid h-6 w-6 place-items-center rounded-lg bg-[var(--tint-slate-5)] text-[var(--color-text-muted)] transition-colors hover:bg-[rgba(241,93,34,0.12)] dark:bg-slate-600"
          :aria-label="t('accountDetails.wallets.remove')"
          :title="t('accountDetails.wallets.remove')"
          @click="removeWallet(index)"
        >
          &times;
        </button>
      </div>

      <div class="space-y-2.5">
        <FormFieldGroup :label="t('accountDetails.wallets.labelField')">
          <BaseInput
            v-model="wallet.label"
            type="text"
            :placeholder="t('accountDetails.wallets.labelPlaceholder')"
          />
        </FormFieldGroup>

        <div class="grid grid-cols-1 gap-2.5 sm:grid-cols-[1.4fr_0.9fr]">
          <FormFieldGroup :label="t('accountDetails.wallets.address')">
            <BaseInput
              v-model="wallet.address"
              type="text"
              class="font-mono"
              :placeholder="t('accountDetails.wallets.addressPlaceholder')"
            />
          </FormFieldGroup>
          <FormFieldGroup :label="t('accountDetails.wallets.chain')">
            <BaseSelect
              :model-value="wallet.chain ?? ''"
              :options="chainOptions"
              :placeholder="t('accountDetails.wallets.chainOptional')"
              @update:model-value="setChain(wallet, $event)"
            />
          </FormFieldGroup>
        </div>

        <p v-if="rowError(wallet)" class="text-sm text-red-600 dark:text-red-400">
          {{ rowError(wallet) }}
        </p>
      </div>
    </div>

    <button
      type="button"
      class="bg-primary-500 font-outfit hover:bg-primary-600 inline-flex items-center gap-1.5 rounded-[14px] px-4 py-2.5 text-sm font-bold text-white shadow-[0_2px_10px_rgba(241,93,34,0.3)] transition-colors"
      @click="addWallet"
    >
      <span aria-hidden="true">＋</span> {{ t('accountDetails.wallets.add') }}
    </button>
  </div>
</template>
