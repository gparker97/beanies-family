import { defineConfig, devices } from '@playwright/test';

/**
 * Design-review screenshot harness — NOT part of the E2E suite.
 *
 * Kept out of `playwright.config.ts` (`testDir: './e2e/specs'`) because that config is
 * what CI runs on every push to main. A zero-assertion, timeout-driven, English-label
 * harness there can only red-light the branch; it also counted against the ADR-007
 * budget of 25 without removing anything.
 *
 *   npx playwright test -c playwright.design.config.ts
 */
export default defineConfig({
  testDir: './scripts/design-screenshots',
  testMatch: /capture\.ts/,
  timeout: 300_000,
  fullyParallel: false,
  workers: 1,
  reporter: 'line',
  use: { baseURL: 'http://localhost:5173' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
