/**
 * Round 3 (C8 narrowing): the transaction fields whose conflict makes a compaction rebase
 * UNAVAILABLE rather than settled target-wins.
 *
 * A pure constants module with no imports, so both `docOps` (the rebase composer) and
 * `transactionOps` (the cascade) can depend on it without a cycle. `transactionOps` keeps its
 * own `MONEY_FIELDS` (which decides cascade-vs-row-patch, a different question that also
 * includes the allocation inputs); this list is the conflict question: "if the two sides
 * disagree here, settling one of them moves money or a derived effect without its pair".
 *
 * `recurringItemId` is deliberately absent: only its TRUTHINESS moves money (amortisation vs an
 * extra payment on a loan), so a conflict between two truthy ids is an ordinary target-wins
 * field. `rebaseBlockingTransactionConflict` handles it.
 */
export const TRANSACTION_REBASE_BLOCKING_FIELDS: ReadonlySet<string> = new Set([
  'amount',
  'type',
  'accountId',
  'toAccountId',
  'currency',
  'toAmount',
  'goalId',
  'goalAllocApplied',
  'loanId',
  'loanInterestPortion',
  'loanPrincipalPortion',
]);

/**
 * Does a field conflict on a transaction block the rebase? `peer` and `target` are the two
 * conflicting values (the peer's and the family file's).
 */
export function rebaseBlockingTransactionConflict(
  field: string,
  peer: unknown,
  target: unknown
): boolean {
  if (field === 'recurringItemId') return Boolean(peer) !== Boolean(target);
  return TRANSACTION_REBASE_BLOCKING_FIELDS.has(field);
}
