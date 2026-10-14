import { describe, it, expect } from 'vitest';
import committed from '../../data/store-proof.json';
import {
  appStoreCount,
  fiveStarTotal,
  mergeStoreProof,
  parseAppStoreListing,
  parsePlayListing,
  parseStoreProof,
  rateAppStore,
  type StoreProof,
  type StorefrontScan,
} from '../storeProof';

const base = (): StoreProof => parseStoreProof(structuredClone(committed));

const withPatch = (patch: (p: Record<string, any>) => void) => {
  const p: Record<string, any> = structuredClone(committed);
  patch(p);
  return p;
};

describe('parseStoreProof: shape only', () => {
  it('accepts the committed file', () => {
    expect(() => parseStoreProof(committed)).not.toThrow();
    expect(appStoreCount(base())).toBe(10);
  });

  it('throws naming the field, with the refresh command', () => {
    expect(() => parseStoreProof(withPatch((p) => (p.googlePlay.ratingCount = -1)))).toThrow(
      /googlePlay\.ratingCount.*node web\/scripts\/store-proof\.mjs/
    );
    expect(() => parseStoreProof(withPatch((p) => (p.appStore.storefronts.us = 1.5)))).toThrow(
      /appStore\.storefronts\.us/
    );
    expect(() => parseStoreProof(withPatch((p) => delete p.googlePlay))).toThrow(
      /googlePlay is missing/
    );
    expect(() => parseStoreProof(withPatch((p) => delete p.appStore))).toThrow(
      /appStore is missing/
    );
    expect(() => parseStoreProof(withPatch((p) => (p.appStore.rating = 5.1)))).toThrow(
      /appStore\.rating/
    );
    expect(() => parseStoreProof(withPatch((p) => (p.appStore.rating = -0.1)))).toThrow(
      /appStore\.rating/
    );
    expect(() => parseStoreProof(withPatch((p) => (p.appStore.fetchedAt = 'yesterday')))).toThrow(
      /appStore\.fetchedAt/
    );
    expect(() => parseStoreProof(withPatch((p) => (p.googlePlay.source = 'api')))).toThrow(
      /googlePlay\.source/
    );
  });

  it('does not judge the rating: a 4.9 average is a valid file', () => {
    expect(() => parseStoreProof(withPatch((p) => (p.appStore.rating = 4.9)))).not.toThrow();
  });
});

describe('fiveStarTotal: the claim', () => {
  it('is 15 for the committed file', () => {
    expect(fiveStarTotal(base())).toBe(15);
  });

  it('is 0 when the App Store average is below 5 with ratings present', () => {
    expect(fiveStarTotal(parseStoreProof(withPatch((p) => (p.appStore.rating = 4.9))))).toBe(0);
  });

  it('is the Play count alone when there are no storefront ratings', () => {
    const p = parseStoreProof(
      withPatch((x) => {
        x.appStore.storefronts = {};
        x.appStore.rating = 0;
      })
    );
    expect(fiveStarTotal(p)).toBe(5);
  });
});

// Saved from https://apps.apple.com/us/app/id6798513944 on 2026-10-14 (trimmed).
// The "similar apps" shelf carries other apps' counts as QUOTED strings.
const US_LISTING =
  '"items":[{"$kind":"Badge","type":"rating","key":"rating","content":{"rating":5,"ratingFormatted":"5.0","ratingCount":4},"heading":"4 Ratings","caption":"4 Ratings","longCaption":"5.0, 4 Ratings"}]' +
  '"bundleId":"Unshackled-Pursuit.Waypoint","isEditorsChoice":false,"rating":5,"ratingCount":"1","decorations":[]' +
  '"items":[{"$kind":"Ratings","productId":"6798513944","ratingAverage":5,"totalNumberOfRatings":4,"context":"productPage","ratingCounts":[4,0,0,0,0]}]';
// Saved from https://apps.apple.com/fr/app/id6798513944 on 2026-10-14: a listing nobody has rated.
const UNRATED_LISTING =
  '"bundleId":"com.aren.app","rating":0,"ratingCount":"0","decorations":[]' +
  '"items":[{"$kind":"Ratings","productId":"6798513944","ratingAverage":0,"totalNumberOfRatings":0,"context":"productPage","ratingCounts":[0,0,0,0,0]}]';

