/**
 * Shared pieces of a filmed take against the real app: guarded clicks that name
 * their blocker, the celebration / bean-stack dismissers, bottom-nav tapping and
 * the photo-CDN stand-in. Used by `record.ts` (the Play promo) and
 * `store-preview.ts` (the App Store preview); nothing here is a test.
 */
import type { Page, Locator } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import type { UIStringKey } from '../../src/services/translation/uiStrings';
import { glideTo } from './cursor';
import { labelExact, labelLoose } from './labels';
import { DEMO_PHOTO_FILES } from './seed';

/** A blocked click means an overlay is eating pointer events — fail fast, don't stall. */
export const CLICK_TIMEOUT = 5000;

/**
 * Report what is actually sitting at a point, so a "blocked" click names its
 * blocker instead of leaving us guessing. Also drops a screenshot in `outDir`.
 * Diagnostic only — never throws.
 */
export async function diagnoseBlock(
  page: Page,
  x: number,
  y: number,
  what: string,
  outDir: string
): Promise<void> {
  const top = await page
    .evaluate(
      ({ x, y }) => {
        const el = document.elementFromPoint(x, y);
        if (!el) return 'nothing at point';
        const chain: string[] = [];
        for (let n: Element | null = el; n && chain.length < 4; n = n.parentElement) {
          const cls = typeof n.className === 'string' ? n.className.slice(0, 60) : '';
          chain.push(
            `${n.tagName.toLowerCase()}${cls ? '.' + cls.trim().split(/\s+/).join('.') : ''}`
          );
        }
        return chain.join('  <  ');
      },
      { x, y }
    )
    .catch(() => 'evaluate failed');
  console.warn(`    ↳ topmost at (${Math.round(x)},${Math.round(y)}): ${top}`);
  fs.mkdirSync(outDir, { recursive: true });
  await page.screenshot({ path: path.join(outDir, `blocked-${what}.png`) }).catch(() => {});
}

/** Glide onto a locator's centre and click. Returns false if it isn't there / is blocked. */
export async function glideClick(
  page: Page,
  target: Locator,
  what: string,
  outDir: string,
  steps = 24,
  force = false
): Promise<boolean> {
  const box = await target.boundingBox({ timeout: 2000 }).catch(() => null);
  if (!box) {
    console.warn(`    ↳ "${what}" has no bounding box (absent or display:none)`);
    return false;
  }
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await glideTo(page, cx, cy, steps);
  await page.waitForTimeout(steps < 24 ? 120 : 240);
  try {
    await target.click({ timeout: CLICK_TIMEOUT, force }); // force: skip the stability wait on a still-animating target
    return true;
  } catch {
    await diagnoseBlock(page, cx, cy, what, outDir); // an overlay is eating pointer events
    return false;
  }
}

/**
 * Dismiss the celebration modal (`z-[200]`, full-screen `bg-black/40` backdrop)
 * that fires when a to-do is ticked. It does NOT auto-dismiss — it waits on its
 * "let's go" button — so anything that follows is pointer-blocked until it's
 * cleared. Returns true if one was actually dismissed.
 */
export async function dismissCelebration(page: Page, outDir: string): Promise<boolean> {
  const go = page.getByRole('button', { name: labelExact('celebration.letsGo') }).last();
  if (!(await go.isVisible().catch(() => false))) return false;
  await glideClick(page, go, 'celebration', outDir);
  await page.waitForTimeout(400);
  return true;
}

/**
 * Dismiss the bean-stack overlay if it's open. Called whenever a card beat is
 * abandoned — otherwise the overlay swallows every later tab click and the take
 * stalls out at the test ceiling. Clears a celebration modal first, since that
 * sits above the stack.
 */
export async function dismissStack(page: Page, outDir: string): Promise<void> {
  await dismissCelebration(page, outDir);
  const closer = page.getByLabel(labelExact('mobile.closeMenu')).last();
  if (await closer.isVisible().catch(() => false)) {
    await closer.click({ timeout: CLICK_TIMEOUT }).catch(() => {});
  } else {
    await page.keyboard.press('Escape').catch(() => {});
  }
  await page.waitForTimeout(300);
}

/**
 * Tap a bottom-nav tab and, for the fan-out tabs (`planning`, `money`, `pod`),
 * the side-card behind it (a `role="menuitem"` button). Resolves once the page
 * content is visible. Returns false (after clearing any overlay) when the tab or
 * card is missing, so one bad beat cannot poison the rest of the take.
 *
 * Labels come from the string table and match either the `en` or the `beanie`
 * rendering — never hardcoded prose.
 */
export async function openTab(
  page: Page,
  tabKey: UIStringKey,
  outDir: string,
  cardKey?: UIStringKey,
  steps = 24
): Promise<boolean> {
  const t0 = Date.now();
  const lap = (what: string) => console.log(`      ${what} +${Date.now() - t0}ms`);
  const tab = page.getByLabel(labelExact(tabKey)).last();
  if (!(await glideClick(page, tab, `tab-${tabKey}`, outDir, steps))) {
    console.warn(`  ! tab "${tabKey}" not found or blocked — skipping`);
    await dismissStack(page, outDir);
    return false;
  }
  if (cardKey) {
    const target = page
      .getByRole('menuitem')
      .filter({ hasText: labelLoose(cardKey) })
      .last();
    lap('tab clicked');
    await target.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
    lap('card visible');
    if (!(await glideClick(page, target, `card-${cardKey}`, outDir, steps, true))) {
      console.warn(`  ! card "${cardKey}" not found under "${tabKey}" — dismissing stack`);
      await dismissStack(page, outDir);
      return false;
    }
  }
  lap('clicked');
  await page.getByTestId('app-content').waitFor({ state: 'visible', timeout: 20000 });
  lap('content');
  return true;
}

/**
 * Serve brand art in place of the Google Drive photo CDN.
 *
 * `photoStore.getPublicUrl` is pure — it builds the URL from `driveFileId` and
 * never checks whether Drive is configured — so seeded photo metadata renders as
 * long as the request resolves. Unmapped ids abort rather than 404, because a
 * 404 pushes the photo into `unresolvedIds` and the app then renders a permanent
 * broken tile for it.
 */
export async function mockPhotoCdn(page: Page, root = process.cwd()): Promise<void> {
  await page.route('https://lh3.googleusercontent.com/**', async (route) => {
    // URL shape: /d/<driveFileId>=w<px>
    const match = /\/d\/([^=/?]+)/.exec(route.request().url());
    const rel = match ? DEMO_PHOTO_FILES[decodeURIComponent(match[1]!)] : undefined;
    if (!rel) return route.abort();

    const file = path.join(root, 'public', rel);
    if (!fs.existsSync(file)) return route.abort();
    await route.fulfill({
      status: 200,
      contentType: rel.endsWith('.webp') ? 'image/webp' : 'image/png',
      body: fs.readFileSync(file),
    });
  });
}
