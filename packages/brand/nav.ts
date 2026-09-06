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
 * The Vue app imports `STORE_URL` from this module (see below); it does not use
 * `APP_URL`, so this DEV branch only affects the Astro site.
 */
export const APP_URL = import.meta.env.DEV ? 'http://localhost:5173' : 'https://app.beanies.family';

/** Public marketing site URL. */
export const SITE_URL = 'https://beanies.family';

/**
 * Where to send someone to install or update the app, per platform.
 *
 * ⚠️ ONE COPY, AND A RECORD RATHER THAN AN IF/ELSE. These used to be four
 * literals across three Astro pages, and the Vue app now needs them too. Keyed
 * on the platform union so a third native platform fails the BUILD here rather
 * than falling through to no link, which on the update-block screen would be a
 * dead end for somebody who cannot use the app until they act on it.
 *
 * The identifiers are the app this repo builds: the Play package matches
 * `capacitor.config.ts`, `android/app/build.gradle` and the iOS project. The
 * Apple link is deliberately region-less (`/app/id…`), which resolves to each
 * visitor's own storefront.
 */
export const STORE_URL = {
  ios: 'https://apps.apple.com/app/id6798513944',
  android: 'https://play.google.com/store/apps/details?id=family.beanies.app',
} as const satisfies Record<'ios' | 'android', string>;