describe('parseAppStoreListing', () => {
  it('reads the US listing', () => {
    expect(parseAppStoreListing(US_LISTING)).toEqual({ rating: 5, ratingCount: 4, exact: true });
  });

  it('reads the badge alone, with a comma decimal, as a rounded (not exact) average', () => {
    expect(
      parseAppStoreListing('"content":{"rating":5,"ratingFormatted":"4,7","ratingCount":12}')
    ).toEqual({ rating: 4.7, ratingCount: 12, exact: false });
    expect(
      parseAppStoreListing('"content":{"rating":5,"ratingFormatted":"5.0","ratingCount":3}')
    ).toEqual({ rating: 5, ratingCount: 3, exact: false });
  });

  it('reports an unrated listing as a legitimate zero', () => {
    expect(parseAppStoreListing(UNRATED_LISTING)).toEqual({
      rating: null,
      ratingCount: 0,
      exact: false,
    });
  });

  it('returns nulls for a page in neither shape', () => {
    expect(parseAppStoreListing('')).toEqual({ rating: null, ratingCount: null, exact: false });
    expect(parseAppStoreListing('<html><body>"ratingCount":"7"</body></html>')).toEqual({
      rating: null,
      ratingCount: null,
      exact: false,
    });
  });
});

// The per-star bars as Play renders them on a rated listing (checked 2026-10-14).
const bar = (n: string, star: number) =>
  `<div class="JzwBgb" role="img" aria-label="${n} reviews for star rating ${star}"><div aria-hidden="true" class="Qjdn7d">${star}</div></div>`;
const PLAY_HISTOGRAM = [bar('1,203', 5), bar('48', 4), bar('7', 3), bar('0', 2), bar('2', 1)].join(
  ''
);
// Today's family.beanies.app listing (2026-10-14): no aggregate below Play's threshold.
// Other apps' cards on the same page carry "Rated N stars" labels, which must not count.
const PLAY_TODAY =
  '<h1><span class="AfwdI" itemprop="name">beanies.family</span></h1>' +
  '<div class="wVqUob"><div class="ClM7O">10+</div><div class="g1rdde">Downloads</div></div>' +
  '<div aria-label="Rated 4.7 stars out of five stars" role="img"></div>';

describe('parsePlayListing', () => {
  it('returns the five-star bar when all five bars are present', () => {
    expect(parsePlayListing(PLAY_HISTOGRAM)).toEqual({ ratingCount: 1203 });
  });

  it('returns null on the listing as it is today', () => {
    expect(parsePlayListing(PLAY_TODAY)).toBeNull();
  });

  it('returns null for a partial or duplicated histogram', () => {
    expect(parsePlayListing([bar('5', 5), bar('0', 4)].join(''))).toBeNull();
    expect(parsePlayListing(PLAY_HISTOGRAM + bar('9', 5))).toBeNull();
  });
});

const emptyScan = (over: Partial<StorefrontScan> = {}): StorefrontScan => ({
  counts: {},
  ratings: {},
  badges: {},
  failed: [],
  unparsed: [],
  empty: [],
  ...over,
});
const TODAY = '2026-11-01';
/** Most cases only look at the file; the summary fields get their own tests. */
const mergeNext = (o: Parameters<typeof mergeStoreProof>[0]) => mergeStoreProof(o).next;

