import { createAutomergeRepository, stripUndefined, toPlain } from '../automergeRepository';
import { getById as projectionGetById } from '../projection';
import { mutate } from '../worker/docClient';
import type { MutationOp } from '../worker/protocol';
import type { TransactionCascadeArgs, TransactionCascadeResult } from '../worker/transactionOps';
import { incrementBalanceOp } from './accountRepository';
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

export type { TransactionCascadeResult } from '../worker/transactionOps';

/** The one sender of the cascade op (`worker/transactionOps.ts`). */
function commitCascade(args: TransactionCascadeArgs): Promise<TransactionCascadeResult> {
  return mutate<TransactionCascadeResult>({ op: 'named', name: 'commitTransactionCascade', args });
}

/** The echo for a row that was not there to update or delete: nothing ran, nothing moved. */
const notFound = (mode: 'update' | 'delete'): TransactionCascadeResult => ({
  mode,
  found: false,
  accounts: [],
  goals: [],
  assets: [],
  skipped: [],
});

/**
 * Create a transaction AND apply its balance, goal and loan effects in ONE Automerge change
 * (the worker `commitTransactionCascade` op, audit C7). The row is stamped here exactly as the
 * factory's `create` stamps one; the worker computes the derived fields (`goalAllocApplied`,
 * the loan portions) and echoes the row plus every entity it moved, folded.
 */
export async function createTransactionCascade(
  input: CreateTransactionInput
): Promise<TransactionCascadeResult> {
  const now = toISODateString(new Date());
  const transaction = toPlain(
    stripUndefined({
      ...(input as unknown as Record<string, unknown>),
      id: generateUUID(),
      createdAt: now,
      updatedAt: now,
    })
  ) as unknown as Transaction;
  return commitCascade({ mode: 'create', transaction });
}

/**
 * Patch a transaction; the worker reverses and re-applies its effects only when a money field
 * changed (`MONEY_FIELDS`), keeping the stored derived fields otherwise. A key set to
 * `undefined` is deleted, as in the factory's `update`. Resolves `found: false` (no write) when
 * the row is not in the projection.
 */
export async function updateTransactionCascade(
  id: string,
  input: UpdateTransactionInput
): Promise<TransactionCascadeResult> {
  if (!projectionGetById('transactions', id)) return notFound('update');
  const raw = input as Record<string, unknown>;
  const deleteKeys = Object.keys(raw).filter((key) => raw[key] === undefined);
  return commitCascade({
    mode: 'update',
    id,
    patch: toPlain(stripUndefined(raw)),
    deleteKeys,
    updatedAt: toISODateString(new Date()),
  });
}

/**
 * Delete a transaction, reversing its effects from the STORED derived fields, in one change.
 * `dedup` (the recurring duplicate sweep) names the twin it keeps: the worker reverses only
 * when either twin's movements were Counter increments, and deletes the row only when both
 * were absolute writes that collapsed into one (see the op).
 */
export async function deleteTransactionCascade(
  id: string,
  opts: { dedup?: { survivorId: string } } = {}
): Promise<TransactionCascadeResult> {
  if (!projectionGetById('transactions', id)) return notFound('delete');
  return commitCascade({
    mode: 'delete',
    id,
    ...(opts.dedup ? { dedup: { survivorId: opts.dedup.survivorId } } : {}),
  });
}

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
    // `onMissing: 'skip'`: an account deleted by another device mid-import must not fail the
    // whole import; the caller reports the skip so a balance divergence is diagnosable.
    ops.push(incrementBalanceOp(accountId, delta, now));
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
