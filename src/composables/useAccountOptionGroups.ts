// The grouped account list every account picker shows: grouped by kind, alphabetical within a
// group, with the balance (or the amount owed) inline. Extracted from `TransactionModal` (#107)
// when the statement import needed the same picker, so the two can never label an account
// differently.

import { useTranslation } from '@/composables/useTranslation';
import { formatCurrencyWithCode } from '@/composables/useCurrencyDisplay';
import {
  buildAccountOptionGroups,
  type AccountGroupId,
  type AccountOptionGroup,
} from '@/utils/accountOptions';
import { isLiabilityType } from '@/utils/finance';
import type { Account } from '@/types/models';

export function useAccountOptionGroups() {
  const { t } = useTranslation();

  const groupLabel = (id: AccountGroupId): string => {
    switch (id) {
      case 'cash':
        return t('txn.accountGroup.cash');
      case 'cards':
        return t('txn.accountGroup.cards');
      case 'investments':
        return t('txn.accountGroup.investments');
      case 'loans':
        return t('txn.accountGroup.loans');
      case 'other':
        return t('txn.accountGroup.other');
    }
  };

  const accountLabel = (a: Account): string =>
    isLiabilityType(a.type)
      ? `${a.name} · ${t('txn.owedLabel')} ${formatCurrencyWithCode(a.balance, a.currency)}`
      : `${a.name} · ${formatCurrencyWithCode(a.balance, a.currency)}`;

  /** Option groups for these accounts, in the app's one picker order and labelling. */
  function groupsFor(accounts: ReadonlyArray<Account>): AccountOptionGroup[] {
    return buildAccountOptionGroups(accounts, accountLabel, groupLabel);
  }

  return { groupsFor };
}
