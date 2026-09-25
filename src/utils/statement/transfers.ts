// Transfer detection for statement import (#107). Pure.
//
// A `payment` or `transfer` line on the import account may be the other half of a movement the
// family already recorded in ANOTHER of its accounts (the card payment typed as an expense on
// the savings account). That row is the counterpart; the planner offers to merge the line into
// it so the pair becomes ONE transfer row, not two. A card payment with no counterpart gets an
// offer instead: the user can pick the paying account themselves.

import type { DisplayTransaction } from '@/types/models';
import type { StatementLineDraft } from '@/services/ai/types';
import { daysBetween, extractDatePart } from '@/utils/date';

export type TransferSuggestion =
  { kind: 'counterpart'; otherAccountId: string; transactionId: string } | { kind: 'offer' };

/** A counterpart's date may be at most this many days from the line's. */
export const TRANSFER_COUNTERPART_MAX_DAYS = 3;

type TransferLine = Pick<StatementLineDraft, 'date' | 'amount' | 'direction' | 'kind'>;

export interface SuggestTransferOptions {
  /** True when the import account is a card: an unmatched card `payment` is offered. */
  isCardAccount?: boolean;
  /** Row ids already claimed (by the own-account matcher or an earlier line). Never offered. */
  claimed?: ReadonlySet<string>;
}

const TRANSFER_KINDS: ReadonlySet<StatementLineDraft['kind']> = new Set(['payment', 'transfer']);

/**
 * Is `tx` a possible counterpart for `line`? Only PLAIN income/expense rows in another account:
 * a row that is already a transfer touching the import account is the same fact, and the
 * own-account matcher (which treats transfers into/out of the account as in/out candidates)
 * reconciles it as a normal familiar match. The counterpart moves money the opposite way
 * relative to its own account: a line `out` of the import account is money `in` to the other
 * account (an income row there), and vice versa.
 */
function isCounterpart(line: TransferLine, tx: DisplayTransaction, accountId: string): boolean {
  if (tx.isProjected) return false;
  if (tx.accountId === accountId) return false;
  const wanted = line.direction === 'out' ? 'income' : 'expense';
  if (tx.type !== wanted) return false;
  if (Math.round(tx.amount * 100) !== Math.round(line.amount * 100)) return false;
  return daysBetween(line.date, extractDatePart(tx.date)) <= TRANSFER_COUNTERPART_MAX_DAYS;
}

/**
 * The transfer suggestion for ONE line, or null. For kind `payment`/`transfer`: the closest-dated
 * unclaimed counterpart in another family account (equal amount to 2 dp, opposite direction,
 * within {@link TRANSFER_COUNTERPART_MAX_DAYS}). Failing that, a card-account `payment` gets
 * `{ kind: 'offer' }`. Everything else: null.
 */
export function suggestTransfer(
  line: TransferLine,
  accountId: string,
  otherAccountsTx: readonly DisplayTransaction[],
  opts: SuggestTransferOptions = {}
): TransferSuggestion | null {
  if (!TRANSFER_KINDS.has(line.kind)) return null;
  let best: DisplayTransaction | null = null;
  let bestDays = Infinity;
  for (const tx of otherAccountsTx) {
    if (opts.claimed?.has(tx.id)) continue;
    if (!isCounterpart(line, tx, accountId)) continue;
    const days = daysBetween(line.date, extractDatePart(tx.date));
    if (days < bestDays) {
      best = tx;
      bestDays = days;
    }
  }
  if (best) return { kind: 'counterpart', otherAccountId: best.accountId, transactionId: best.id };
  if (opts.isCardAccount && line.kind === 'payment') return { kind: 'offer' };
  return null;
}

/**
 * {@link suggestTransfer} for a whole statement, aligned with `lines`, with greedy one-row-per-
 * line assignment: every (line, counterpart) pair is ranked by date distance (ties: input order)
 * and claimed in that order, so a counterpart is never offered to two lines. `null` entries in
 * `lines` are skipped (the planner passes null for lines that already have an own-account match
 * or are already imported) and get null back.
 */
export function suggestTransfers(
  lines: readonly (TransferLine | null)[],
  accountId: string,
  otherAccountsTx: readonly DisplayTransaction[],
  opts: SuggestTransferOptions = {}
): (TransferSuggestion | null)[] {
  const result: (TransferSuggestion | null)[] = lines.map(() => null);
  const claimed = new Set(opts.claimed ?? []);

  const pairs: { li: number; tx: DisplayTransaction; days: number; ti: number }[] = [];
  lines.forEach((line, li) => {
    if (!line || !TRANSFER_KINDS.has(line.kind)) return;
    otherAccountsTx.forEach((tx, ti) => {
      if (claimed.has(tx.id) || !isCounterpart(line, tx, accountId)) return;
      pairs.push({ li, tx, ti, days: daysBetween(line.date, extractDatePart(tx.date)) });
    });
  });
  pairs.sort((a, b) => a.days - b.days || a.li - b.li || a.ti - b.ti);
  for (const p of pairs) {
    if (result[p.li] || claimed.has(p.tx.id)) continue;
    claimed.add(p.tx.id);
    result[p.li] = { kind: 'counterpart', otherAccountId: p.tx.accountId, transactionId: p.tx.id };
  }

  lines.forEach((line, li) => {
    if (line && !result[li] && opts.isCardAccount && line.kind === 'payment') {
      result[li] = { kind: 'offer' };
    }
  });
  return result;
}
