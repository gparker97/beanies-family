import { describe, it, expect } from 'vitest';
import {
  decideFeedbackPrompt,
  npsBand,
  FEEDBACK_MIN_ACCOUNT_AGE_MS,
  FEEDBACK_INTERVAL_MS,
} from '../feedbackCadence';

const NOW = 1_700_000_000_000;
const iso = (ms: number) => new Date(ms).toISOString();

// A comfortably-old account (30 days) so the age gate passes unless overridden.
const OLD_ACCOUNT = iso(NOW - 30 * 24 * 60 * 60 * 1000);

describe('decideFeedbackPrompt', () => {
  it('returns false when opted out (even if otherwise due)', () => {
    expect(decideFeedbackPrompt({ optOut: true, accountCreatedAt: OLD_ACCOUNT }, NOW)).toBe(false);
  });

  it('returns false when accountCreatedAt is missing (fails closed)', () => {
    expect(decideFeedbackPrompt({ optOut: false }, NOW)).toBe(false);
  });

  it('returns false for an account younger than the age gate', () => {
    const young = iso(NOW - (FEEDBACK_MIN_ACCOUNT_AGE_MS - 1000));
    expect(decideFeedbackPrompt({ optOut: false, accountCreatedAt: young }, NOW)).toBe(false);
  });

  it('returns true at exactly the age gate with no prior prompt', () => {
    const exactly = iso(NOW - FEEDBACK_MIN_ACCOUNT_AGE_MS);
    expect(decideFeedbackPrompt({ optOut: false, accountCreatedAt: exactly }, NOW)).toBe(true);
  });

  it('returns false within the interval since the last prompt', () => {
    const last = iso(NOW - (FEEDBACK_INTERVAL_MS - 1000));
    expect(
      decideFeedbackPrompt(
        { optOut: false, accountCreatedAt: OLD_ACCOUNT, lastPromptedAt: last },
        NOW
      )
    ).toBe(false);
  });

  it('returns true at exactly the interval boundary since the last prompt', () => {
    const last = iso(NOW - FEEDBACK_INTERVAL_MS);
    expect(
      decideFeedbackPrompt(
        { optOut: false, accountCreatedAt: OLD_ACCOUNT, lastPromptedAt: last },
        NOW
      )
    ).toBe(true);
  });

  it('returns true when eligible and never prompted before', () => {
    expect(decideFeedbackPrompt({ optOut: false, accountCreatedAt: OLD_ACCOUNT }, NOW)).toBe(true);
  });

  it('fails closed on an unparseable accountCreatedAt', () => {
    expect(decideFeedbackPrompt({ optOut: false, accountCreatedAt: 'not-a-date' }, NOW)).toBe(
      false
    );
  });
});

describe('npsBand', () => {
  it.each([
    [0, 'detractor'],
    [6, 'detractor'],
    [7, 'passive'],
    [8, 'passive'],
    [9, 'promoter'],
    [10, 'promoter'],
  ] as const)('score %i → %s', (score, band) => {
    expect(npsBand(score)).toBe(band);
  });
});
