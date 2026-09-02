import { useAccountsStore } from '@/stores/accountsStore';
import { useMemberInfo } from '@/composables/useMemberInfo';
import { NEUTRAL_MEMBER_COLOR } from '@/constants/memberColors';

/**
 * Member name/colour looked up through an ACCOUNT id.
 *
 * Split out of `useMemberInfo` on 2026-09-02. These two helpers were its only
 * users of `useAccountsStore`, and that one static import put a finance store
 * into the import graph of every surface that showed a member name or colour —
 * including the beanie wall, which is lint-fenced against finance
 * (`eslint.config.js`, FINANCE EXCLUSION) but whose fence catches DIRECT
 * imports only and so could never have seen it.
 *
 * Both consumers are finance surfaces (`TransactionsPage`,
 * `TransactionViewEditModal`), so this is where they belong. Do not merge them
 * back into `useMemberInfo`.
 */
export function useAccountMemberInfo() {
  const { getMemberName, getMemberColor } = useMemberInfo();

  function getMemberNameByAccountId(accountId: string, fallback = 'Unknown'): string {
    const accountsStore = useAccountsStore();
    const account = accountsStore.accounts.find((a) => a.id === accountId);
    if (!account) return fallback;
    return getMemberName(account.memberId, fallback);
  }

  function getMemberColorByAccountId(accountId: string, fallback = NEUTRAL_MEMBER_COLOR): string {
    const accountsStore = useAccountsStore();
    const account = accountsStore.accounts.find((a) => a.id === accountId);
    if (!account) return fallback;
    return getMemberColor(account.memberId, fallback);
  }

  return { getMemberNameByAccountId, getMemberColorByAccountId };
}
