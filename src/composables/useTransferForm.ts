import { computed, type Ref } from 'vue';
import { useAccountsStore } from '@/stores/accountsStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { getRate } from '@/utils/currency';
import { isLiabilityType } from '@/utils/finance';
import type { CurrencyCode } from '@/types/models';

/**
 * Transfer-specific reactive state for the transaction modal — the destination
 * account, cross-currency conversion, rate availability, and same-account guard.
 * Extracted from TransactionModal so the (already large) modal doesn't grow a
 * tangle of transfer-only computeds.
 *
 * The store remains the single authority for the persisted `toAmount`; this
 * composable only drives the modal's live preview + validation (it mirrors the
 * store's conversion so what the user sees is what gets applied).
 */
export function useTransferForm(opts: {
  sourceAccountId: Ref<string>;
  toAccountId: Ref<string | undefined>;
  amount: Ref<number | undefined>;
  sourceCurrency: Ref<CurrencyCode>;
}) {
  const accountsStore = useAccountsStore();
  const settingsStore = useSettingsStore();

  const destAccount = computed(() =>
    opts.toAccountId.value
      ? accountsStore.accounts.find((a) => a.id === opts.toAccountId.value)
      : undefined
  );
  const destCurrency = computed<CurrencyCode | undefined>(() => destAccount.value?.currency);
  const destIsLiability = computed(
    () => !!destAccount.value && isLiabilityType(destAccount.value.type)
  );

  const isCrossCurrency = computed(
    () => !!destCurrency.value && destCurrency.value !== opts.sourceCurrency.value
  );

  // The live exchange rate for the pair, or undefined when none is available.
  // Same-currency → 1 (no conversion needed).
  const rate = computed<number | undefined>(() =>
    isCrossCurrency.value && destCurrency.value
      ? getRate(settingsStore.exchangeRates, opts.sourceCurrency.value, destCurrency.value)
      : 1
  );
  const hasRate = computed(() => rate.value !== undefined);

  // The amount the destination will receive, in its own currency (mirrors the
  // store's Math.round(amount * rate, 2)). Undefined for same-currency or when
  // inputs are incomplete / no rate.
  const convertedAmount = computed<number | undefined>(() => {
    if (!isCrossCurrency.value || rate.value === undefined || opts.amount.value === undefined) {
      return undefined;
    }
    return Math.round(opts.amount.value * rate.value * 100) / 100;
  });

  const sameAccount = computed(
    () => !!opts.toAccountId.value && opts.toAccountId.value === opts.sourceAccountId.value
  );

  return {
    destAccount,
    destCurrency,
    destIsLiability,
    isCrossCurrency,
    hasRate,
    convertedAmount,
    sameAccount,
  };
}
