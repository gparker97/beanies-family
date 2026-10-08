import { describe, it, expect } from 'vitest';
import {
  FULL_BEANS_FALLBACK,
  FULL_BEANS_TOKEN,
  PRICING_FAQS,
  faqAnswerText,
  splitFaqAnswer,
} from '../pricing';

describe('pricing FAQ: the Full plan allowance is live, never hard-coded', () => {
  it('no answer states a number of magic beans a day', () => {
    for (const f of PRICING_FAQS) {
      expect(f.a, f.id).not.toMatch(
        /\b(\d+|two|three|five|ten|fifteen|twenty|twenty-five)\s+(magic beans\s+)?(a|per|each)\s+day/i
      );
    }
  });

  it('the magic-bean answer carries the live token', () => {
    const f = PRICING_FAQS.find((x) => x.id === 'one-magic-bean');
    expect(f?.a).toContain(FULL_BEANS_TOKEN);
  });

  it('structured data gets the fallback and no raw token', () => {
    for (const f of PRICING_FAQS) {
      const text = faqAnswerText(f.a);
      expect(text, f.id).not.toContain(FULL_BEANS_TOKEN);
      if (f.a.includes(FULL_BEANS_TOKEN)) expect(text).toContain(FULL_BEANS_FALLBACK);
    }
  });

  it('splits around the token, and leaves token-free answers whole', () => {
    expect(splitFaqAnswer(`a ${FULL_BEANS_TOKEN}, b`)).toEqual({ before: 'a ', after: ', b' });
    expect(splitFaqAnswer('plain')).toEqual({ before: 'plain', after: null });
  });
});
