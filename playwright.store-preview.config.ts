/**
 * Playwright config for filming the App Store preview — NOT a test config.
 * See `playwright.video.config.ts` for why it diverges from the E2E config
 * (animations on, pacing by `waitForTimeout`, lives outside `e2e/specs/`).
 *
 * The viewport is a phone at 2x: 443x795 CSS renders the mobile layout and the
 * CDP screencast in `store-preview.ts` delivers it at 886x1590, which sits under
 * the 330 px title band of Apple's 886x1920 portrait preview.
 */
import { defineConfig, devices } from '@playwright/test';

const PHONE = devices['Pixel 5'];

export default defineConfig({
  testDir: './scripts/promo-video',
  testMatch: /store-preview\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 600000,
  reporter: [['list']],
  outputDir: './scripts/promo-video/.out/store',
  use: {
    baseURL: 'http://localhost:5173',
    ...PHONE,
    viewport: { width: 443, height: 795 },
    deviceScaleFactor: 2,
    video: 'off',
    trace: 'off',
    screenshot: 'off',
    serviceWorkers: 'allow',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 120000,
    env: {
      VITE_GOOGLE_CLIENT_ID: 'promo-google-client-id.apps.googleusercontent.com',
      VITE_GOOGLE_API_KEY: 'promo-google-api-key',
      VITE_GOOGLE_PROJECT_NUMBER: '000000000000',
      VITE_REGISTRY_API_URL: 'https://promo.registry.invalid',
      VITE_REGISTRY_API_KEY: 'promo-registry-api-key',
    },
  },
});
