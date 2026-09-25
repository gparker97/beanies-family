// Statement import matcher (#107). Pure.
//
// Finds, for each statement line, the one existing entry on the import account it most likely
// IS (a "familiar" line): a real transaction or a projected recurring instance. Never requires an
// exact amount on an exact date; a recurring item charged mid-month at a different amount still
// matches. Greedy global assignment, so one existing row is claimed by at most one line.
//
// Two strengths, assigned in two passes:
//  - `familiar`: scores at least FAMILIAR_THRESHOLD; the planner defaults it to merge.
//  - `possible`: a line left unmatched that still sits close to an existing row, within
//    `possibleDays` and either (a) a close amount plus a shared word, the same category or the
//    same month, or (b) an amount within `amountLoosePct` plus clearly similar descriptions
//    (variable charges such as interest: 0.16 on the statement vs 0.20 entered by hand). The planner
//    defaults it to KEEP BOTH: it is shown so a duplicate charge is never silent, and nothing
//    changes unless the person chooses. Rows from an earlier import take part in this pass only,
//    because a default merge into an already-reconciled row would rewrite it unasked, and only
//    when that import's period overlaps this statement's: a bank lists each transaction on one
//    statement, so last month's imported coffees are never this month's duplicates.

import type { DisplayTransaction } from '@/types/models';
import type { StatementLineDraft } from '@/services/ai/types';
import { addDaysYmd, daysBetween, extractDatePart } from '@/utils/date';
import { tokenSimilarity } from '@/utils/textSimilarity';
import { normaliseMerchant } from './merchantMemory';

/**
 * Every weight and window the scorer uses. Tuning (e.g. after the spike) touches THIS block
 * only; the scorer holds no literals and the table test reads the same names.
 */
export const MATCH_WEIGHTS = {
  /** Amounts equal to 2 dp. */
  amountEqual: 0.55,
  /**
   * Amounts within `amountClosePct`, or within `amountCloseAbs` units when that is no more than
   * `amountCloseAbsMaxPct` of the amount. The cap keeps the absolute allowance from swallowing
   * small amounts (0.16 and 0.99 are not "close"; 5.00 and 5.30 still are).
   */
  amountClose: 0.45,
  amountClosePct: 0.02,
  amountCloseAbs: 1,
  amountCloseAbsMaxPct: 0.25,
  /** Amounts within `amountLoosePct`, ONLY for a recurring-linked or projected candidate. */
  amountLoose: 0.3,
  amountLoosePct: 0.25,
  /** Dates equal. */
  dateEqual: 0.25,
  /** Dates within `dateNearDays`. */
  dateNear: 0.2,
  dateNearDays: 3,
  /** Dates within `dateWideDays`. */
  dateWide: 0.1,
  dateWideDays: 10,
  /** Same calendar month, ONLY for a recurring-linked or projected candidate. */
  dateSameMonth: 0.1,
  /** Description similarity (Jaccard over normalised merchant tokens), scaled up to this. */
  description: 0.25,
  /**
   * The line's resolved category equals the candidate's category. Not in the plan's original
   * table: without it the plan's own acceptance example (recurring "Mortgage" 2,000 on the 1st
   * vs "HOME LOAN" 2,305.17 on the 14th) scores 0.30 + 0.10 + 0 = 0.40 and is never familiar,
   * because the two descriptions share no word. The category is the one signal that links
   * them, and with merchant memory the suggested category is the family's own.
   */
  category: 0.25,
  /** Candidate window around the statement period, in days each side. */
  periodPadDays: 20,
  /** A `possible` match: at most this many days apart. */
  possibleDays: 31,
  /** Rule (b) of a `possible` match: description similarity at least this (Jaccard, 0-1). */
  possibleLooseSimilarity: 0.5,
} as const;

/**
 * A line is familiar when its best candidate scores at least this AND the dates agree
 * (`dateScore` > 0: within `dateWideDays`, or the same month for a recurring-like row). Without
 * the date condition amount + category alone reach 0.80, so last month's same-amount bill would
 * default to merge and be moved onto this month's date.
 */
