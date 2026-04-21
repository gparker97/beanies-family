import { useAccountsStore } from '@/stores/accountsStore';
import { useTransactionsStore } from '@/stores/transactionsStore';
import { useAuthoringMember } from '@/composables/useAuthoringMember';
import { useTranslation } from '@/composables/useTranslation';
import { showToast } from '@/composables/useToast';
import { toDateInputValue } from '@/utils/date';
import type { Account, UpdateAccountInput } from '@/types/models';

export interface AdjustBalanceResult {
  /** True if the account update itself persisted. An adjustment row may or may not have been written (see `adjustmentTxId`). */
  success: boolean;
  /** The freshly-updated account, when `success` is true. */
  account?: Account;
  /** The id of the emitted balance_adjustment transaction, when one was recorded. */
  adjustmentTxId?: string;
}

/**
 * Sole entry point for user-initiated balance edits.
 *
 * Orchestrates: read old balance → update account → (if balance changed)
 * emit a `balance_adjustment` Transaction recording delta + author.
 *
 * Non-user callers (e.g. `assetsStore` loan sync) continue to call
 * `accountsStore.updateAccount` directly — this composable is the UI-layer
 * path that deliberately leaves an audit trail.
 *
 * Every failure path surfaces a toast + console entry + explicit return
 * shape; no silent returns.
 */
export function useAdjustBalance() {
  const accountsStore = useAccountsStore();
  const transactionsStore = useTransactionsStore();
  const { resolveOrToast } = useAuthoringMember();
  const { t } = useTranslation();

  async function saveWithAdjustment(
    id: string,
    input: UpdateAccountInput
  ): Promise<AdjustBalanceResult> {
    const before = accountsStore.accounts.find((a) => a.id === id);
    if (!before) {
      console.error('[useAdjustBalance] account not found:', id);
      showToast('error', t('accountView.notFound'));
      return { success: false };
    }

    const oldBalance = before.balance;
    const updated = await accountsStore.updateAccount(id, input);
    if (!updated) {
      // wrapAsync on updateAccount already surfaced the error toast.
      return { success: false };
    }

    const delta = updated.balance - oldBalance;
    if (delta === 0) {
      return { success: true, account: updated };
    }

    const author = resolveOrToast({
      callerTag: 'useAdjustBalance',
      toastTitleKey: 'accountView.adjustError.noAuthor',
      toastHelpKey: 'accountView.adjustError.noAuthorHelp',
    });
    if (!author) {
      return { success: true, account: updated };
    }

    const tx = await transactionsStore.createTransaction({
      accountId: id,
      type: 'balance_adjustment',
      amount: Math.abs(delta),
      adjustment: { delta, updatedBy: author },
      currency: updated.currency,
      category: '',
      date: toDateInputValue(new Date()),
      description: t('txn.balanceAdjusted'),
      isReconciled: true, // redundant with store invariant, kept for clarity at the call site
    });

    if (!tx) {
      // wrapAsync on createTransaction already surfaced the error toast.
      console.warn(
        '[useAdjustBalance] balance updated but adjustment row failed to record for account',
        id
      );
      return { success: true, account: updated };
    }

    return { success: true, account: updated, adjustmentTxId: tx.id };
  }

  return { saveWithAdjustment };
}