describe('mergeStoreProof', () => {
  const fullScan = emptyScan({
    counts: { us: 4, sg: 2, jp: 2, de: 1, gb: 1 },
    ratings: { us: 5, sg: 5, jp: 5, de: 5, gb: 5 },
    empty: ['fr', 'it'],
  });

  it('keeps the previous Play half when the listing has no histogram and no override is given', () => {
    const next = mergeNext({
      previous: base(),
      scan: fullScan,
      play: null,
      playOverride: null,
      today: TODAY,
    });
    expect(next.googlePlay).toEqual(base().googlePlay);
    expect(fiveStarTotal(next)).toBe(15);
  });

  it('unchanged scan keeps fetchedAt', () => {
    const prev = base();
    const same = mergeNext({
      previous: prev,
      scan: fullScan,
      play: null,
      playOverride: null,
      today: TODAY,
    });
    expect(same.appStore.fetchedAt).toBe(prev.appStore.fetchedAt);
    expect(same.googlePlay.fetchedAt).toBe(prev.googlePlay.fetchedAt);
    // a changed storefront count moves only the App Store date
    const more = mergeNext({
      previous: prev,
      scan: emptyScan({
        counts: { ...fullScan.counts, us: 5 },
        ratings: fullScan.ratings,
        empty: fullScan.empty,
      }),
      play: null,
      playOverride: null,
      today: TODAY,
    });
    expect(more.appStore.fetchedAt).toBe(TODAY);
    expect(more.googlePlay.fetchedAt).toBe(prev.googlePlay.fetchedAt);
  });

  it('an override restating the current Play count still stamps today (a confirmation act)', () => {
    const prev = base();
    const next = mergeNext({
      previous: prev,
      scan: fullScan,
      play: null,
      playOverride: prev.googlePlay.ratingCount,
      today: TODAY,
    });
    expect(next.googlePlay).toEqual({
      ratingCount: prev.googlePlay.ratingCount,
      source: 'confirmed',
      fetchedAt: TODAY,
    });
    // the App Store half, unchanged, still keeps its date
    expect(next.appStore.fetchedAt).toBe(prev.appStore.fetchedAt);
  });

  it('an unchanged listing value keeps its date', () => {
    const prev = parseStoreProof(withPatch((p) => (p.googlePlay.source = 'listing')));
    const next = mergeNext({
      previous: prev,
      scan: fullScan,
      play: { ratingCount: prev.googlePlay.ratingCount },
      playOverride: null,
      today: TODAY,
    });
    expect(next.googlePlay.fetchedAt).toBe(prev.googlePlay.fetchedAt);
  });

  it('applies the override as a confirmed value', () => {
    const next = mergeNext({
      previous: base(),
      scan: fullScan,
      play: null,
      playOverride: 7,
      today: TODAY,
    });
    expect(next.googlePlay).toEqual({ ratingCount: 7, source: 'confirmed', fetchedAt: TODAY });
  });

  it('prefers the listing over the override', () => {
    const next = mergeNext({
      previous: base(),
      scan: fullScan,
      play: { ratingCount: 9 },
      playOverride: 7,
      today: TODAY,
    });
    expect(next.googlePlay).toEqual({ ratingCount: 9, source: 'listing', fetchedAt: TODAY });
  });

  it("carries a failed storefront's previous count and drops an empty one", () => {
    const previous = parseStoreProof(withPatch((p) => (p.appStore.storefronts.fr = 3)));
    const scan = emptyScan({
      counts: { us: 4, sg: 2, jp: 2, gb: 1 },
      ratings: { us: 5, sg: 5, jp: 5, gb: 5 },
      failed: ['de', 'it'],
      empty: ['fr'],
    });
    const next = mergeNext({ previous, scan, play: null, playOverride: null, today: TODAY });
    expect(next.appStore.storefronts).toEqual({ us: 4, jp: 2, sg: 2, de: 1, gb: 1 });
    expect(next.appStore.storefronts).not.toHaveProperty('fr');
    expect(next.appStore.storefronts).not.toHaveProperty('it');
  });

  it("carries an unparsed storefront's previous count like a failed one", () => {
    const scan = emptyScan({
      counts: { us: 4, sg: 2, jp: 2, gb: 1 },
      ratings: { us: 5, sg: 5, jp: 5, gb: 5 },
      unparsed: ['de', 'xk'],
    });
    const next = mergeNext({
      previous: base(),
      scan,
      play: null,
      playOverride: null,
      today: TODAY,
    });
    expect(next.appStore.storefronts).toEqual({ us: 4, jp: 2, sg: 2, de: 1, gb: 1 });
    expect(next.appStore.storefronts).not.toHaveProperty('xk');
  });

  it('writes storefronts in a stable order (count, then code)', () => {
    const next = mergeNext({
      previous: base(),
      scan: fullScan,
      play: null,
      playOverride: null,
      today: TODAY,
    });
    expect(Object.keys(next.appStore.storefronts)).toEqual(['us', 'jp', 'sg', 'de', 'gb']);
  });

  it('computes the count-weighted mean when one storefront reports 4.0', () => {
    const scan = emptyScan({ counts: { us: 4, gb: 1 }, ratings: { us: 5, gb: 4 } });
    const next = mergeNext({
      previous: base(),
      scan,
      play: null,
      playOverride: null,
      today: TODAY,
    });
    expect(next.appStore.rating).toBe(4.8);
    expect(fiveStarTotal(next)).toBe(0);
  });

  it('never rounds a not-quite-five average up to 5', () => {
    const scan = emptyScan({ counts: { us: 99, gb: 1 }, ratings: { us: 5, gb: 4.6 } });
    const next = mergeNext({
      previous: base(),
      scan,
      play: null,
      playOverride: null,
      today: TODAY,
    });
    expect(next.appStore.rating).toBe(4.9);
  });

  it('fails closed: a storefront with no exact average keeps the previous rating', () => {
    // A badge "5.0" is rounded (it could be 4.96), so it cannot establish the all-5 claim.
    const previous = parseStoreProof(withPatch((p) => (p.appStore.rating = 4.9)));
    const scan = emptyScan({
      counts: { us: 4, de: 1, fr: 1 },
      ratings: { us: 5 },
      badges: { de: 5 },
    });
    expect(rateAppStore({ previous, scan })).toEqual({
      rating: 4.9,
      unverified: ['de', 'fr'],
      basis: 'previous',
    });
    const next = mergeNext({ previous, scan, play: null, playOverride: null, today: TODAY });
    expect(next.appStore.rating).toBe(4.9);
    expect(fiveStarTotal(next)).toBe(0);
    // with a 5.0 previous file the rating stays 5, but the storefronts are still named
    expect(rateAppStore({ previous: base(), scan }).unverified).toEqual(['de', 'fr']);
  });

  it('fails closed on a carried storefront: it was not read this run', () => {
    const previous = parseStoreProof(withPatch((p) => (p.appStore.rating = 4.8)));
    const scan = emptyScan({
      counts: { us: 4, sg: 2, jp: 2, gb: 1 },
      ratings: { us: 5, sg: 5, jp: 5, gb: 5 },
      failed: ['de'],
    });
    expect(rateAppStore({ previous, scan })).toEqual({
      rating: 4.8,
      unverified: ['de'],
      basis: 'previous',
    });
  });

  it('a badge average below 5 still withdraws the claim, naming the badge-only storefront', () => {
    const scan = emptyScan({ counts: { us: 4, de: 1 }, ratings: { us: 5 }, badges: { de: 4 } });
    expect(rateAppStore({ previous: base(), scan })).toEqual({
      rating: 4.8,
      unverified: ['de'],
      basis: 'mean',
    });
  });

  it('a below-5 mean covers the averaged storefronts only, and names the rest', () => {
    // us exact 5, gb exact 4, fr counted with no average, de carried (failed): the mean is
    // over us + gb alone (4.8), and fr + de are reported as unverified.
    const scan = emptyScan({
      counts: { us: 4, gb: 1, fr: 3 },
      ratings: { us: 5, gb: 4 },
      failed: ['de'],
    });
    expect(rateAppStore({ previous: base(), scan })).toEqual({
      rating: 4.8,
      unverified: ['de', 'fr'],
      basis: 'mean',
    });
  });

  it('every contributing storefront exact at 5 sets 5 with nothing unverified', () => {
    const previous = parseStoreProof(withPatch((p) => (p.appStore.rating = 4.9)));
    expect(rateAppStore({ previous, scan: fullScan })).toEqual({
      rating: 5,
      unverified: [],
      basis: 'exact',
    });
  });

  it('returns the carried codes and the rating decision for the summary', () => {
    const scan = emptyScan({
      counts: { us: 4, sg: 2, jp: 2, gb: 1 },
      ratings: { us: 5, sg: 5, jp: 5, gb: 5 },
      failed: ['de', 'it'],
      unparsed: ['xk'],
    });
    const out = mergeStoreProof({
      previous: base(),
      scan,
      play: null,
      playOverride: null,
      today: TODAY,
    });
    expect(out.carried).toEqual(['de']);
    expect(out.rating).toEqual({ rating: 5, unverified: ['de'], basis: 'previous' });
    expect(out.next.appStore.storefronts).toHaveProperty('de', 1);
  });

  it('a hand-ordered previous file with the same counts keeps its date', () => {
    const previous = parseStoreProof(
      withPatch((p) => (p.appStore.storefronts = { gb: 1, de: 1, us: 4, sg: 2, jp: 2 }))
    );
    const next = mergeNext({
      previous,
      scan: fullScan,
      play: null,
      playOverride: null,
      today: TODAY,
    });
    expect(next.appStore.fetchedAt).toBe(previous.appStore.fetchedAt);
    expect(Object.keys(next.appStore.storefronts)).toEqual(['us', 'jp', 'sg', 'de', 'gb']);
  });

  it('falls back to the previous rating when no average parsed', () => {
    const previous = parseStoreProof(withPatch((p) => (p.appStore.rating = 4.5)));
    const scan = emptyScan({ counts: { us: 4 } });
    const next = mergeNext({ previous, scan, play: null, playOverride: null, today: TODAY });
    expect(next.appStore.rating).toBe(4.5);
  });

  it('always produces a file parseStoreProof accepts', () => {
    const next = mergeNext({
      previous: base(),
      scan: fullScan,
      play: null,
      playOverride: 3,
      today: TODAY,
    });
    expect(parseStoreProof(next)).toEqual(next);
  });
});
