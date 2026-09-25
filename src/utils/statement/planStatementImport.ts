// Statement import planner (#107). Pure and synchronous: writes nothing, reads nothing but its
// arguments. Named to differ from `utils/calendar/planImport.ts` so there are never two
// `planImport.ts` files to tell apart.
//
// Output: one `StatementCandidate` per statement line, carrying the ONLY copy of what would be
// written (`draft`), the familiar match if any, a transfer suggestion if any, and the planner's
// immutable `defaultDecision` beside the user's current `decision`.
//
// ── Decisions per line ─────────────────────────────────────────────────────────────────────
//  1. Already imported (fingerprint seen on an existing row) → `skip`; no match is computed.
//  2. Own-account familiar match (`matchLines` over the import account's real rows and
//     projections, including transfers into/out of it) → `merge`. This runs FIRST, and wins
//     over a counterpart: an entry on the account itself is the stronger evidence.
//  3. Otherwise, for kind `payment`/`transfer`, a counterpart in ANOTHER family account: a
//     PLAIN income/expense row with the equal amount, the opposite direction relative to its
//     own account, within 3 days (`suggestTransfers`, run only over what step 2 left unclaimed,
//     so a row is claimed at most once across both). The candidate gets `match` = that row
//     (`isProjected: false`) AND `transfer = { kind: 'counterpart', … }`, default `merge`.
//     Merging converts that existing row into ONE transfer (paying account → receiving
//     account, statement amount, reconciled + fingerprinted); the store builds that patch.
//     `add` ("keep both") adds the draft as a plain income/expense on the import account;
//     `skip` does nothing. The DRAFT therefore stays a plain income/expense even here, so a
//     keep-both can never create a second transfer. A counterpart that is ALREADY a transfer
//     touching the import account is not a counterpart at all: step 2 finds it.
//  4. Otherwise, a `possible` own-account match → pair card. Default `add` ("keep both"), so a
//     likely duplicate charge is shown but nothing changes unless the person chooses; EXCEPT a
//     `strong` one (a row from an earlier import that clears the familiar bar: the same line on
//     an overlapping screenshot and statement), which defaults to `skip`, so confirming at the
//     defaults never adds it twice. A card `payment` with only a weak possible match keeps its
//     "Paid from?" offer instead (step 5): the payer matters more than a maybe.
//  5. A card-account `payment` with none of these → `transfer = { kind: 'offer' }`, draft stays
//     `income`; it becomes a transfer only when the user picks the paying account.
//  6. Otherwise → `add`.
//
// A transfer draft therefore never comes out of the planner: every draft is income or expense.

import type {
  Account,
  CreateTransactionInput,
  DisplayTransaction,
  Transaction,
} from '@/types/models';
import type { StatementIdentity, StatementLineDraft } from '@/services/ai/types';
import { getCategoriesByType, getCategoryById } from '@/constants/categories';
import { buildMerchantMemory, normaliseMerchant } from './merchantMemory';
import { matchLines, type FamiliarMatch } from './match';
import { suggestTransfers, type TransferSuggestion } from './transfers';

export type StatementDecision = 'add' | 'merge' | 'skip';

export interface StatementCandidate {
  fingerprint: string;
  /** The ONLY copy of what would be written. */
  draft: CreateTransactionInput;
  /** Present ⇒ rendered as a pair card. */
  match?: FamiliarMatch;
  /** A counterpart, or an offer with no account yet. */
  transfer?: TransferSuggestion;
  /** Fingerprint seen before ⇒ dashed, excluded from bulk + totals. */
  alreadyImported: boolean;
  /** The planner's default, immutable. */
  defaultDecision: StatementDecision;
  /** The user's current answer; `add` on a matched card reads "keep both". */
  decision: StatementDecision;
}

export interface StatementPlanNotices {
  /** Lines whose `categoryHint` was not a known category id (each also `console.warn`ed). */
  badCategory: number;
  /** Lines already imported (fingerprint seen before). */
  overlapAlready: number;
  /** Lines with a counterpart in another family account. */
  transfers: number;
  /** Lines with an own-account familiar match. */
  familiar: number;
  /** Lines shown as a possible duplicate (default keep both). */
  possible: number;
  /** Of `possible`, how many pair with a row from an earlier import. */
  possibleImported: number;
  /** Of `possible`, how many met rule (b), similar descriptions on a looser amount. */
  possibleSimilar: number;
  /** Of `possible`, how many are `strong` and so default to skip. */
  possibleStrong: number;
}

export interface StatementImportMeta {
  importId: string;
  importSource: NonNullable<Transaction['importSource']>;
  importPeriod: NonNullable<Transaction['importPeriod']>;
}

