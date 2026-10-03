import { createAutomergeRepository } from '../automergeRepository';
import { mutate } from '../worker/docClient';
import type { MutationOp } from '../worker/protocol';
import { toISODateString } from '@/utils/date';
import { accountNetWorthMultiplier } from '@/utils/finance';
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

/**
 * The one builder for a RELATIVE balance adjustment. `onMissing: 'skip'` so an account deleted
 * by another device mid-write (or mid-import) does not fail the whole mutation; callers that
 * need to know check the echo / projection.
 */
export function incrementBalanceOp(id: string, delta: number, now: string): MutationOp {
  return {
    op: 'increment',
    collection: 'accounts',
    id,
    field: 'balance',
    delta,
    updatedAt: now,
    onMissing: 'skip',
  };
}

/** Atomically adjust a balance by a relative delta; resolves to the echoed account, or
 * undefined when the account no longer exists worker-side. */
export async function incrementBalance(id: string, delta: number): Promise<Account | undefined> {
  return mutate<Account | undefined>(incrementBalanceOp(id, delta, toISODateString(new Date())));
}

export async function getTotalBalance(memberId?: string): Promise<number> {
  const accounts = memberId ? await getAccountsByMemberId(memberId) : await getAllAccounts();
  return accounts
    .filter((a) => a.isActive && a.includeInNetWorth)
    .reduce((sum, account) => sum + account.balance * accountNetWorthMultiplier(account), 0);
}
