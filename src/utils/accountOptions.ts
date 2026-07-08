import type { Account, AccountType } from '@/types/models';

/**
 * Grouped, alphabetically-sorted account options for the picker dropdowns.
 * Groups separate the visually-distinct kinds (bank/cash, credit cards,
 * investments, loans, other) so a long account list stays scannable, and each
 * label can carry the balance (see `makeLabel`). Shared by the transaction
 * modal's source + destination pickers.
 */

const GROUP_ORDER = ['cash', 'cards', 'investments', 'loans', 'other'] as const;
export type AccountGroupId = (typeof GROUP_ORDER)[number];

export function accountGroupForType(type: AccountType): AccountGroupId {
  if (type === 'loan') return 'loans';
  if (type === 'credit_card') return 'cards';
  if (type === 'checking' || type === 'savings' || type === 'cash') return 'cash';
  if (type === 'other') return 'other';
  return 'investments'; // investment / crypto / retirement_* / education_*
}

export interface AccountOption {
  value: string;
  label: string;
}
export interface AccountOptionGroup {
  id: AccountGroupId;
  label: string;
  options: AccountOption[];
}

/**
 * Build ordered option groups. `makeLabel` renders each account's display label
 * (e.g. name + balance); `groupLabel` renders each group's heading. Empty groups
 * are omitted; accounts within a group are sorted by name (locale-aware).
 */
export function buildAccountOptionGroups(
  accounts: ReadonlyArray<Account>,
  makeLabel: (a: Account) => string,
  groupLabel: (id: AccountGroupId) => string
): AccountOptionGroup[] {
  const byGroup = new Map<AccountGroupId, Account[]>();
  for (const a of accounts) {
    const g = accountGroupForType(a.type);
    const list = byGroup.get(g);
    if (list) list.push(a);
    else byGroup.set(g, [a]);
  }
  const groups: AccountOptionGroup[] = [];
  for (const id of GROUP_ORDER) {
    const list = byGroup.get(id);
    if (!list || list.length === 0) continue;
    list.sort((x, y) => x.name.localeCompare(y.name));
    groups.push({
      id,
      label: groupLabel(id),
      options: list.map((a) => ({ value: a.id, label: makeLabel(a) })),
    });
  }
  return groups;
}
