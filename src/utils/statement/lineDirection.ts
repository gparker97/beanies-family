// Which way a statement line's money moved, relative to the IMPORT account (#107). THE one
// answer, used by the plain row, the paired card and the inline editor: each used to compute it
// for itself, and the card got a transfer wrong (a transfer INTO the import account drawn as
// money out).

import type { CreateTransactionInput } from '@/types/models';

type DirectionFields = Pick<CreateTransactionInput, 'type' | 'toAccountId'>;

/** `in` = money arrived in the import account; `out` = money left it. */
export function lineDirection(draft: DirectionFields, importAccountId: string): 'in' | 'out' {
  if (draft.type === 'transfer') return draft.toAccountId === importAccountId ? 'in' : 'out';
  return draft.type === 'income' ? 'in' : 'out';
}
