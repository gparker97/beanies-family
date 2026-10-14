import { describe, it, expect } from 'vitest';
import { STORE_URL } from '@beanies/brand/nav';
import { PROOF_LISTING_URL, PROOF_QUOTES, proofQuote, type ProofId } from '../proof';
import { APP_STORE_ID, PLAY_PACKAGE } from '../storeProof';

describe('proof quotes: one honest dataset', () => {
  it('has ten quotes with unique ids', () => {
    expect(PROOF_QUOTES).toHaveLength(10);
    expect(new Set(PROOF_QUOTES.map((q) => q.id)).size).toBe(PROOF_QUOTES.length);
  });

  it('every hook is a verbatim substring of its quote, 2-5 words', () => {
    for (const q of PROOF_QUOTES) {
      expect(q.text, q.id).toContain(q.hook);
      const words = q.hook.trim().split(/\s+/).length;
      expect(words, q.id).toBeGreaterThanOrEqual(2);
      expect(words, q.id).toBeLessThanOrEqual(5);
    }
  });

  it('never quotes the excluded App Store review', () => {
    expect(JSON.stringify(PROOF_QUOTES).toLowerCase()).not.toContain('sofialanyu');
  });

  it('every email quote has consent granted and no stars; every store quote is public and five-star', () => {
    for (const q of PROOF_QUOTES) {
      if (q.source === 'email') {
        expect(q.consent, q.id).toBe('granted');
        expect(q.stars, q.id).toBeNull();
      } else {
        expect(q.consent, q.id).toBe('public');
        expect(q.stars, q.id).toBe(5);
      }
    }
  });

  it('never stores an email address', () => {
    expect(JSON.stringify(PROOF_QUOTES)).not.toMatch(/[^\s@"]+@[^\s@"]+\.[a-z]{2,}/i);
  });

  it('proofQuote finds by id and throws on an unknown id', () => {
    expect(proofQuote('ummu-plan-ahead').name).toBe('Ummu');
    expect(() => proofQuote('nope' as ProofId)).toThrow(/nope/);
  });
});

describe('store links derive from the one copy of the store ids', () => {
  it('listing URLs are built from STORE_URL', () => {
    const apple = PROOF_LISTING_URL['app-store'];
    const play = PROOF_LISTING_URL['google-play'];
    expect(apple.startsWith(STORE_URL.ios)).toBe(true);
    expect(new URL(apple).searchParams.get('see-all')).toBe('reviews');
    expect(play.startsWith(STORE_URL.android)).toBe(true);
    expect(new URL(play).searchParams.get('showAllReviews')).toBe('true');
  });

  it("the refresh script's ids match STORE_URL (the only reason they exist twice)", () => {
    expect(STORE_URL.ios.endsWith(`id${APP_STORE_ID}`)).toBe(true);
    expect(new URL(STORE_URL.android).searchParams.get('id')).toBe(PLAY_PACKAGE);
  });
});
