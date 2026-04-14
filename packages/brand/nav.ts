/**
 * Public navigation links shared by the marketing site (Astro) and the Vue app.
 * Single source of truth — do not duplicate these in either app.
 */

export interface NavLink {
  label: string;
  href: string;
  /** External link — open in new tab with rel="noopener" */
  external?: boolean;
}

/** Top-level public marketing nav (Astro header + Vue public header) */
export const PUBLIC_NAV: NavLink[] = [
  { label: 'home', href: '/' },
  { label: 'beanstalk', href: '/blog' },
  { label: 'help', href: '/help' },
];

/** Footer links */
export const FOOTER_NAV: NavLink[] = [
  { label: 'privacy', href: '/privacy' },
  { label: 'terms', href: '/terms' },
  { label: 'github', href: 'https://github.com/gparker97/beanies-family', external: true },
];

/** URL of the app itself (authenticated PWA). */
export const APP_URL = 'https://app.beanies.family';

/** Public marketing site URL. */
export const SITE_URL = 'https://beanies.family';