export interface PlanStatementImportInput {
  lines: readonly StatementLineDraft[];
  identity: StatementIdentity;
  /** The import's header account. */
  accountId: string;
  accounts: readonly Account[];
  /** All real family transactions (every account). */
  transactions: readonly Transaction[];
  /** Projected recurring instances covering the statement period (`projectRecurringTransactions`). */
  projections: readonly DisplayTransaction[];
  /** Precomputed with `fingerprintLines(accountId, lines)`, aligned with `lines`. */
  fingerprints: readonly string[];
  /** Fingerprints already on existing rows. */
  existingFingerprints: ReadonlySet<string>;
  importMeta: StatementImportMeta;
}

export interface StatementImportPlan {
  candidates: StatementCandidate[];
  notices: StatementPlanNotices;
}

const FALLBACK_CATEGORY = { income: 'other_income', expense: 'other_expense' } as const;

function isValidFor(id: string, type: 'income' | 'expense'): boolean {
  return getCategoriesByType(type).some((c) => c.id === id);
}

/**
 * Build the review plan. Throws when `accountId` is not in `accounts` or `fingerprints` is not
 * aligned with `lines` (both are caller bugs; the store classifies the throw as `plan_failed`).
 */
export function planStatementImport(input: PlanStatementImportInput): StatementImportPlan {
  const { lines, identity, accountId, accounts, transactions, projections, fingerprints } = input;
  if (fingerprints.length !== lines.length) {
    throw new Error(
      `planStatementImport: ${fingerprints.length} fingerprints for ${lines.length} lines`
    );
  }
  const account = accounts.find((a) => a.id === accountId);
  if (!account) throw new Error('planStatementImport: the import account is not in `accounts`');

  const notices: StatementPlanNotices = {
    badCategory: 0,
    overlapAlready: 0,
    transfers: 0,
    familiar: 0,
    possible: 0,
    possibleImported: 0,
    possibleSimilar: 0,
    possibleStrong: 0,
  };

  // Merchant memory, uncapped here: this is on-device lookup, not the model context.
  const memory = new Map(
    buildMerchantMemory(transactions, { max: Number.POSITIVE_INFINITY }).map((m) => [
      m.name,
      m.category,
    ])
  );

  /** The category for a line and whether it is a real signal (hint/memory) or the fallback. */
  const resolveCategory = (line: StatementLineDraft, type: 'income' | 'expense') => {
    const hint = line.categoryHint?.trim();
    if (hint) {
      if (!getCategoryById(hint)) {
        notices.badCategory++;
        console.warn(
          '[statement-import] the model suggested unknown category id "%s"; falling back to ' +
            'merchant memory / %s. Check the category list rendered into the statement prompt.',
          hint,
          FALLBACK_CATEGORY[type]
        );
      } else if (isValidFor(hint, type)) {
        return { id: hint, signal: true };
      }
    }
    for (const text of [line.description, line.merchant]) {
      const remembered = text ? memory.get(normaliseMerchant(text)) : undefined;
      if (remembered && isValidFor(remembered, type)) return { id: remembered, signal: true };
    }
    return { id: FALLBACK_CATEGORY[type], signal: false };
  };

  const alreadyImported = input.fingerprints.map((fp) => input.existingFingerprints.has(fp));
  const types = lines.map((l): 'income' | 'expense' =>
    l.direction === 'in' ? 'income' : 'expense'
  );
  const categories = lines.map((l, i) => resolveCategory(l, types[i]!));

  // Steps 2 and 4: own-account matches (familiar and possible), over lines not already imported.
  const openIdx = lines.map((_, i) => i).filter((i) => !alreadyImported[i]);
  const ownMatches = new Map<number, FamiliarMatch>();
  const possibleMatches = new Map<number, FamiliarMatch>();
  matchLines(
    openIdx.map((i) => ({
      ...lines[i]!,
      category: categories[i]!.signal ? categories[i]!.id : undefined,
    })),
    [...transactions, ...projections],
    // The import period, not the raw `identity.period`: the same range written to the rows, and
    // the lines' own span when the statement prints none, so the matcher's earlier-import overlap
    // guard is never switched off by a missing period.
    input.importMeta.importPeriod,
    accountId
  ).forEach((m, k) => {
    if (m) (m.strength === 'familiar' ? ownMatches : possibleMatches).set(openIdx[k]!, m);
  });

  // Steps 3 and 5: counterparts in other accounts, over what step 2 left, then card offers. A
  // possible match does not hold a line back from a counterpart: exact evidence wins.
  const claimed = new Set([...ownMatches.values()].map((m) => m.id));
  const txById = new Map(transactions.map((t) => [t.id, t]));
  const transfers = suggestTransfers(
    lines.map((l, i) => (alreadyImported[i] || ownMatches.has(i) ? null : l)),
    accountId,
    transactions.filter((t) => t.accountId !== accountId),
    { isCardAccount: account.type === 'credit_card' || identity.account.kind === 'card', claimed }
  );

  const candidates = lines.map((line, i): StatementCandidate => {
    const draft: CreateTransactionInput = {
      accountId,
      type: types[i]!,
      amount: line.amount,
      currency: account.currency,
      category: categories[i]!.id,
      date: line.date,
      description: line.merchant?.trim() || line.description,
      statementDescription: line.description,
      isReconciled: true,
      importFingerprint: fingerprints[i]!,
      importId: input.importMeta.importId,
      importSource: input.importMeta.importSource,
      importPeriod: input.importMeta.importPeriod,
    };

    if (alreadyImported[i]) {
      notices.overlapAlready++;
      return base(fingerprints[i]!, draft, 'skip', { alreadyImported: true });
    }

    const own = ownMatches.get(i);
    if (own) {
      notices.familiar++;
      return base(fingerprints[i]!, draft, 'merge', { match: own });
    }

    const transfer = transfers[i];
    if (transfer?.kind === 'counterpart') {
      const row = txById.get(transfer.transactionId);
      if (row) {
        notices.transfers++;
        return base(fingerprints[i]!, draft, 'merge', {
          transfer,
          match: {
            strength: 'familiar',
            existingImported: !!row.importFingerprint,
            id: row.id,
            isProjected: false,
            ...(row.recurringItemId ? { recurringItemId: row.recurringItemId } : {}),
            existing: row,
            // Counterparts are exact by construction (equal amount, within 3 days).
            score: 1,
          },
        });
      }
    }
    const possible = possibleMatches.get(i);
    if (possible && (possible.strong || transfer?.kind !== 'offer')) {
      notices.possible++;
      if (possible.existingImported) notices.possibleImported++;
      if (possible.possibleRule === 'similar') notices.possibleSimilar++;
      if (possible.strong) notices.possibleStrong++;
      return base(fingerprints[i]!, draft, possible.strong ? 'skip' : 'add', { match: possible });
    }
    if (transfer?.kind === 'offer') return base(fingerprints[i]!, draft, 'add', { transfer });
    return base(fingerprints[i]!, draft, 'add', {});
  });

  return { candidates, notices };
}

