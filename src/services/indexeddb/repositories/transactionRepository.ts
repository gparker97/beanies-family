import { createRepository } from '../createRepository';
import { getDatabase } from '../database';
import type {
  Transaction,
  CreateTransactionInput,
  UpdateTransactionInput,
  ISODateString,
} from '@/types/models';
import { isDateBetween } from '@/utils/date';

const repo = createRepository<
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
  const db = await getDatabase();
  return db.getAllFromIndex('transactions', 'by-accountId', accountId);
}

export async function getTransactionsByCategory(category: string): Promise<Transaction[]> {
  const db = await getDatabase();
  return db.getAllFromIndex('transactions', 'by-category', category);
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
