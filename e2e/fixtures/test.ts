/**
 * Custom Playwright test fixture for the beanies E2E suite.
 *
 * - Disables beanie mode so creative lowercase strings don't break selectors
 *   (settingsStore.ts checks `window.__e2e_beanie_off` and returns false).
 * - Auto-cleans the active family from the registry DDB table after each
 *   test (via __e2eDataBridge.cleanupActiveFamily — same removeFamily()
 *   call the real app uses). Failed/aborted tests don't leave orphan rows.
 *
 * Import `{ test, expect }` from this file instead of `@playwright/test`.
 */
import { test as base, expect } from '@playwright/test';
import { cleanupRegistry } from '../helpers/cleanup';

const test = base.extend({
  page: async ({ page }, use) => {
    await page.addInitScript(() => {
      (window as any).__e2e_beanie_off = true;
    });
    await use(page);
    await cleanupRegistry(page);
  },
});

export { test, expect };