export const FAMILIAR_THRESHOLD = 0.6;

/** The fields of a statement line the matcher reads. */
export type MatchLine = Pick<
  StatementLineDraft,
  'date' | 'amount' | 'direction' | 'description' | 'merchant'
> & {
  /** The planner's RESOLVED category (hint or merchant memory), never a generic fallback. */
  category?: string;
};

export type MatchStrength = 'familiar' | 'possible';
export type PossibleRule = 'close' | 'similar';

export interface FamiliarMatch {
  /** `familiar` defaults to merge; `possible` is a duplicate hint that defaults to keep both. */
  strength: MatchStrength;
  /** The existing row came from an earlier import (only ever a `possible` match). */
  existingImported: boolean;
  /** Which `possible` rule it met: (a) `close` amount, or (b) `similar` descriptions. */
  possibleRule?: PossibleRule;
  /**
   * A `possible` match that clears the FAMILIAR bar (score and dates): it is only `possible`
   * because the row came from an earlier import. The planner treats it as the same line read
   * twice (an overlapping screenshot and statement), not a maybe.
   */
  strong?: boolean;
  /** The existing row's id (a projection's synthetic id when `isProjected`). */
  id: string;
  isProjected: boolean;
  recurringItemId?: string;
  /** A projection's due date (`YYYY-MM-DD`), so a merge can materialise it without a lookup. */
  dueDate?: string;
  existing: DisplayTransaction;
  score: number;
}

export interface MatchPeriod {
  from?: string;
  to?: string;
}

/** Direction of an existing row RELATIVE to `accountId`, or null when it is not on it. */
export function directionOnAccount(tx: DisplayTransaction, accountId: string): 'in' | 'out' | null {
  if (tx.type === 'transfer') {
    if (tx.accountId === accountId) return 'out';
    if (tx.toAccountId === accountId) return 'in';
    return null;
  }
  if (tx.accountId !== accountId) return null;
  if (tx.type === 'income') return 'in';
  if (tx.type === 'expense') return 'out';
  return null; // balance_adjustment never matches
}

/** The amount that moved on `accountId` (a transfer's credit side is `toAmount ?? amount`). */
function amountOnAccount(tx: DisplayTransaction, accountId: string): number {
  if (tx.type === 'transfer' && tx.toAccountId === accountId && tx.accountId !== accountId) {
    return tx.toAmount ?? tx.amount;
  }
  return tx.amount;
}

