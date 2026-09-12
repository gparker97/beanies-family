/**
 * Shared JSON-LD (Schema.org) data for beanies.family.
 * Used by both the Astro marketing site (primary) and the Vue app (if needed).
 */

import { SITE_URL } from './nav';

/** Author / founder — currently a single-author site. */
export const AUTHOR = {
  '@type': 'Person',
  '@id': `${SITE_URL}/about/greg#greg`,
  name: 'greg',
  url: `${SITE_URL}/about/greg`,
  sameAs: [
    'https://github.com/gparker97',
    // Add LinkedIn, Bluesky, Mastodon, X, Reddit as they become active
  ],
} as const;

/** Organization — the beanies.family entity. */
export const ORGANIZATION = {
  '@type': 'Organization',
  '@id': `${SITE_URL}#org`,
  name: 'beanies.family',
  url: SITE_URL,
  logo: `${SITE_URL}/brand/beanies-logo.png`,
  founder: AUTHOR,
  sameAs: ['https://github.com/gparker97/beanies-family'],
} as const;

/** WebSite + SiteNavigationElement — enables sitelinks search box in Google. */
export const WEBSITE = {
  '@type': 'WebSite',
  '@id': `${SITE_URL}#website`,
  url: SITE_URL,
  name: 'beanies.family',
  description:
    'Every bean counts — family planning, activity tracking, and finances. Local-first and private.',
  publisher: { '@id': `${SITE_URL}#org` },
} as const;

/** The beanies.family PWA as a SoftwareApplication. */
export const SOFTWARE_APPLICATION = {
  '@type': 'SoftwareApplication',
  '@id': `${SITE_URL}#app`,
  name: 'beanies.family',
  applicationCategory: 'LifestyleApplication',
  operatingSystem: 'Any (PWA)',
  description:
    'beanies.family is the focal point of your family — a local-first, privacy-first PWA for family planning, activity tracking, and finances.',
  url: SITE_URL,
  author: { '@id': `${SITE_URL}#org` },
  // NO `offers` here on purpose. This package sits below web/src and cannot
  // import lib/pricing.ts, so a price written here would be a second source of
  // truth and would silently drift. The homepage composes the offers from
  // PRICES at the call site. (Until 2026-09-12 this said `price: '0'`, which
  // shipped "beanies is free" to every crawler reading the homepage.)
} as const;
