import type { Transaction } from '@/types/models';
import type { UIStringKey } from '@/services/translation/uiStrings';
import { assertNever } from '@/utils/assertNever';

export interface SubtitleContext {
  /** i18n lookup function (from useTranslation). */
  t: (key: UIStringKey) => string;
  /** Name of the FamilyMember referenced by adjustment.updatedBy, pre-resolved by the caller. */
  authorName?: string;
  /** Name of the RecurringItem referenced by tx.recurringItemId, pre-resolved by the caller. */
  recurringItemName?: string;
  /**
   * For transfers: the account name on the opposite side of the transfer,
   * relative to `vantageAccountId`. The caller resolves from
   * `tx.accountId` or `tx.toAccountId` depending on which matches the vantage.
   */
  transferCounterpartyName?: string;
  /** The currently-signed-in member id, for detecting "Adjusted by you". */
  currentMemberId?: string;
}

/**
 * Build the one-line subtitle that accompanies a transaction amount in list
 * views (account activity log, transactions page mobile row).
 *
 * Pure transformer — takes pre-resolved display names, never reaches into
 * stores. Caller is responsible for the lookups. Branches in
 * most-specific-wins order; unknown shapes fall back to `tx.description`
 * with a dev warning.
 *
 * @param tx - the transaction to render
 * @param ctx - pre-resolved display names + i18n lookup
 * @param vantageAccountId - optional: which account's perspective are we
 *   viewing this from? Used to orient transfer direction ("→ to"  vs "← from").
 */
export function getTransactionSubtitle(
  tx: Transaction,
  ctx: SubtitleContext,
  vantageAccountId?: string
): string {
  // 1. Balance adjustment — "Adjusted by you" / "Adjusted by {name}"
  if (tx.type === 'balance_adjustment') {
    const adjAuthor = tx.adjustment?.updatedBy;
    if (adjAuthor && adjAuthor === ctx.currentMemberId) {
      return ctx.t('accountView.adjustedByYou');
    }
    const name = ctx.authorName ?? ctx.t('family.unknownMember');
    return ctx.t('accountView.adjustedBy').replace('{name}', name);
  }

  // 2. Loan payment (linked loan or amortization portions set)
  if (tx.loanId || tx.loanInterestPortion != null || tx.loanPrincipalPortion != null) {
    return ctx.t('accountView.loanLabel');
  }

  // 3. Goal allocation
  if (tx.goalId) {
    return ctx.t('accountView.goalLabel');
  }

  // 4. Recurring (auto-generated from a RecurringItem)
  if (tx.recurringItemId) {
    const name = ctx.recurringItemName ?? tx.description;
    return ctx.t('accountView.recurringLabel').replace('{name}', name);
  }

  // 5. Transfer — direction depends on vantage account
  if (tx.type === 'transfer') {
    const counterparty = ctx.transferCounterpartyName ?? ctx.t('family.unknownAccount');
    const isSource = vantageAccountId == null || tx.accountId === vantageAccountId;
    const template: UIStringKey = isSource ? 'accountView.transferTo' : 'accountView.transferFrom';
    return ctx.t(template).replace('{account}', counterparty);
  }

  // 6. Fallback — plain income/expense, use the user-supplied description.
  // If the description is empty (shouldn't happen, but defensive), warn.
  if (!tx.description) {
    console.warn('[getTransactionSubtitle] transaction has no description:', tx.id, tx.type);
    return '';
  }
  return tx.description;
}

/** Visual treatment used by activity rows that display transactions. */
export interface TransactionVisual {
  icon: string;
  tint: 'green' | 'orange' | 'slate' | 'blue';
}

/**
 * Stable icon + tint for any transaction. Single source of truth for
 * transaction-row visuals across the app (activity feeds, search results,
 * recent activity card). Mirrors the priority chain used by
 * `getTransactionSubtitle`: balance_adjustment is checked first, then
 * transfer, then income, then expense as the default.
 *
 * Balance adjustments use the scale emoji (⚖️) with the tint reflecting
 * the direction of the adjustment (positive = green, negative = orange,
 * zero = slate). Transfers use a directional arrow icon with a blue tint
 * (distinct from cash flow). Income is the money-bag icon with green;
 * expense is the credit-card icon with orange.
 *
 * @example
 *   const { icon, tint } = getTransactionVisual(tx);
 *
 * @see getTransactionSubtitle — for the matching subtitle classification
 */
export function getTransactionVisual(tx: Transaction): TransactionVisual {
  switch (tx.type) {
    case 'balance_adjustment': {
      const delta = tx.adjustment?.delta ?? 0;
      const tint: TransactionVisual['tint'] = delta > 0 ? 'green' : delta < 0 ? 'orange' : 'slate';
      return { icon: '⚖️', tint };
    }
    case 'transfer':
      return { icon: '\u{1F504}', tint: 'blue' };
    case 'income':
      return { icon: '\u{1F4B0}', tint: 'green' };
    case 'expense':
      return { icon: '\u{1F4B3}', tint: 'orange' };
    default:
      assertNever(tx.type, 'getTransactionVisual');
  }
}
