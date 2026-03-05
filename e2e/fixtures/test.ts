/**
 * Custom Playwright test fixture that disables beanie mode for E2E tests.
 *
 * Beanie mode replaces UI strings with creative lowercase alternatives,
 * which breaks text-based selectors. E2E tests should always run against
 * stable standard English strings.
 *
 * Import `{ test, expect }` from this file instead of `@playwright/test`.
 */
import { test as base, expect } from '@playwright/test';

const test = base.extend({
  page: async ({ page }, use) => {
    // Inject flag before any page JavaScript runs.
    // settingsStore.ts checks this flag and returns false for beanieMode.
    await page.addInitScript(() => {
      (window as any).__e2e_beanie_off = true;
    });
    await use(page);
  },
});

export { test, expect };
