import { getDatabase } from '../database';
import type { Account, AccountType, CreateAccountInput, UpdateAccountInput } from '@/types/models';
import { toISODateString } from '@/utils/date';
import { generateUUID } from '@/utils/id';

export async function getAllAccounts(): Promise<Account[]> {
  const db = await getDatabase();
  return db.getAll('accounts');
}

export async function getAccountById(id: string): Promise<Account | undefined> {
  const db = await getDatabase();
  return db.get('accounts', id);
}

export async function getAccountsByMemberId(memberId: string): Promise<Account[]> {
  const db = await getDatabase();
  return db.getAllFromIndex('accounts', 'by-memberId', memberId);
}

export async function getAccountsByType(type: AccountType): Promise<Account[]> {
  const db = await getDatabase();
  return db.getAllFromIndex('accounts', 'by-type', type);
}

export async function getActiveAccounts(): Promise<Account[]> {
  const accounts = await getAllAccounts();
  return accounts.filter((a) => a.isActive);
}

export async function createAccount(input: CreateAccountInput): Promise<Account> {
  const db = await getDatabase();
  const now = toISODateString(new Date());

  const account: Account = {
    ...input,
    id: generateUUID(),
    createdAt: now,
    updatedAt: now,
  };

  await db.add('accounts', account);
  return account;
}

export async function updateAccount(
  id: string,
  input: UpdateAccountInput
): Promise<Account | undefined> {
  const db = await getDatabase();
  const existing = await db.get('accounts', id);

  if (!existing) {
    return undefined;
  }

  const updated: Account = {
    ...existing,
    ...input,
    updatedAt: toISODateString(new Date()),
  };

  await db.put('accounts', updated);
  return updated;
}

export async function deleteAccount(id: string): Promise<boolean> {
  const db = await getDatabase();
  const existing = await db.get('accounts', id);

  if (!existing) {
    return false;
  }

  await db.delete('accounts', id);
  return true;
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
      // For credit cards and loans, balance is negative (liability)
      const multiplier = account.type === 'credit_card' || account.type === 'loan' ? -1 : 1;
      return sum + account.balance * multiplier;
    }, 0);
}
