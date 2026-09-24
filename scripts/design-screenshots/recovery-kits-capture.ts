import { test, expect } from '../../e2e/fixtures/test';
import { bypassLoginIfNeeded } from '../../e2e/helpers/auth';
import { gotoRoot } from '../../e2e/helpers/navigation';
import { ui } from '../../e2e/helpers/ui-strings';
import type { Page } from '@playwright/test';

/**
 * NOT a test — the browser walk for Manage Kits (tracker #99). Lives OUTSIDE
 * `e2e/specs/` on purpose (see capture.ts). Run it deliberately:
 *   npx playwright test -c playwright.design.config.ts --grep "recovery kits"
 *
 * Walks: mint kits until two are live → Manage Kits (light, dark, phone) → invalidate the
 * older one → the remaining kit reads Replace → Replace it → record which Replace branch
 * ran (the E2E harness has no durable provider after the post-create reload, so the
 * not-durable branch is the one that runs here).
 */

const E2E_PIN = '123456';
const SHOTS = 'scratch-shots/recovery-kits';

/** The drawer and modals animate in; let them settle before a screenshot. */
async function shot(page: Page, name: string) {
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

/** Either label: "Create Recovery Kit" when none is live, "Create a New Kit" otherwise. */
function generateButton(page: Page) {
  return page
    .getByRole('button', { name: ui('recovery.kitGenerate') })
    .or(page.getByRole('button', { name: ui('recovery.kitRegenerate') }))
    .first();
}

async function openSecurityDrawer(page: Page) {
  // In-app navigation, NOT `gotoRoute`: a full reload drops the memory provider and the
  // open envelope, and Settings then reports "no recovery kit" / "pod not open".
  const link = page.locator('a[href="/settings"]').first();
  if (await link.isVisible().catch(() => false)) {
    await link.click();
  } else {
    await page.getByText('John Doe').first().click();
    await page.getByText(ui('nav.settings')).first().click();
  }
  await page.waitForURL('**/settings');
  await page.getByText(ui('settings.card.security')).first().click();
  await page.getByText(ui('recovery.kitTitle')).first().waitFor({ state: 'visible' });
}

async function confirmKitStored(page: Page) {
  const stored = page.getByTestId('kit-confirm');
  await stored.waitFor({ state: 'visible', timeout: 15000 });
  await page.getByTestId('kit-acknowledged').check();
  await stored.click();
  await stored.waitFor({ state: 'hidden', timeout: 15000 });
}

async function proveIdentity(page: Page) {
  const pin = page.getByLabel(ui('pin.enterPin'));
  await pin.waitFor({ state: 'visible', timeout: 10000 });
  await pin.fill(E2E_PIN);
  await pin.waitFor({ state: 'hidden', timeout: 15000 });
}

async function setDark(page: Page, on: boolean) {
  await page.evaluate((dark) => {
    document.documentElement.classList.toggle('dark', dark);
  }, on);
}

test('recovery kits: manage, invalidate, replace', async ({ page }) => {
  page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
  page.on('console', (m) => {
    const text = m.text();
    if (/kit_|envelope-revocation|entries_revoked/.test(text)) console.log(`[page] ${text}`);
  });

  await gotoRoot(page);
  await bypassLoginIfNeeded(page);
  await openSecurityDrawer(page);
  await shot(page, '01-drawer-initial-light');

  // Mint until two kits are live, so Invalidate is offered (the only live kit reads Replace).
  for (let i = 0; i < 2; i++) {
    if (await page.getByText(/2 live/).isVisible()) break;
    await generateButton(page).click();
    // Create asks first (2026-09-24): the info confirm leads with the live count.
    await page.getByText(ui('recovery.kitCreateTitle')).waitFor({ state: 'visible' });
    await shot(page, `01b-create-confirm-${i}`);
    await page.getByRole('button', { name: ui('recovery.kitCreateConfirm') }).click();
    await confirmKitStored(page);
  }
  await expect(page.getByText(/2 live/)).toBeVisible();
  await shot(page, '02-drawer-two-kits-light');

  await page.getByRole('button', { name: ui('recovery.kitsManage') }).click();
  await expect(page.locator('[data-kit-status="live"]')).toHaveCount(2);
  await shot(page, '03-manage-two-live-light');
  await setDark(page, true);
  await shot(page, '04-manage-two-live-dark');
  await page.setViewportSize({ width: 390, height: 844 });
  await shot(page, '05-manage-two-live-dark-phone');
  await page.setViewportSize({ width: 1280, height: 900 });
  await setDark(page, false);

  // Invalidate the OLDER kit (second live row; the newest carries the pill).
  const invalidateButtons = page.getByRole('button', { name: ui('recovery.kitInvalidate') });
  await expect(invalidateButtons).toHaveCount(2);
  await invalidateButtons.nth(1).click();
  await page.getByText(ui('recovery.kitInvalidateTitle')).waitFor({ state: 'visible' });
  await shot(page, '06-invalidate-confirm-light');
  await page.getByRole('button', { name: ui('recovery.kitInvalidateConfirm') }).click();
  await proveIdentity(page);

  await expect(page.locator('[data-kit-status="live"]')).toHaveCount(1);
  await expect(page.locator('[data-kit-status="invalidated"]')).toHaveCount(1);
  await expect(page.getByRole('button', { name: ui('recovery.kitReplace') })).toBeVisible();
  await expect(page.getByRole('button', { name: ui('recovery.kitInvalidate') })).toHaveCount(0);
  await shot(page, '07-manage-one-live-one-dead-light');
  await setDark(page, true);
  await page.setViewportSize({ width: 390, height: 844 });
  await shot(page, '08-manage-one-live-one-dead-dark-phone');
  await page.setViewportSize({ width: 1280, height: 900 });
  await setDark(page, false);

  // Replace the only remaining kit: approve → PIN → mint → confirm stored.
  await page.getByRole('button', { name: ui('recovery.kitReplace') }).click();
  await page.getByText(ui('recovery.kitReplaceTitle')).waitFor({ state: 'visible' });
  await shot(page, '09-replace-confirm-light');
  await page.getByRole('button', { name: ui('recovery.kitReplaceConfirm') }).click();
  await proveIdentity(page);
  await confirmKitStored(page);

  // Durable provider → "1 live · 2 invalidated". No durable provider (this harness) →
  // the designed degraded path: old kit stays valid, "2 live · 1 invalidated", and the
  // replace-specific message. Record which one ran.
  const summary = page.getByText(/live · \d+ invalidated/).first();
  await expect(summary).toBeVisible();
  console.log(`[harness] after replace: ${await summary.textContent()}`);
  const notSynced = await page.getByText(ui('recovery.kitReplaceNotSynced')).isVisible();
  console.log(`[harness] replace not-synced message shown: ${notSynced}`);
  await shot(page, '10-drawer-after-replace-light');
  await page.getByRole('button', { name: ui('recovery.kitsManage') }).click();
  await shot(page, '11-manage-after-replace-light');
  await setDark(page, true);
  await shot(page, '12-manage-after-replace-dark');
});
