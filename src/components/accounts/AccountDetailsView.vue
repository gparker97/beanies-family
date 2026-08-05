<script setup lang="ts">
/**
 * Read-only display of an account's optional detail fields, shown in
 * AccountViewModal between the balance head and the activity log. Renders only
 * populated fields; visibility gated by the same type predicates as the editor.
 */
import { computed } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { useClipboard } from '@/composables/useClipboard';
import { showToast } from '@/composables/useToast';
import { getUrlDomain } from '@/utils/url';
import { getOrdinalSuffix } from '@/utils/format';
import {
  showsAccountNumber,
  bankFieldsApply,
  cardFieldsApply,
  cryptoFieldsApply,
  formatCardChip,
} from '@/utils/accountDetails';
import { CRYPTO_CHAIN_LABELS } from '@/constants/accountDetails';
import type { Account } from '@/types/models';

const props = defineProps<{ account: Account }>();

const { t } = useTranslation();
const { copy } = useClipboard();

const cardChip = computed(() => formatCardChip(props.account.cardNetwork, props.account.cardLast4));

const statementDue = computed(() => {
  const a = props.account;
  if (!a.statementDay && !a.paymentDueDay) return '';
  const s = a.statementDay ? getOrdinalSuffix(a.statementDay) : '—';
  const d = a.paymentDueDay ? getOrdinalSuffix(a.paymentDueDay) : '—';
  return `${s} / ${d}`;
});

const creditLimit = computed(() =>
  typeof props.account.creditLimit === 'number'
    ? `${props.account.creditLimit.toLocaleString()} ${props.account.currency}`
    : ''
);

const bankUrl = computed(() => props.account.onlineBankingUrl ?? '');
const bankHref = computed(() =>
  bankUrl.value.startsWith('http') ? bankUrl.value : `https://${bankUrl.value}`
);

async function copyAddress(address: string) {
  const ok = await copy(address);
  if (ok) {
    showToast('success', t('accountDetails.copied'));
  } else {
    showToast('error', t('accountDetails.copyFailedTitle'), t('accountDetails.copyFailedMsg'), {
      silent: true,
      surface: 'account-details',
    });
  }
}
</script>

