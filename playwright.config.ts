import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e/specs',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 20000,
  reporter: [['html'], ['junit', { outputFile: 'test-results/junit.xml' }]],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    serviceWorkers: 'allow',
    // Signal prefers-reduced-motion so decorative infinite animations are
    // disabled during E2E. Avoids WebKit "waiting for element to be stable"
    // stalls caused by repaint churn from animated siblings.
    reducedMotion: 'reduce',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // Firefox and WebKit available for local testing: npx playwright test --project=firefox
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    {
      name: 'webkit',
      // WebKit on Linux CI is ~2–3× slower than Chromium and occasionally
      // emits transient "internal error" crashes on page.goto. Headroom +
      // one extra retry absorb this without masking genuine regressions
      // (see issue #155).
      timeout: 60000,
      retries: process.env.CI ? 2 : 0,
      use: { ...devices['Desktop Safari'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
    // E2E suite covers the cloud-hosted experience (Drive sync, magic-link
    // invites, etc.). The new self-host gating in `src/config/features.ts`
    // disables those UI affordances when their env vars are missing — and
    // CI has no `.env.local`. Provide dummy values so feature flags pass
    // their `ok()` non-empty-string check. None of these are dialed
    // outbound: Drive/registry calls in tests are either mocked or never
    // reached because the wizard exits before requesting a file.
    env: {
      VITE_GOOGLE_CLIENT_ID: 'e2e-google-client-id.apps.googleusercontent.com',
      VITE_GOOGLE_API_KEY: 'e2e-google-api-key',
      VITE_GOOGLE_PROJECT_NUMBER: '000000000000',
      VITE_REGISTRY_API_URL: 'https://e2e.registry.invalid',
      VITE_REGISTRY_API_KEY: 'e2e-registry-api-key',
    },
  },
});
