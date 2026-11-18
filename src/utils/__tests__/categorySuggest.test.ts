/**
 * The category guess composition (`categorySuggest.ts`): the occasion matcher first, with its
 * veto and precedence untouched, then each area's own table. The keyword lists themselves are
 * pinned by `constants/__tests__/categoryKeywords.test.ts`.
 */
import { describe, it, expect, vi } from 'vitest';

// A tiny transaction table, so the direction rule is pinned whatever the real lists hold: the
// same word ("rent") names a different category in each direction.
vi.mock('@/constants/categories', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/constants/categories')>();
  const def = (id: string, type: 'income' | 'expense', keywords: string[], weak?: string[]) => ({
    id,
    name: id,
    icon: '',
    type,
    color: '',
    keywords,
    weakKeywords: weak,
  });
  return {
    ...real,
    INCOME_CATEGORIES: [
      def('rental', 'income', ['rent', 'tenant']),
      def('salary', 'income', ['payroll']),
    ],
    EXPENSE_CATEGORIES: [
      def('rent', 'expense', ['rent', 'mortgage']),
      def('groceries', 'expense', ['supermarket'], ['food']),
      def('dining_out', 'expense', ['restaurant']),
    ],
  };
});

import { suggestActivityCategory, suggestTransactionCategory } from '@/utils/categorySuggest';
import { ACTIVITY_CATEGORIES } from '@/constants/activityCategories';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from '@/constants/categories';

describe('suggestActivityCategory', () => {
  it('asks the occasion matcher first, and names the occasion word that matched', () => {
    expect(suggestActivityCategory("Mia's birthday")).toEqual({
      value: 'occasion_birthday',
      word: 'birthday',
    });
    // "dinner" names Dining Out, but the occasion wins.
    expect(suggestActivityCategory('Anniversary dinner')).toEqual({
      value: 'anniversary',
      word: 'anniversary',
    });
    expect(suggestActivityCategory('奶奶生日')).toEqual({
      value: 'occasion_birthday',
      word: '生日',
    });
  });

  it('a vetoed occasion falls through to the activity table (a birthday party is a party)', () => {
    expect(suggestActivityCategory("Mia's birthday party")).toEqual({
      value: 'birthday',
      word: 'birthday',
    });
  });

  it('remembrance keeps its precedence over a birthday', () => {
    expect(suggestActivityCategory("Grandma's birthday, in memory")?.value).toBe('remembrance');
  });

  it('otherwise uses the activity keywords and returns the matched word', () => {
    expect(suggestActivityCategory('Softball practice')).toEqual({
      value: 'softball',
      word: 'softball',
    });
  });

  it('a weak word only counts when nothing specific is there', () => {
    expect(suggestActivityCategory('Big game')?.value).toBe('sporting_event');
    expect(suggestActivityCategory('Tennis match')?.value).toBe('tennis');
  });

  it('returns undefined for no match and for empty text', () => {
    expect(suggestActivityCategory('Catch-up')).toBeUndefined();
    expect(suggestActivityCategory('')).toBeUndefined();
    expect(suggestActivityCategory('   ')).toBeUndefined();
  });

  it('only ever suggests a real activity category', () => {
    const ids = new Set<string>(ACTIVITY_CATEGORIES.map((c) => c.id));
    for (const def of ACTIVITY_CATEGORIES) {
      for (const word of [...def.keywords, ...(def.weakKeywords ?? [])]) {
        const hit = suggestActivityCategory(word);
        expect(hit && ids.has(hit.value)).toBe(true);
      }
    }
  });
});

describe('suggestTransactionCategory', () => {
  it('the same word names a different category in each direction', () => {
    expect(suggestTransactionCategory('Rent', 'expense')).toEqual({ value: 'rent', word: 'rent' });
    expect(suggestTransactionCategory('Rent', 'income')).toEqual({ value: 'rental', word: 'rent' });
    expect(suggestTransactionCategory('Payroll', 'expense')).toBeUndefined();
    expect(suggestTransactionCategory('Payroll', 'income')?.value).toBe('salary');
  });

  it('a weak word is searchable but never guessed: only strong words name a transaction', () => {
    // "food" is a weak word on groceries: on its own it names nothing, beside a strong word it
    // does not vote. A wrong guess would put money in the wrong budget line.
    expect(suggestTransactionCategory('Food', 'expense')).toBeUndefined();
    expect(suggestTransactionCategory('Supermarket food', 'expense')?.value).toBe('groceries');
    expect(suggestTransactionCategory('Restaurant food', 'expense')?.value).toBe('dining_out');
  });

  it('reads only the table for the direction', () => {
    const income = new Set<string>(INCOME_CATEGORIES.map((c) => c.id));
    const expense = new Set<string>(EXPENSE_CATEGORIES.map((c) => c.id));
    for (const def of INCOME_CATEGORIES) {
      for (const word of def.keywords) {
        expect(income.has(suggestTransactionCategory(word, 'income')!.value)).toBe(true);
      }
    }
    for (const def of EXPENSE_CATEGORIES) {
      for (const word of def.keywords) {
        expect(expense.has(suggestTransactionCategory(word, 'expense')!.value)).toBe(true);
      }
    }
  });

  it('returns undefined for no match and for empty text', () => {
    expect(suggestTransactionCategory('zzz', 'expense')).toBeUndefined();
    expect(suggestTransactionCategory('', 'income')).toBeUndefined();
  });
});