<template>
  <div class="space-y-3">
    <h3
      class="font-outfit text-xs font-semibold tracking-[0.08em] text-[#2C3E50]/50 uppercase dark:text-gray-500"
    >
      {{ t('accountDetails.view.title') }}
    </h3>

    <dl class="flex flex-col">
      <div
        v-if="showsAccountNumber(account.type) && account.accountNumber"
        class="flex justify-between gap-4 border-b border-[var(--divider,rgba(44,62,80,0.08))] py-2.5 last:border-0"
      >
        <dt class="text-sm text-[var(--color-text-muted)]">
          {{ t('accountDetails.field.accountNumber') }}
        </dt>
        <dd class="font-outfit text-right text-sm font-semibold break-all">
          {{ account.accountNumber }}
        </dd>
      </div>

      <template v-if="cardFieldsApply(account.type)">
        <div
          v-if="cardChip"
          class="flex justify-between gap-4 border-b border-[var(--divider,rgba(44,62,80,0.08))] py-2.5 last:border-0"
        >
          <dt class="text-sm text-[var(--color-text-muted)]">
            {{ t('accountDetails.view.card') }}
          </dt>
          <dd class="text-right">
            <span
              class="font-outfit inline-flex items-center gap-1 rounded-full bg-[#2C3E50] px-2.5 py-1 text-xs font-semibold text-white"
              >{{ cardChip }}</span
            >
          </dd>
        </div>
        <div
          v-if="account.cardExpiry"
          class="flex justify-between gap-4 border-b border-[var(--divider,rgba(44,62,80,0.08))] py-2.5 last:border-0"
        >
          <dt class="text-sm text-[var(--color-text-muted)]">
            {{ t('accountDetails.view.expiry') }}
          </dt>
          <dd class="font-outfit text-right text-sm font-semibold">{{ account.cardExpiry }}</dd>
        </div>
        <div
          v-if="creditLimit"
          class="flex justify-between gap-4 border-b border-[var(--divider,rgba(44,62,80,0.08))] py-2.5 last:border-0"
        >
          <dt class="text-sm text-[var(--color-text-muted)]">
            {{ t('accountDetails.field.creditLimit') }}
          </dt>
          <dd class="font-outfit text-right text-sm font-semibold">{{ creditLimit }}</dd>
        </div>
        <div
          v-if="statementDue"
          class="flex justify-between gap-4 border-b border-[var(--divider,rgba(44,62,80,0.08))] py-2.5 last:border-0"
        >
          <dt class="text-sm text-[var(--color-text-muted)]">
            {{ t('accountDetails.view.statementDue') }}
          </dt>
          <dd class="font-outfit text-right text-sm font-semibold">{{ statementDue }}</dd>
        </div>
      </template>

      <template v-if="bankFieldsApply(account.type)">
        <div
          v-if="account.routingNumber"
          class="flex justify-between gap-4 border-b border-[var(--divider,rgba(44,62,80,0.08))] py-2.5 last:border-0"
        >
          <dt class="text-sm text-[var(--color-text-muted)]">
            {{ t('accountDetails.field.routingNumber') }}
          </dt>
          <dd class="font-outfit text-right text-sm font-semibold break-all">
            {{ account.routingNumber }}
          </dd>
        </div>
        <div
          v-if="account.iban"
          class="flex justify-between gap-4 border-b border-[var(--divider,rgba(44,62,80,0.08))] py-2.5 last:border-0"
        >
          <dt class="text-sm text-[var(--color-text-muted)]">
            {{ t('accountDetails.field.iban') }}
          </dt>
          <dd class="text-right font-mono text-sm break-all">{{ account.iban }}</dd>
        </div>
        <div
          v-if="account.swiftBic"
          class="flex justify-between gap-4 border-b border-[var(--divider,rgba(44,62,80,0.08))] py-2.5 last:border-0"
        >
          <dt class="text-sm text-[var(--color-text-muted)]">
            {{ t('accountDetails.field.swiftBic') }}
          </dt>
          <dd class="font-outfit text-right text-sm font-semibold">{{ account.swiftBic }}</dd>
        </div>
        <div
          v-if="account.type === 'savings' && account.interestRate"
          class="flex justify-between gap-4 border-b border-[var(--divider,rgba(44,62,80,0.08))] py-2.5 last:border-0"
        >
          <dt class="text-sm text-[var(--color-text-muted)]">
            {{ t('accountDetails.field.interestRate') }}
          </dt>
          <dd class="font-outfit text-right text-sm font-semibold">{{ account.interestRate }}%</dd>
        </div>
      </template>

      <div
        v-if="account.onlineBankingUrl"
        class="flex justify-between gap-4 border-b border-[var(--divider,rgba(44,62,80,0.08))] py-2.5 last:border-0"
      >
        <dt class="text-sm text-[var(--color-text-muted)]">
          {{ t('accountDetails.view.onlineBanking') }}
        </dt>
        <dd class="text-right text-sm break-all">
          <a
            :href="bankHref"
            target="_blank"
            rel="noopener noreferrer"
            class="text-primary-500 font-semibold hover:underline"
            >{{ getUrlDomain(account.onlineBankingUrl) }} ↗</a
          >
        </dd>
      </div>
      <div
        v-if="account.onlineBankingUserId"
        class="flex justify-between gap-4 border-b border-[var(--divider,rgba(44,62,80,0.08))] py-2.5 last:border-0"
      >
        <dt class="text-sm text-[var(--color-text-muted)]">
          {{ t('accountDetails.view.userId') }}
        </dt>
        <dd class="font-outfit text-right text-sm font-semibold break-all">
          {{ account.onlineBankingUserId }}
        </dd>
      </div>
      <div
        v-if="account.customerServicePhone"
        class="flex justify-between gap-4 border-b border-[var(--divider,rgba(44,62,80,0.08))] py-2.5 last:border-0"
      >
        <dt class="text-sm text-[var(--color-text-muted)]">
          {{ t('accountDetails.view.customerService') }}
        </dt>
        <dd class="font-outfit text-right text-sm font-semibold">
          {{ account.customerServicePhone }}
        </dd>
      </div>
    </dl>

    <!-- Wallets -->
    <div v-if="cryptoFieldsApply(account.type) && account.wallets?.length" class="space-y-2">
      <h4
        class="font-outfit text-xs font-semibold tracking-[0.08em] text-[#2C3E50]/50 uppercase dark:text-gray-500"
      >
        {{ t('accountDetails.crypto.title') }}
      </h4>
      <div
        v-for="wallet in account.wallets"
        :key="wallet.id"
        class="rounded-[14px] bg-[var(--tint-slate-5)] p-3 dark:bg-slate-700"
      >
        <div class="mb-1 flex items-center gap-2">
          <span class="font-outfit text-sm font-semibold">{{ wallet.label }}</span>
          <span
            v-if="wallet.chain"
            class="bg-primary-500/15 text-primary-500 font-outfit rounded-full px-2 py-0.5 text-xs font-semibold"
            >{{ CRYPTO_CHAIN_LABELS[wallet.chain] }}</span
          >
        </div>
        <div class="flex items-center gap-2">
          <code class="min-w-0 flex-1 truncate font-mono text-xs text-[var(--color-text-muted)]">{{
            wallet.address
          }}</code>
          <button
            type="button"
            class="hover:text-primary-500 grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-white text-[var(--color-text-muted)] shadow-sm transition-colors dark:bg-slate-600"
            :aria-label="t('accountDetails.copyAddress')"
            :title="t('accountDetails.copyAddress')"
            @click="copyAddress(wallet.address)"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <rect x="9" y="9" width="13" height="13" rx="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
          </button>
        </div>
      </div>
    </div>

    <!-- Notes -->
    <div v-if="account.notes" class="space-y-1">
      <h4
        class="font-outfit text-xs font-semibold tracking-[0.08em] text-[#2C3E50]/50 uppercase dark:text-gray-500"
      >
        {{ t('accountDetails.field.notes') }}
      </h4>
      <p class="text-sm whitespace-pre-line text-[var(--color-text)] dark:text-gray-300">
        {{ account.notes }}
      </p>
    </div>
  </div>
</template>
