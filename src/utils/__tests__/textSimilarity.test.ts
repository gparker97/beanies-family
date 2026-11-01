import { describe, it, expect } from 'vitest';
import { containsPhrase, tokenSimilarity, wordTokenList } from '../textSimilarity';
import { titleSimilarity } from '../activityDuplicate';

describe('tokenSimilarity', () => {
  it('is 1 for equal token sets regardless of case and punctuation', () => {
    expect(tokenSimilarity('Piano Lesson', 'piano lesson!')).toBe(1);
  });

  it('is 0 when either side has no tokens', () => {
    expect(tokenSimilarity('', 'piano')).toBe(0);
    expect(tokenSimilarity('!!!', 'piano')).toBe(0);
  });

  it('is the Jaccard ratio of word tokens', () => {
    // {home, loan} vs {home, loan, payment}: 2 / 3
    expect(tokenSimilarity('home loan', 'Home Loan Payment')).toBeCloseTo(2 / 3);
  });

  it('is 0 for disjoint strings', () => {
    expect(tokenSimilarity('grocery store', 'petrol station')).toBe(0);
  });

  it('is what activityDuplicate.titleSimilarity aliases', () => {
    expect(titleSimilarity).toBe(tokenSimilarity);
  });
});

describe('wordTokenList', () => {
  it('lowercases and splits on anything that is not a letter or digit, in order', () => {
    expect(wordTokenList("Uncle Bob's 60th, BIRTHDAY!")).toEqual([
      'uncle',
      'bob',
      's',
      '60th',
      'birthday',
    ]);
  });
});

describe('containsPhrase', () => {
  it('matches whole words and phrases, case-insensitively, on raw text', () => {
    expect(containsPhrase("Uncle Bob's BIRTHDAY", 'birthday')).toBe(true);
    expect(containsPhrase('In Memory of Grandma', 'in memory')).toBe(true);
    expect(containsPhrase('Memorial Day BBQ', 'Memorial Day')).toBe(true);
  });

  it('never matches inside a word', () => {
    expect(containsPhrase('partygoer', 'party')).toBe(false);
    expect(containsPhrase('Amelia', 'Mia')).toBe(false);
    expect(containsPhrase('memory lane walk', 'in memory')).toBe(false);
  });

  it('falls back to a substring test for CJK needles', () => {
    expect(containsPhrase('结婚十周年', '周年')).toBe(true);
    expect(containsPhrase('生日派对', '派对')).toBe(true);
  });

  it('is false for an empty needle', () => {
    expect(containsPhrase('anything', '')).toBe(false);
    expect(containsPhrase('anything', '!!')).toBe(false);
  });
});
