/**
 * Custom Playwright test fixture for the beanies E2E suite.
 *
 * - Disables beanie mode so creative lowercase strings don't break selectors
 *   (settingsStore.ts checks `window.__e2e_beanie_off` and returns false).
 * - Mocks the family-registry HTTP API so the create flow's now-critical
 *   registry write succeeds (see helpers/registry-mock.ts). Without it, every
 *   create flow throws "couldn't reach our family registry" and never reaches
 *   the members/Finish step.
 * - Auto-cleans the active family from the registry DDB table after each
 *   test (via __e2eDataBridge.cleanupActiveFamily — same removeFamily()
 *   call the real app uses). Failed/aborted tests don't leave orphan rows.
 *
 * Import `{ test, expect }` from this file instead of `@playwright/test`.
 */
import { test as base, expect } from '@playwright/test';
import { cleanupRegistry } from '../helpers/cleanup';
import { mockRegistry } from '../helpers/registry-mock';

const test = base.extend({
  page: async ({ page }, use) => {
    await page.addInitScript(() => {
      (window as any).__e2e_beanie_off = true;
    });
    // The create flow's registry write is now a critical step (throws if the
    // registry is unreachable). Serve a working registry so create can complete.
    await mockRegistry(page);
    await use(page);
    await cleanupRegistry(page);
  },
});

export { test, expect };
