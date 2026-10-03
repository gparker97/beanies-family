import { createAutomergeRepository, patchOp } from '../automergeRepository';
import { getById as projectionGetById } from '../projection';
import { mutate } from '../worker/docClient';
import type { MutationOp } from '../worker/protocol';
import { toISODateString } from '@/utils/date';
import { accountNetWorthMultiplier } from '@/utils/finance';
import type {
  Account,
  AccountType,
  Asset,
  CreateAccountInput,
  UpdateAccountInput,
} from '@/types/models';

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

/** What an account delete must detach in the same change (audit C7): computed by
 *  `accountsStore.deleteAccount` from its sibling stores' state. */
export interface AccountDeleteDependents {
  /** Recurring items paid from, or amortising, the account: deactivated. */
  recurringItemIds: readonly string[];
  /** Loan accounts paid from the account: `payFromAccountId` cleared. */
  loanAccountIds: readonly string[];
  /** Assets whose loan is paid from the account: `loan.payFromAccountId` cleared. */
  assets: readonly Asset[];
}

/**
 * Delete an account AND detach everything that fed it, in ONE Automerge change: a deleted
 * account used to keep generating recurring instances (and a loan kept naming it as its payer)
 * until someone noticed. Every dependent patch is `onMissing: 'skip'`, so a concurrent delete
 * of a dependent never fails the account delete. Resolves `false` (no write) when the account
 * is not in the projection.
 */
export async function deleteAccountCascade(
  id: string,
  dependents: AccountDeleteDependents
): Promise<boolean> {
  if (!projectionGetById('accounts', id)) return false;
  const now = toISODateString(new Date());
  const ops: MutationOp[] = [];
  for (const itemId of dependents.recurringItemIds) {
    ops.push(
      patchOp('recurringItems', itemId, { isActive: false }, { updatedAt: now, onMissing: 'skip' })
    );
  }
  for (const accountId of dependents.loanAccountIds) {
    ops.push(
      patchOp(
        'accounts',
        accountId,
        {},
        { deleteKeys: ['payFromAccountId'], updatedAt: now, onMissing: 'skip' }
      )
    );
  }
  for (const asset of dependents.assets) {
    if (!asset.loan) continue;
    // `loan` is a MERGE field: the reconciler writes it per key against `base`, so a key the
    // base has and the patch lacks is cleared, and a peer's concurrent edit to another key keeps.
    const { payFromAccountId: _cleared, ...loan } = asset.loan;
    ops.push(
      patchOp('assets', asset.id, { loan }, { updatedAt: now, onMissing: 'skip', current: asset })
    );
  }
  ops.push({ op: 'delete', collection: 'accounts', id });
  await mutate({ op: 'batch', ops });
  return true;
}

export async function getTotalBalance(memberId?: string): Promise<number> {
  const accounts = memberId ? await getAccountsByMemberId(memberId) : await getAllAccounts();
  return accounts
    .filter((a) => a.isActive && a.includeInNetWorth)
    .reduce((sum, account) => sum + account.balance * accountNetWorthMultiplier(account), 0);
}
