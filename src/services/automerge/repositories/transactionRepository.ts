import { createAutomergeRepository, stripUndefined, toPlain } from '../automergeRepository';
import { getById as projectionGetById } from '../projection';
import { mutate } from '../worker/docClient';
import type { MutationOp } from '../worker/protocol';
import { ImportNotVisibleError } from './importErrors';
import { generateUUID } from '@/utils/id';
import { toISODateString } from '@/utils/date';
import type {
  Transaction,
  CreateTransactionInput,
  UpdateTransactionInput,
  ISODateString,
} from '@/types/models';
import { isDateBetween } from '@/utils/date';

const repo = createAutomergeRepository<
  'transactions',
  Transaction,
  CreateTransactionInput,
  UpdateTransactionInput
>('transactions');

export const getAllTransactions = repo.getAll;
export const getTransactionById = repo.getById;
export const createTransaction = repo.create;
export const updateTransaction = repo.update;
export const deleteTransaction = repo.remove;

export async function getTransactionsByAccountId(accountId: string): Promise<Transaction[]> {
  const transactions = await getAllTransactions();
  return transactions.filter((t) => t.accountId === accountId);
}

export async function getTransactionsByCategory(category: string): Promise<Transaction[]> {
  const transactions = await getAllTransactions();
  return transactions.filter((t) => t.category === category);
}

export async function getTransactionsByDateRange(
  startDate: ISODateString,
  endDate: ISODateString
): Promise<Transaction[]> {
  const transactions = await getAllTransactions();
  return transactions.filter((t) => isDateBetween(t.date, startDate, endDate));
}

export async function getRecentTransactions(limit: number = 10): Promise<Transaction[]> {
  const transactions = await getAllTransactions();
  return transactions
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, limit);
}

export async function getIncomeTotal(
  startDate?: ISODateString,
  endDate?: ISODateString
): Promise<number> {
  let transactions = await getAllTransactions();
  transactions = transactions.filter((t) => t.type === 'income');
  if (startDate && endDate) {
    transactions = transactions.filter((t) => isDateBetween(t.date, startDate, endDate));
  }
  return transactions.reduce((sum, t) => sum + t.amount, 0);
}

export async function getExpenseTotal(
  startDate?: ISODateString,
  endDate?: ISODateString
): Promise<number> {
  let transactions = await getAllTransactions();
  transactions = transactions.filter((t) => t.type === 'expense');
  if (startDate && endDate) {
    transactions = transactions.filter((t) => isDateBetween(t.date, startDate, endDate));
  }
  return transactions.reduce((sum, t) => sum + t.amount, 0);
}

export async function getExpensesByCategory(
  startDate?: ISODateString,
  endDate?: ISODateString
): Promise<Map<string, number>> {
  let transactions = await getAllTransactions();
  transactions = transactions.filter((t) => t.type === 'expense');
  if (startDate && endDate) {
    transactions = transactions.filter((t) => isDateBetween(t.date, startDate, endDate));
  }
  const categoryTotals = new Map<string, number>();
  for (const t of transactions) {
    const current = categoryTotals.get(t.category) || 0;
    categoryTotals.set(t.category, current + t.amount);
  }
  return categoryTotals;
}

// ── Statement import (#107) ──────────────────────────────────────────────────

/** One balance change the import makes, summed per account by the caller. */
export interface BalanceIncrement {
  accountId: string;
  delta: number;
}

/** What `commitStatementAdds` wrote, and which balance increments found no account. */
export interface StatementAddsResult {
  transactions: Transaction[];
  /** Accounts deleted concurrently: their increment was a no-op (see `onMissing: 'skip'`). */
  skippedIncrements: string[];
}

/**
 * Write a statement import's NEW transactions and their balance changes in ONE Automerge change.
 *
 * All or nothing: a throw mid-batch commits nothing, so a failed import leaves no half-applied
 * balances to reconcile by hand. The rows carry no goal or loan links (the planner never sets
 * them), which is why this can bypass `transactionsStore.createTransaction`'s cascade; the
 * caller computes each account's delta with the same `signedAccountDelta` that cascade uses.
 *
 * Verified against the projection afterwards, like `createImportedActivities`: a batch that
 * committed but is not where readers look throws `ImportNotVisibleError`, which the caller must
 * phrase as "not confirmed", never as "nothing was saved".
 */
export async function commitStatementAdds(
  entries: CreateTransactionInput[],
  increments: BalanceIncrement[]
): Promise<StatementAddsResult> {
  if (!entries.length) return { transactions: [], skippedIncrements: [] };

  const now = toISODateString(new Date());
  const ops: MutationOp[] = [];
  const transactions: Transaction[] = [];
  for (const entry of entries) {
    const id = generateUUID();
    const tx = toPlain(
      stripUndefined({
        ...(entry as unknown as Record<string, unknown>),
        id,
        createdAt: now,
        updatedAt: now,
      })
    ) as unknown as Transaction;
    transactions.push(tx);
    ops.push({ op: 'set', collection: 'transactions', id, entity: tx });
  }
  for (const { accountId, delta } of increments) {
    if (delta === 0) continue;
    ops.push({
      op: 'increment',
      collection: 'accounts',
      id: accountId,
      field: 'balance',
      delta,
      updatedAt: now,
      // An account deleted by another device mid-import must not fail the whole import; the
      // caller reports the skip so a balance divergence is diagnosable.
      onMissing: 'skip',
    });
  }

  await mutate({ op: 'batch', ops });

  const missing = transactions.filter((t) => !projectionGetById('transactions', t.id));
  if (missing.length) {
    throw new ImportNotVisibleError(missing.length, transactions.length, 'commitStatementAdds');
  }
  const skippedIncrements = increments
    .filter((i) => i.delta !== 0 && !projectionGetById('accounts', i.accountId))
    .map((i) => i.accountId);
  return { transactions, skippedIncrements };
}
