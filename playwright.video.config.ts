/**
 * Playwright config for the store promo recording — NOT a test config.
 *
 * Deliberately diverges from `playwright.config.ts`:
 *  - `reducedMotion` is left at its default. The E2E config forces `'reduce'`
 *    to stabilise assertions, which disables the app's decorative animations.
 *    That is exactly what a promo needs to show.
 *  - `video: 'on'` (E2E only keeps video on failure).
 *  - Mobile viewport: the Play listing audience is holding an Android phone,
 *    and the native build is Capacitor wrapping this same UI.
 *  - `waitForTimeout` is used freely in the recording script. Deliberate pacing
 *    IS the content here, so ADR-007's ban does not apply. This is why the
 *    script lives outside `e2e/specs/` and off the 25-test budget.
 */
import { defineConfig, devices } from '@playwright/test';

const PHONE = devices['Pixel 5'];

/**
 * `video.size` is the recorded AREA in CSS pixels, not a supersample — setting it
 * to 2x the viewport records a 2x-larger region and pads the empty space grey
 * (verified on camera, 2026-07-10). It must therefore track the viewport. Render
 * fidelity is raised with `deviceScaleFactor` instead.
 */
const SCALE = 2;
const VIDEO_SIZE = PHONE.viewport;

export default defineConfig({
  testDir: './scripts/promo-video',
  testMatch: /record\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 600000,
  reporter: [['list']],
  outputDir: './scripts/promo-video/.out',
  use: {
    baseURL: 'http://localhost:5173',
    ...PHONE,
    deviceScaleFactor: SCALE,
    video: { mode: 'on', size: VIDEO_SIZE },
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