function base(
  fingerprint: string,
  draft: CreateTransactionInput,
  defaultDecision: StatementDecision,
  extra: { match?: FamiliarMatch; transfer?: TransferSuggestion; alreadyImported?: boolean }
): StatementCandidate {
  return {
    fingerprint,
    draft,
    ...(extra.match ? { match: extra.match } : {}),
    ...(extra.transfer ? { transfer: extra.transfer } : {}),
    alreadyImported: extra.alreadyImported ?? false,
    defaultDecision,
    decision: defaultDecision,
  };
}

/**
 * Pre-select the import account from what the statement says about itself. A ladder, each rung
 * accepted only when it names exactly ONE active account (an ambiguous rung falls through):
 *  1. the card's last 4 digits against `Account.cardLast4`;
 *  2. the institution (case-insensitive, either name containing the other) plus, when the
 *     statement states one, the currency;
 *  3. the sole active account in the statement's currency.
 * Returns null when no rung decides; the review then asks.
 */
export function suggestAccount(
  identity: StatementIdentity['account'],
  accounts: readonly Account[]
): string | null {
  const active = accounts.filter((a) => a.isActive);
  const sole = (list: readonly Account[]) => (list.length === 1 ? list[0]!.id : null);

  const last4 = identity.last4?.replace(/\D/g, '').slice(-4);
  if (last4 && last4.length === 4) {
    const hit = sole(active.filter((a) => a.cardLast4?.replace(/\D/g, '').slice(-4) === last4));
    if (hit) return hit;
  }

  const currency = identity.currency?.trim().toUpperCase();
  const sameCurrency = (a: Account) => !currency || a.currency.toUpperCase() === currency;

  const institution = identity.institution?.trim().toLowerCase();
  if (institution) {
    const hit = sole(
      active.filter((a) => {
        const own = a.institution?.trim().toLowerCase();
        return !!own && (own.includes(institution) || institution.includes(own)) && sameCurrency(a);
      })
    );
    if (hit) return hit;
  }

  if (currency) return sole(active.filter(sameCurrency));
  return null;
}
