import { createAutomergeRepository } from '../automergeRepository';
import type { Account, AccountType, CreateAccountInput, UpdateAccountInput } from '@/types/models';

const repo = createAutomergeRepository<'accounts', Account, CreateAccountInput, UpdateAccountInput>(
  'accounts'
);

export const getAllAccounts = repo.getAll;
export const getAccountById = repo.getById;
export const createAccount = repo.create;
export const updateAccount = repo.update;
export const deleteAccount = repo.remove;

export async function getAccountsByMemberId(memberId: string): Promise<Account[]> {
  const accounts = await getAllAccounts();
  return accounts.filter((a) => a.memberId === memberId);
}

export async function getAccountsByType(type: AccountType): Promise<Account[]> {
  const accounts = await getAllAccounts();
  return accounts.filter((a) => a.type === type);
}

export async function getActiveAccounts(): Promise<Account[]> {
  const accounts = await getAllAccounts();
  return accounts.filter((a) => a.isActive);
}

export async function updateAccountBalance(
  id: string,
  newBalance: number
): Promise<Account | undefined> {
  return updateAccount(id, { balance: newBalance });
}

export async function getTotalBalance(memberId?: string): Promise<number> {
  const accounts = memberId ? await getAccountsByMemberId(memberId) : await getAllAccounts();
  return accounts
    .filter((a) => a.isActive && a.includeInNetWorth)
    .reduce((sum, account) => {
      const multiplier = account.type === 'credit_card' || account.type === 'loan' ? -1 : 1;
      return sum + account.balance * multiplier;
    }, 0);
}
