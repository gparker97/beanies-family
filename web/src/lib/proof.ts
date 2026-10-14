/**
 * Real-user proof (#135): the ONE source of every testimonial on the marketing site.
 *
 * Every quote below is copied from its source, verbatim or lightly trimmed with an
 * ellipsis (…), never edited for meaning; typos are kept. Each entry records where
 * it came from and on what basis it may be shown:
 *   - `public`: a public App Store / Google Play review, quoted with its public nickname.
 *   - `granted`: given to us privately with explicit consent to quote it. The consent
 *     record itself (who agreed, when, how) lives in Notion; this file stores only the
 *     fact and the date, never an email address.
 *
 * One public App Store review is deliberately never quoted here (greg's decision); a
 * test pins that. Its rating is still inside the storefront count, which is the
 * store's own figure.
 *
 * A `hook` is the 2-5 word phrase shown in the handwriting face above the quote. It
 * must be a verbatim substring of `text` (tested), so the big words on the note are
 * always words the person actually wrote.
 *
 * Pages render quotes by id (`proofQuote('aashyqii-life-saver')`). Ids are the
 * `ProofId` union, so a misspelt id fails `astro check`.
 *
 * Astro/vitest only: this imports `@beanies/brand/nav`. The Node-safe half (the
 * store ids and the rating-count file) is `./storeProof.ts`.
 */
import { STORE_URL } from '@beanies/brand/nav';

export type ProofSource = 'app-store' | 'google-play' | 'email';

export interface ProofQuote {
  /** Stable kebab-case id, `<who>-<what>`. */
  id: string;
  /** Verbatim substring of `text`, 2-5 words. */
  hook: string;
  /** Verbatim; trims are marked with … */
  text: string;
  source: ProofSource;
  /** Public nickname / display name, or the first name the sender gave. */
  name: string;
  /** Shown after the name: 'App Store SG' | 'Google Play' | 'Singapore · by email'. */
  where: string;
  /** null for quotes that carry no star rating (email). */
  stars: 5 | null;
  consent: 'public' | 'granted';
  /** ISO date of the review, or of the consent. Recorded, never rendered. */
  date: string;
}

export const PROOF_QUOTES = [
  {
    id: 'aashyqii-life-saver',
    hook: 'a life saver',
    text: 'Omg this app really is a life saver.',
    source: 'app-store',
    name: 'Aashyqii',
    where: 'App Store SG',
    stars: 5,
    consent: 'public',
    date: '2026-10-10',
  },
  {
    id: 'dana-large-screen',
    hook: 'on any large screen',
    text: '…Bonus: you can open "the wall" on any large screen so everyone can see it…',
    source: 'google-play',
    name: 'Dana Stillwagon',
    where: 'Google Play',
    stars: 5,
    consent: 'public',
    date: '2026-09-16',
  },
  {
    id: 'kemi-coordinate',
    hook: 'coordinate our family finances',
    text: 'Super cute and helpful app. I use it to coordinate our family finances and schedule.',
    source: 'google-play',
    name: 'Kemi A',
    where: 'Google Play',
    stars: 5,
    consent: 'public',
    date: '2026-08-24',
  },
  {
    id: 'lcstryder-struck-gold',
    hook: 'struck gold',
    text: '…an alternative to the big names (and extortionate)… I think I’ve struck gold with Beanies!!',
    source: 'app-store',
    name: 'Lcstryder',
    where: 'App Store UK',
    stars: 5,
    consent: 'public',
    date: '2026-09-18',
  },
  {
    id: 'aashyqii-best-app',
    hook: 'The best app so far',
    text: '…The best app so far too for our family transactions.',
    source: 'app-store',
    name: 'Aashyqii',
    where: 'App Store SG',
    stars: 5,
    consent: 'public',
    date: '2026-10-10',
  },
  {
    id: 'ummu-plan-ahead',
    hook: 'plan the days ahead',
    text: 'i love this app tbh … Now i could plan the days ahead without the need to text everyone one by one',
    source: 'email',
    name: 'Ummu',
    where: 'Singapore · by email',
    stars: null,
    consent: 'granted',
    date: '2026-10-14',
  },
  {
    id: 'aherndon-replaced-apps',
    hook: 'replaced several different apps',
    text: 'This app has been so easy to use and has replaced several different apps for our family.',
    source: 'app-store',
    name: 'aherndon_',
    where: 'App Store US',
    stars: 5,
    consent: 'public',
    date: '2026-09-13',
  },
  {
    id: 'miss-cowboy-everything',
    hook: 'everything I wanted/needed',
    text: "This app has everything I wanted/needed & MORE. Plus it's cute & makes for pleasant viewing.",
    source: 'app-store',
    name: 'miss.cowboy',
    where: 'App Store US',
    stars: 5,
    consent: 'public',
    date: '2026-09-08',
  },
  {
    id: 'aherndon-skylight',
    hook: 'works so much better',
    text: 'We used to have a Skylight calendar, but this works so much better for our family!',
    source: 'app-store',
    name: 'aherndon_',
    where: 'App Store US',
    stars: 5,
    consent: 'public',
    date: '2026-09-13',
  },
  {
    id: 'brendan-found-it',
    hook: "I've found it",
    text: "…Was looking for a Maple alternative, since they're shutting down, and I've found it.",
    source: 'google-play',
    name: 'Brendan Watkins',
    where: 'Google Play',
    stars: 5,
    consent: 'public',
    date: '2026-09-14',
  },
] as const satisfies readonly ProofQuote[];

export type ProofId = (typeof PROOF_QUOTES)[number]['id'];

/** The quote with this id. Throws for an unknown id (only reachable from untyped callers). */
export function proofQuote(id: ProofId): ProofQuote {
  const quote = PROOF_QUOTES.find((q) => q.id === id);
  if (!quote) throw new Error(`proofQuote: no quote with id "${id}" in web/src/lib/proof.ts`);
  return quote;
}

function withParam(url: string, key: string, value: string): string {
  const u = new URL(url);
  u.searchParams.set(key, value);
  return u.toString();
}

/**
 * The public "all reviews" pages, built from the one copy of the store ids
 * (`STORE_URL` in `@beanies/brand/nav`). `email` has no listing.
 */
export const PROOF_LISTING_URL: Record<Exclude<ProofSource, 'email'>, string> = {
  'app-store': withParam(STORE_URL.ios, 'see-all', 'reviews'),
  'google-play': withParam(STORE_URL.android, 'showAllReviews', 'true'),
};
