/**
 * The errand suppressor's verb inflections (#78 review).
 *
 * The old list concatenated suffixes onto the base, so "wrap" produced
 * wrap/wraps/wraped/wraping/wrapd and never "wrapping". Most of the errand verbs are
 * doubled-consonant or e-final, so the suppressor silently failed for the majority of its
 * own list — and the verdict still reported `rule: 'keyword'`, making the miss invisible.
 *
 * Every case below is a gerund the old code could not match. Each pairs an errand verb
 * with a celebration KEYWORD, so a failure to suppress is a false celebration, not a
 * neutral result.
 */
import { describe, it, expect } from 'vitest';
import { isCelebrationActivity } from '@/utils/activityCelebration';
import type { ActivityCategory } from '@/types/models';

// `'other_activity'` stands in for "a category that is not a celebration", matching the
// sibling suite — so every verdict below is driven by the TITLE, which is the point.
const errand = (title: string) =>
  isCelebrationActivity({ title, category: 'other_activity' as ActivityCategory });

describe('errand-verb suppression across English inflections', () => {
  it.each([
    ['Wrapping birthday presents', 'doubled consonant'],
    ["Planning Mia's birthday", 'doubled consonant'],
    ['Shopping for the wedding', 'doubled consonant'],
    ['Preparing the anniversary dinner', 'dropped silent -e'],
    ["Organising Leo's graduation", 'dropped silent -e'],
  ])('suppresses %s (%s)', (title) => {
    const verdict = errand(title);
    expect(verdict.celebrating).toBe(false);
    expect(verdict.suppressed).toBe('errand-verb');
  });

  it('still suppresses the plain and regular forms it always did', () => {
    for (const title of ['Book the birthday venue', 'Booked the wedding car', 'Books a party']) {
      expect(errand(title).celebrating).toBe(false);
    }
  });

  /**
   * The other half of the contract. Over-generating forms is only acceptable while it
   * cannot swallow a real celebration, and the head-token match is what keeps that true:
   * "Booker" is not any inflection of "book".
   */
  it('does NOT suppress a title that merely begins with a verb’s letters', () => {
    expect(errand('Booker family wedding').celebrating).toBe(true);
    expect(errand("Payton's birthday").celebrating).toBe(true);
  });

  it('a celebration with no errand verb is untouched', () => {
    const verdict = errand("Mia's birthday party");
    expect(verdict.celebrating).toBe(true);
    expect(verdict.suppressed).toBeNull();
  });
});
