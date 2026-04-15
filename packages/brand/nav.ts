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

/**
 * URL of the app itself (authenticated PWA).
 *
 * In Astro dev mode (`npm run dev:web`) this points at the local Vue dev
 * server (http://localhost:5173) so "create your bean pod" / "sign in" CTAs
 * on the marketing site can be tested end-to-end without deploying. In
 * production builds it points at the real app subdomain.
 *
 * The Vue app itself doesn't import from this module — it has its own
 * navigation constants — so this DEV branch only affects the Astro site.
 */
export const APP_URL = import.meta.env.DEV ? 'http://localhost:5173' : 'https://app.beanies.family';

/** Public marketing site URL. */
export const SITE_URL = 'https://beanies.family';
