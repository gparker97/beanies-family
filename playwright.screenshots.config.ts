/**
 * Playwright config for Play/App Store listing screenshots — NOT a test config.
 *
 * Output is 1080x1920 (9:16), which is what Google Play wants for phone
 * screenshots: PNG/JPEG, 16:9 or 9:16, each side 320–3840px, 2–8 images.
 * We get there with a 360x640 CSS viewport at deviceScaleFactor 3 — the page is
 * genuinely rendered at 3x, so the PNGs are crisp (unlike Playwright's video,
 * which clamps; see playwright.video.config.ts).
 *
 * Differences from the promo-video config:
 *  - `reducedMotion: 'reduce'`. A screenshot wants a settled frame, not a
 *    half-played transition. (The promo wants the opposite.)
 *  - No video, no fake cursor.
 *
 * The rendered PNGs are store-listing assets, so they land in a git-ignored
 * `.out/` and live in Notion — never committed (CLAUDE.md + the submission runbook).
 */
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './scripts/store-screenshots',
  testMatch: /capture\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 300000,
  reporter: [['list']],
  outputDir: './scripts/store-screenshots/.tmp',
  use: {
    baseURL: 'http://localhost:5173',
    viewport: { width: 360, height: 640 },
    deviceScaleFactor: 3, // 360x640 @3x => 1080x1920
    isMobile: true,
    hasTouch: true,
    reducedMotion: 'reduce',
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
