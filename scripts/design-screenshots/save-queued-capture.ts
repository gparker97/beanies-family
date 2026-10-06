import { test, expect } from '../../e2e/fixtures/test';
import { bypassLoginIfNeeded } from '../../e2e/helpers/auth';
import { gotoRoot } from '../../e2e/helpers/navigation';
import { ui } from '../../e2e/helpers/ui-strings';
import type { Page } from '@playwright/test';

/**
 * NOT a test: the browser walk for the #127 plan's "Waiting to Save" state
 * (docs/plans/2026-10-06-drive-save-timeouts-and-single-flight.md, Dark Mode Coverage).
 *
 * A real Drive timeout needs a real Drive token, which headless Playwright cannot hold, so
 * the queued state is driven at the store seam: `syncStore.isSaveQueued` is the exact ref
 * `onStateChange` mirrors from `SyncServiceState.saveQueued` (unit-tested), and
 * `storageProviderType` is set to Drive so the popover's connection line renders. Everything
 * downstream of the store (status precedence, presentation tokens, popover copy, both themes,
 * both widths) is the real UI.
 *
 * Lives OUTSIDE `e2e/specs/` on purpose (see capture.ts). Run it deliberately:
 *   npx playwright test -c playwright.design.config.ts --grep "save queued walk"
 */

const SHOTS = 'scratch-shots/save-queued';
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 900 };

async function setDark(page: Page, dark: boolean) {
  await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
  await page.evaluate((d) => document.documentElement.classList.toggle('dark', d), dark);
  await page.waitForTimeout(150);
}

async function shot(page: Page, name: string) {
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
}

/** Flip the real store refs the indicator reads. */
async function setQueued(page: Page, queued: boolean) {
  await page.evaluate((q) => {
    const root = document.querySelector('#app') ?? document.querySelector('[data-v-app]');
    const app = (
      root as unknown as {
        __vue_app__?: {
          config: { globalProperties: { $pinia?: { _s: Map<string, Record<string, unknown>> } } };
        };
      }
    )?.__vue_app__;
    const store = app?.config.globalProperties.$pinia?._s.get('sync');
    if (!store) throw new Error('sync store not reachable from window');
    store.storageProviderType = 'google_drive';
    store.lastSync = new Date(Date.now() - 7 * 60_000).toISOString();
    store.isSaveQueued = q;
  }, queued);
  await page.waitForTimeout(150);
}

async function contrastProbe(page: Page, scope: string, label: string) {
  const fails = await page.evaluate((sel) => {
    const root = document.querySelector(sel);
    if (!root) return [`no scope ${sel}`];
    const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
    const rgba = (c: string): [number, number, number, number] => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = '#000';
      ctx.fillStyle = c;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
      return [r!, g!, b!, a! / 255];
    };
    const over = (top: number[], under: number[]) => {
      const a = top[3]!;
      return [0, 1, 2].map((i) => top[i]! * a + under[i]! * (1 - a)).concat(1);
    };
    const lum = (c: number[]) => {
      const f = (v: number) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(c[0]!) + 0.7152 * f(c[1]!) + 0.0722 * f(c[2]!);
    };
    const ratio = (a: number[], b: number[]) => {
      const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
      return (x! + 0.05) / (y! + 0.05);
    };
    const backgrounds = (el: Element): number[][] => {
      const layers: string[][] = [];
      for (let n: Element | null = el; n; n = n.parentElement) {
        const cs = getComputedStyle(n);
        const img = cs.backgroundImage;
        if (img && img.includes('gradient')) {
          const stops = img.match(/(oklch|rgba?|color|hsla?)\([^)]*\)/g) ?? [];
          if (stops.length) layers.push(stops);
        }
        const bg = rgba(cs.backgroundColor);
        if (bg[3] > 0) layers.push([cs.backgroundColor]);
        if (layers.length && layers.at(-1)!.every((c) => rgba(c)[3] >= 0.99)) break;
      }
      let base: number[][] = [rgba(getComputedStyle(document.body).backgroundColor)];
      if (base[0]![3] === 0) base = [[255, 255, 255, 1]];
      for (const layer of layers.reverse()) {
        base = layer.flatMap((c) => base.map((b) => over(rgba(c), b)));
      }
      return base;
    };
    const out: string[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const seen = new Set<Element>();
    for (let t = walker.nextNode(); t; t = walker.nextNode()) {
      const el = t.parentElement;
      if (!el || seen.has(el) || !t.textContent?.trim()) continue;
      seen.add(el);
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (r.width === 0 || r.height === 0 || cs.visibility === 'hidden') continue;
      if (el.closest('[aria-hidden="true"]')) continue;
      if ((el as HTMLButtonElement).disabled || el.closest('button:disabled')) continue;
      const size = parseFloat(cs.fontSize);
      const large = size >= 24 || (size >= 18.66 && Number(cs.fontWeight) >= 700);
      const fg = rgba(cs.color);
      const worst = Math.min(...backgrounds(el).map((b) => ratio(over(fg, b), b)));
      const need = large ? 3 : 4.5;
      if (worst < need)
        out.push(`${worst.toFixed(2)} < ${need}: "${t.textContent.trim().slice(0, 40)}"`);
    }
    return out;
  }, scope);
  console.log(`[contrast] ${label}: ${fails.length ? fails.join(' | ') : 'all pass'}`);
  return fails;
}

