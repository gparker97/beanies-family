import type { Page } from '@playwright/test';

/**
 * Tripwire: no E2E run may reach Substack. The newsletter is already off in dev/test builds
 * (`features.newsletter` needs VITE_NEWSLETTER_SUBSCRIBE_URL, set only on cloud release lanes),
 * so this should never fire; if it does, the build leaked the var and a fake address was about
 * to subscribe to the real newsletter. The request is aborted and recorded; `assertNoSubstack`
 * fails the run with the blocked URLs instead of letting it vanish into CI output.
 */
const blocked = new WeakMap<Page, string[]>();

export async function guardSubstack(page: Page): Promise<void> {
  if (blocked.has(page)) return; // idempotent per page
  const urls: string[] = [];
  blocked.set(page, urls);
  await page.route(/substack\.com/, (route) => {
    urls.push(route.request().url());
    return route.abort();
  });
}

export function assertNoSubstack(page: Page): void {
  const urls = blocked.get(page) ?? [];
  if (urls.length > 0) {
    throw new Error(
      `[e2e] blocked a Substack request (${urls.join(', ')}): ` +
        'VITE_NEWSLETTER_SUBSCRIBE_URL must be unset in dev/test builds'
    );
  }
}
