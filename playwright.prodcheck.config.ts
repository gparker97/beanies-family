import { defineConfig, devices } from '@playwright/test';

/**
 * Production-build checks: things that only break in a `vite build` + service worker, never on
 * the dev server. NOT part of the E2E suite (and not the design harness, which targets the dev
 * server) — run deliberately:
 *
 *   npx playwright test -c playwright.prodcheck.config.ts
 *
 * The web server BUILDS the app first (a few minutes), into `dist/prodcheck` so the real `dist`
 * is untouched, then serves it with `vite preview`. The build is a real production build (CSS
 * extracted to hashed `<link>` files, the workbox service worker generated and registered)
 * with one difference: `NODE_ENV=development`, which keeps the dev-only E2E data bridge that
 * the shared helpers need to create and seed a family. Nothing font- or SW-related reads it.
 *
 * Set `PRODCHECK_REUSE=1` to reuse a preview already running on :4174 (iterating on a check
 * without rebuilding). Without it every run rebuilds, so it always tests the working tree.
 */
const PORT = 4174;

export default defineConfig({
  testDir: './scripts/design-screenshots',
  testMatch: /\.prodcheck\.ts$/,
  timeout: 300_000,
  fullyParallel: false,
  workers: 1,
  reporter: 'line',
  use: { baseURL: `http://localhost:${PORT}`, serviceWorkers: 'allow', acceptDownloads: true },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command:
      `npx vite build --outDir dist/prodcheck --emptyOutDir && ` +
      `npx vite preview --outDir dist/prodcheck --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !!process.env.PRODCHECK_REUSE,
    timeout: 900_000,
    stdout: 'ignore',
    stderr: 'pipe',
    // Same dummy cloud config as the E2E suite (playwright.config.ts): the feature gates need
    // non-empty values, and the registry is mocked by the shared fixture.
    env: {
      NODE_ENV: 'development',
      VITE_GOOGLE_CLIENT_ID: 'e2e-google-client-id.apps.googleusercontent.com',
      VITE_GOOGLE_API_KEY: 'e2e-google-api-key',
      VITE_GOOGLE_PROJECT_NUMBER: '000000000000',
      VITE_REGISTRY_API_URL: 'https://e2e.registry.invalid',
      VITE_REGISTRY_API_KEY: 'e2e-registry-api-key',
    },
  },
});
