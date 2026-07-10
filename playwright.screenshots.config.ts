/**
 * Playwright config for Play Store listing screenshots — NOT a test config.
 *
 * One project per Play form factor. Every combination below lands on an EXACT
 * 9:16 or 16:9 ratio and inside that form factor's pixel bounds, which Play
 * enforces on upload:
 *
 *   profile      css viewport   dsf   output       ratio   Play bounds
 *   phone        360x640        3     1080x1920    9:16    320..3840   (2-8 shots)
 *   tablet7      720x1280       2     1440x2560    9:16    320..3840   (0-8 shots)
 *   tablet10     1152x2048      1.5   1728x3072    9:16    1080..7680  (0-8 shots)
 *   chromebook   1280x720       2     2560x1440    16:9    1080..7680  (4-8 shots)
 *
 * The CSS viewport (not the output size) decides which layout renders, and
 * `useBreakpoint.ts` has THREE tiers, not two:
 *
 *   <= 767px   mobile   bottom tab bar + hamburger
 *   768-1023   tablet   hamburger only — NO sidebar and NO bottom nav
 *   >= 1024px  desktop  sidebar
 *
 * The middle tier is a navigation gap and makes a poor listing shot, so no
 * profile sits in it. tablet10 is 1152px CSS — still exactly 9:16, still inside
 * Play's bounds, and in the desktop tier, which is what a real 10" tablet in
 * portrait actually shows. So: phone + tablet7 exercise the mobile layout,
 * tablet10 + chromebook exercise the desktop layout. capture.ts branches on it.
 *
 * The page is genuinely rendered at `deviceScaleFactor`, so the PNGs are crisp —
 * unlike Playwright's video recorder, which clamps to CSS pixels (see
 * playwright.video.config.ts and the promo/ README).
 *
 * `reducedMotion: 'reduce'` because a screenshot wants a settled frame, not a
 * half-played transition. (The promo recorder wants the opposite.)
 *
 * The rendered PNGs are store-listing assets: they land in a git-ignored `.out/`
 * and live in Notion — never committed (CLAUDE.md + the submission runbook).
 */
import { defineConfig, type ViewportSize } from '@playwright/test';

export type DeviceProfile = {
  name: string;
  viewport: ViewportSize;
  deviceScaleFactor: number;
  isMobile: boolean;
};

/** Exported so capture.ts can assert the output dimensions it actually produced. */
export const PROFILES: DeviceProfile[] = [
  { name: 'phone', viewport: { width: 360, height: 640 }, deviceScaleFactor: 3, isMobile: true },
  { name: 'tablet7', viewport: { width: 720, height: 1280 }, deviceScaleFactor: 2, isMobile: true },
  {
    name: 'tablet10',
    viewport: { width: 1152, height: 2048 },
    deviceScaleFactor: 1.5,
    isMobile: false,
  },
  {
    name: 'chromebook',
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 2,
    isMobile: false,
  },
];

export default defineConfig({
  testDir: './scripts/store-screenshots',
  testMatch: /capture\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 300000,
  reporter: [['list']],
  outputDir: './scripts/store-screenshots/.tmp',
  projects: PROFILES.map((p) => ({
    name: p.name,
    use: {
      viewport: p.viewport,
      deviceScaleFactor: p.deviceScaleFactor,
      isMobile: p.isMobile,
      // Touch on a Chromebook would swap in touch affordances the reviewer
      // will not see on a real device.
      hasTouch: p.isMobile,
    },
  })),
  use: {
    baseURL: 'http://localhost:5173',
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