async function openPopoverAndCheck(page: Page, tag: string) {
  const row = page.getByRole('button', { name: ui('saveStatus.rowAria') }).first();
  await expect(row).toContainText(ui('saveStatus.waiting'));
  await row.click();
  const pop = page.getByRole('dialog', { name: ui('saveStatus.titleSafe') });
  await expect(pop).toBeVisible();
  await expect(pop).toContainText(ui('saveStatus.reassuranceQueued'));
  await expect(pop).toContainText(ui('saveStatus.reconnecting'));
  await expect(pop).not.toContainText(ui('saveStatus.connected'));
  await shot(page, `${tag}-popover`);
  const fails = await contrastProbe(page, '[role="dialog"]', `${tag} popover`);
  // Pre-existing, app-wide: the house primary CTA is white on Heritage Orange (~3.3:1 at
  // text-xs). Not introduced here; recorded as a brand-level follow-up in the build report.
  const known = ui('saveStatus.manageConnection');
  const unexpected = fails.filter((f) => !f.includes(known));
  if (unexpected.length !== fails.length) console.log(`[contrast] ${tag}: known CTA excluded`);
  expect(unexpected, `contrast ${tag} popover`).toEqual([]);
  await page.keyboard.press('Escape');
}

test('save queued walk', async ({ page }) => {
  test.setTimeout(300_000);
  await page.setViewportSize(DESKTOP);
  await gotoRoot(page);
  await bypassLoginIfNeeded(page);
  await page.getByTestId('app-content').waitFor();

  // Baseline: the real pipeline is what we are flipping. Not queued => not "Waiting to Save".
  await setQueued(page, false);
  const row = page.getByRole('button', { name: ui('saveStatus.rowAria') }).first();
  await expect(row).toBeVisible();
  await expect(row).not.toContainText(ui('saveStatus.waiting'));

  for (const dark of [false, true]) {
    const theme = dark ? 'dark' : 'light';
    await setDark(page, dark);
    await setQueued(page, true);
    await shot(page, `desktop-${theme}-row`);
    const rowFails = await contrastProbe(
      page,
      `button[aria-label="${ui('saveStatus.rowAria')}"]`,
      `desktop ${theme} row`
    );
    console.log(`[row-contrast] desktop ${theme}: ${rowFails.join(' | ') || 'all pass'}`);
    await openPopoverAndCheck(page, `desktop-${theme}`);
  }

  await page.setViewportSize(PHONE);
  for (const dark of [false, true]) {
    const theme = dark ? 'dark' : 'light';
    await setDark(page, dark);
    await setQueued(page, true);
    await page.getByRole('button', { name: ui('mobile.menu'), exact: true }).click();
    await page
      .getByRole('button', { name: ui('saveStatus.rowAria') })
      .first()
      .waitFor();
    await shot(page, `phone-${theme}-menu`);
    await openPopoverAndCheck(page, `phone-${theme}`);
    await page.getByRole('button', { name: ui('mobile.closeMenu') }).click();
  }
});