function isRecurringLike(tx: DisplayTransaction): boolean {
  return !!tx.isProjected || !!tx.recurringItemId;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function amountScore(lineAmount: number, candAmount: number, recurringLike: boolean): number {
  const W = MATCH_WEIGHTS;
  const diff = Math.abs(round2(lineAmount) - round2(candAmount));
  if (diff === 0) return W.amountEqual;
  const base = Math.max(Math.abs(lineAmount), Math.abs(candAmount));
  const allowance = Math.max(
    base * W.amountClosePct,
    Math.min(W.amountCloseAbs, base * W.amountCloseAbsMaxPct)
  );
  if (diff <= allowance) return W.amountClose;
  if (recurringLike && diff <= base * W.amountLoosePct) return W.amountLoose;
  return 0;
}

function dateScore(lineDate: string, candDate: string, recurringLike: boolean): number {
  const W = MATCH_WEIGHTS;
  const days = daysBetween(lineDate, candDate);
  if (days === 0) return W.dateEqual;
  if (days <= W.dateNearDays) return W.dateNear;
  if (days <= W.dateWideDays) return W.dateWide;
  if (recurringLike && lineDate.slice(0, 7) === candDate.slice(0, 7)) return W.dateSameMonth;
  return 0;
}

function descriptionSimilarity(line: MatchLine, cand: DisplayTransaction): number {
  const lineTexts = [line.merchant, line.description].filter((s): s is string => !!s?.trim());
  const candTexts = [cand.description, cand.statementDescription].filter(
    (s): s is string => !!s?.trim()
  );
  let best = 0;
  for (const a of lineTexts) {
    for (const b of candTexts) {
      best = Math.max(best, tokenSimilarity(normaliseMerchant(a), normaliseMerchant(b)));
    }
  }
  return best;
}

function categoryAgrees(line: MatchLine, cand: DisplayTransaction): boolean {
  return !!line.category && line.category === cand.category;
}

/**
 * Score one line against one candidate, in [0, 1]. Returns 0 when there is no amount signal at
 * all: date, description and category agreeing on a wildly different amount is a different
 * transaction, and those three alone can clear the threshold.
 */
export function scoreCandidate(
  line: MatchLine,
  cand: DisplayTransaction,
  accountId: string
): number {
  const date = extractDatePart(cand.date);
  const recurringLike = isRecurringLike(cand);
  const amount = amountScore(line.amount, amountOnAccount(cand, accountId), recurringLike);
  if (amount === 0) return 0;
  const category = categoryAgrees(line, cand) ? MATCH_WEIGHTS.category : 0;
  const description = descriptionSimilarity(line, cand) * MATCH_WEIGHTS.description;
  const total = amount + dateScore(line.date, date, recurringLike) + description + category;
  // Round away float noise so a score sitting exactly on the threshold compares as intended.
  return Math.round(Math.min(1, total) * 10000) / 10000;
}

/** The candidate window: the statement period (else the lines' own span) padded each side. */
function windowOf(
  lines: readonly MatchLine[],
  period: MatchPeriod
): { from: string; to: string } | null {
  const dates = lines.map((l) => l.date).sort();
  const from = period.from ?? dates[0];
  const to = period.to ?? dates[dates.length - 1];
  if (!from || !to) return null;
  return {
    from: addDaysYmd(from, -MATCH_WEIGHTS.periodPadDays),
    to: addDaysYmd(to, MATCH_WEIGHTS.periodPadDays),
  };
}

/**
 * Whether `cand` may be offered to `line` at all (direction, account, window). A row from an
 * earlier import is offered only to the `possible` pass (`includeImported`).
 */
function isEligible(
  line: MatchLine,
  cand: DisplayTransaction,
  accountId: string,
  window: { from: string; to: string },
  includeImported: boolean
): boolean {
  if (cand.type === 'balance_adjustment') return false;
  if (cand.importFingerprint && !includeImported) return false;
  if (directionOnAccount(cand, accountId) !== line.direction) return false;
  const date = extractDatePart(cand.date);
  if (date < window.from || date > window.to) return false;
  // A projection needs no month restriction: a merge into one records the due date it stands
  // for (`recurringDueDate`), which is what every dedupe site reads (`utils/recurringInstance`).
  return true;
}

/** Whether two `YYYY-MM-DD` ranges share at least one day. */
function overlaps(a: { from: string; to: string }, b: { from: string; to: string }): boolean {
  return a.from <= b.to && b.from <= a.to;
}

/**
 * A `possible` duplicate, at most `possibleDays` apart, when either:
 *  (a) the amount is close and one more thing agrees: a shared word, the category, or the month;
 *  (b) the amount is within `amountLoosePct` and the descriptions are clearly similar.
 * A row from an earlier import whose period does not overlap this statement's is never one.
 */
function possibleRule(
  line: MatchLine,
  cand: DisplayTransaction,
  accountId: string,
  period: MatchPeriod
): PossibleRule | null {
  const W = MATCH_WEIGHTS;
  if (
    cand.importPeriod &&
    period.from &&
    period.to &&
    !overlaps(cand.importPeriod, { from: period.from, to: period.to })
  ) {
    return null;
  }
  const date = extractDatePart(cand.date);
  if (daysBetween(line.date, date) > W.possibleDays) return null;
  const lineAmount = line.amount;
  const candAmount = amountOnAccount(cand, accountId);
  // The cheap checks first: description similarity is only computed for a pair whose amount and
  // date already qualify (it is the costly part over a large ledger).
  if (amountScore(lineAmount, candAmount, false) >= W.amountClose) {
    const agrees =
      line.date.slice(0, 7) === date.slice(0, 7) ||
      categoryAgrees(line, cand) ||
      descriptionSimilarity(line, cand) > 0;
    return agrees ? 'close' : null;
  }
  const loose = Math.abs(round2(lineAmount) - round2(candAmount));
  if (loose > Math.max(Math.abs(lineAmount), Math.abs(candAmount)) * W.amountLoosePct) return null;
  return descriptionSimilarity(line, cand) >= W.possibleLooseSimilarity ? 'similar' : null;
}

/** Whether the dates agree enough for a FAMILIAR match (see FAMILIAR_THRESHOLD). */
function datesAgree(line: MatchLine, cand: DisplayTransaction): boolean {
  return dateScore(line.date, extractDatePart(cand.date), isRecurringLike(cand)) > 0;
}

/**
 * Match every line against the candidates on `accountId`. Returns one entry per line (aligned
 * with `lines`): a familiar or possible match, or null. Two greedy passes by descending score
 * (ties: closer date, then input order), familiar first; one candidate per line and one line per
 * candidate across BOTH passes, so a possible match never claims a row a familiar one took.
 *
 * `candidates` may contain rows from any account plus projections; the eligibility rules pick
 * the relevant ones. Callers pass only the lines that still need matching (the planner leaves
 * already-imported lines out).
 */
export function matchLines(
  lines: readonly MatchLine[],
  candidates: readonly DisplayTransaction[],
  period: MatchPeriod,
  accountId: string
): (FamiliarMatch | null)[] {
  const result: (FamiliarMatch | null)[] = lines.map(() => null);
  const window = windowOf(lines, period);
  if (!window) return result;

  const claimed = new Set<number>();
  const assign = (strength: MatchStrength) => {
    const pairs: {
      li: number;
      ci: number;
      score: number;
      days: number;
      rule?: PossibleRule;
      strong?: boolean;
    }[] = [];
    lines.forEach((line, li) => {
      if (result[li]) return;
      candidates.forEach((cand, ci) => {
        if (claimed.has(ci)) return;
        if (!isEligible(line, cand, accountId, window, strength === 'possible')) return;
        const days = daysBetween(line.date, cand.date);
        if (strength === 'familiar') {
          const score = scoreCandidate(line, cand, accountId);
          if (score >= FAMILIAR_THRESHOLD && datesAgree(line, cand)) {
            pairs.push({ li, ci, score, days });
          }
          return;
        }
        const rule = possibleRule(line, cand, accountId, period);
        if (!rule) return;
        const score = scoreCandidate(line, cand, accountId);
        const strong = score >= FAMILIAR_THRESHOLD && datesAgree(line, cand);
        pairs.push({ li, ci, score, days, rule, strong });
      });
    });
    pairs.sort((a, b) => b.score - a.score || a.days - b.days || a.li - b.li || a.ci - b.ci);
    for (const p of pairs) {
      if (result[p.li] || claimed.has(p.ci)) continue;
      claimed.add(p.ci);
      result[p.li] = toMatch(candidates[p.ci]!, p.score, strength, p.rule, p.strong);
    }
  };
  assign('familiar');
  assign('possible');
  return result;
}

function toMatch(
  existing: DisplayTransaction,
  score: number,
  strength: MatchStrength,
  rule?: PossibleRule,
  strong?: boolean
): FamiliarMatch {
  return {
    strength,
    existingImported: !!existing.importFingerprint,
    ...(rule ? { possibleRule: rule } : {}),
    ...(strong ? { strong: true } : {}),
    id: existing.id,
    isProjected: !!existing.isProjected,
    ...(existing.recurringItemId ? { recurringItemId: existing.recurringItemId } : {}),
    ...(existing.isProjected ? { dueDate: extractDatePart(existing.date) } : {}),
    existing,
    score,
  };
}
