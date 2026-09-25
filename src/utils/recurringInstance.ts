// Which recurring DUE DATE a transaction stands for (#107). THE one answer, used by every site
// that asks "is this instance of a recurring item already accounted for?": the recurring
// processor's materialisation guard, both duplicate sweeps, the ledger's dedupe, and the
// statement import's projection filter.
//
// A row normally stands for the date it is on. A statement line merged into a recurring instance
// is written on the day the bank took the money, and carries the due date it stands for in
// `recurringDueDate`. Before this helper each site keyed on `date` alone, so they disagreed:
// the processor added a second instance beside a merged one, a duplicate sweep could delete a
// real row that happened to share the merged row's date, and one merged row could suppress two
// due dates.

import type { Transaction } from '@/types/models';
import { extractDatePart } from '@/utils/date';

type InstanceFields = Pick<Transaction, 'date' | 'recurringDueDate' | 'recurringItemId'>;

/** The `YYYY-MM-DD` due date this row stands for. */
export function recurringInstanceDate(tx: Pick<Transaction, 'date' | 'recurringDueDate'>): string {
  return tx.recurringDueDate ?? extractDatePart(tx.date);
}

/** `itemId|dueDate` for a recurring row, or null for a one-off. */
export function recurringInstanceKey(tx: InstanceFields): string | null {
  return tx.recurringItemId ? `${tx.recurringItemId}|${recurringInstanceDate(tx)}` : null;
}
