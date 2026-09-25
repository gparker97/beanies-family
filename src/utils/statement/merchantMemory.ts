// Merchant memory for statement import (#107). Pure.
//
// `normaliseMerchant` is THE one merchant normaliser: the memory keys on it, the fingerprint's
// text part falls back to it, and the matcher compares descriptions through it. Three callers,
// one definition, so "the same merchant" means the same thing everywhere.
//
// `buildMerchantMemory` is the family context the `statement` task is sent (ADR-030, 2026-09-25
// update): merchant name + category id only. Never amounts, dates, accounts or members.

import type { Transaction } from '@/types/models';
import type { ExtractionContext } from '@/services/ai/types';
import { getCategoriesByType } from '@/constants/categories';

/** Longest normalised merchant key, in characters. */
export const MERCHANT_KEY_MAX = 40;

/** Default cap on how many merchants are sent with a statement read. */
export const MERCHANT_MEMORY_MAX = 150;

/**
 * A token with two or more digits is a reference, card fragment, store number or date
 * ("#0423", "REF4412X", "12/03", "XXXX1234"), never part of the merchant's name.
 */
const REFERENCE_TOKEN = /\d.*\d/;

/**
 * Normalise a bank description or merchant name into a stable comparison key: lowercase, drop
 * reference-like tokens, strip remaining digits and punctuation (letters in any script, `&` and
 * `'` survive), collapse whitespace, trim to {@link MERCHANT_KEY_MAX} characters.
 *
 * Only letters, spaces, `&` and `'` can survive, so no fence marker or control sequence from an
 * earlier bank description can pass through this into a prompt.
 */
export function normaliseMerchant(s: string): string {
  const kept = s
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token && !REFERENCE_TOKEN.test(token))
    .join(' ');
  return kept
    .replace(/[^\p{L}&'\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MERCHANT_KEY_MAX)
    .trim();
}

type MerchantMemory = ExtractionContext['merchants'];

/**
 * The family's merchants with the category each is most often filed under, most frequent
 * merchant first, capped at `max`. Income and expense rows only: transfers and balance
 * adjustments carry no merchant. Keyed on the bank's raw text when the row was imported
 * (`statementDescription`), else the description the family typed. A category tie goes to the
 * category used most recently, so a re-filed merchant follows the family's latest choice.
 */
export function buildMerchantMemory(
  transactions: readonly Transaction[],
  {
    max = MERCHANT_MEMORY_MAX,
    exclude,
  }: {
    max?: number;
    /** Screened BEFORE the cap, so the cap counts only merchants that may be sent. */
    exclude?: (name: string) => boolean;
  } = {}
): MerchantMemory {
  interface Tally {
    total: number;
    byCategory: Map<string, { count: number; lastDate: string }>;
  }
  const tallies = new Map<string, Tally>();

  for (const tx of transactions) {
    if (tx.type !== 'income' && tx.type !== 'expense') continue;
    if (!tx.category) continue;
    const key = normaliseMerchant(tx.statementDescription ?? tx.description ?? '');
    if (!key) continue;
    let tally = tallies.get(key);
    if (!tally) {
      tally = { total: 0, byCategory: new Map() };
      tallies.set(key, tally);
    }
    tally.total++;
    const cat = tally.byCategory.get(tx.category);
    if (cat) {
      cat.count++;
      if (tx.date > cat.lastDate) cat.lastDate = tx.date;
    } else {
      tally.byCategory.set(tx.category, { count: 1, lastDate: tx.date });
    }
  }

  const rows: { name: string; category: string; total: number }[] = [];
  for (const [name, tally] of tallies) {
    let best: { id: string; count: number; lastDate: string } | null = null;
    for (const [id, c] of tally.byCategory) {
      if (!best || c.count > best.count || (c.count === best.count && c.lastDate > best.lastDate)) {
        best = { id, ...c };
      }
    }
    if (best && !exclude?.(name)) rows.push({ name, category: best.id, total: tally.total });
  }

  rows.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  return rows.slice(0, Math.max(0, max)).map(({ name, category }) => ({ name, category }));
}

/** Name tokens shorter than this are not screened (an initial). Whole tokens only, so "jo"
 *  never screens "joy". Two letters, because "Jo" and "Li" are real names. */
const MEMBER_NAME_MIN = 2;

/**
 * The ONE assembly of what a statement read is sent besides its pages (#107): the merchant
 * memory and the app's category ids. Used by the first read and by "read it anyway", so the two
 * cannot drift into sending different things.
 *
 * `memberNames` screens out any merchant whose name contains a family member's name as a whole
 * word. Merchant memory is keyed on the description the family TYPED when a row was not
 * imported, and "pocket money ben" or "tutor mrs lee" would otherwise put a child's or a
 * helper's name in every statement prompt, against ADR-030's update ("never members").
 */
export function buildStatementContext(
  transactions: readonly Transaction[],
  memberNames: readonly string[]
): ExtractionContext {
  const names = new Set(
    memberNames
      .flatMap((n) => normaliseMerchant(n).split(' '))
      .filter((token) => token.length >= MEMBER_NAME_MIN)
  );
  const merchants = buildMerchantMemory(transactions, {
    exclude: (name) => name.split(' ').some((token) => names.has(token)),
  });
  return {
    merchants,
    categories: {
      expense: getCategoriesByType('expense').map((c) => c.id),
      income: getCategoriesByType('income').map((c) => c.id),
    },
  };
}
