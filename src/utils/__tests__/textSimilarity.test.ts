import { describe, it, expect } from 'vitest';
import { tokenSimilarity } from '../textSimilarity';
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
