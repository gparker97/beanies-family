import { test, expect } from '../../e2e/fixtures/test';
import { bypassLoginIfNeeded } from '../../e2e/helpers/auth';
import { gotoRoute } from '../../e2e/helpers/navigation';
import { ui } from '../../e2e/helpers/ui-strings';
import type { Page } from '@playwright/test';

/**
 * NOT a test: the browser walk for #81 (plan docs/plans/2026-10-07-kdf-strength-and-
 * passphrase-entropy.md). Lives OUTSIDE `e2e/specs/` on purpose (see capture.ts). Run it
 * deliberately:
 *   npx playwright test -c playwright.design.config.ts --grep "kdf 81 walk"
 *
 * Walks Settings → Security & Recovery → family passphrase: a 6-word suggestion, a weak
 * typed phrase refused with a reason and a low meter, a strong phrase saved; then the
 * dev benchmark page. Shoots light + dark at phone and desktop and reads the images back.
 */

const SHOTS = 'screenshots/kdf-81';
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 900 };

async function setDark(page: Page, dark: boolean) {
  await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
  await page.evaluate((d) => document.documentElement.classList.toggle('dark', d), dark);
  await page.waitForTimeout(250);
}
async function shot(page: Page, name: string) {
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
}
async function shotBoth(page: Page, name: string) {
  for (const [vp, vpName] of [
    [DESKTOP, 'desktop'],
    [PHONE, 'phone'],
  ] as const) {
    await page.setViewportSize(vp);
    await setDark(page, false);
    await shot(page, `${name}-${vpName}-light`);
    await setDark(page, true);
    await shot(page, `${name}-${vpName}-dark`);
  }
  await page.setViewportSize(DESKTOP);
  await setDark(page, false);
}

test.describe('kdf 81 walk', () => {
  test('passphrase editor: suggest, weak refused, strong saved', async ({ page }) => {
    const consoleRows: string[] = [];
    page.on('console', (m) => {
      const t = m.text();
      if (t.includes('kdf') || t.includes('passphrase')) consoleRows.push(t);
    });

    await page.setViewportSize(DESKTOP);
    await gotoRoute(page, '/');
    await bypassLoginIfNeeded(page);

    await gotoRoute(page, '/settings');
    await page.getByText(ui('settings.card.security'), { exact: true }).first().click();
    await page.getByRole('button', { name: ui('recovery.passphraseSet') }).click();

    // 1. Suggestion: six hyphen-joined lowercase words.
    const suggestion = page.getByTestId('passphrase-suggestion');
    await expect(suggestion).toBeVisible({ timeout: 15000 });
    await expect
      .poll(async () => (await suggestion.textContent())?.trim().split('-').length, {
        timeout: 15000,
      })
      .toBe(6);
    const suggested = (await suggestion.textContent())!.trim();
    expect(suggested).toMatch(/^[a-z]+(-[a-z]+){5}$/);
    await shotBoth(page, '01-suggestion');

    // 2. Suggest another gives a different phrase.
    await page.getByRole('button', { name: ui('recovery.passphraseRegenerate') }).click();
    await expect.poll(async () => (await suggestion.textContent())?.trim()).not.toBe(suggested);

    // 3. Own phrase, weak: meter low, Save disabled.
    await page.getByRole('button', { name: ui('recovery.passphraseUseOwn') }).click();
    const input = page.getByLabel(ui('recovery.passphraseTitle'));
    await input.fill('i love my kids 1');
    const meter = page.getByTestId('strength-meter');
    await expect(meter).toBeVisible({ timeout: 20000 });
    await expect
      .poll(async () => meter.getAttribute('aria-valuenow'), { timeout: 30000 })
      .not.toBe('4');
    const saveBtn = page.getByRole('button', { name: ui('action.save') });
    await expect(saveBtn).toBeDisabled();
    await shotBoth(page, '02-weak');

    // 3b. Legacy 4-word shape (any separator) is also refused.
    await input.fill('apple anchor autumn bacon');
    await expect
      .poll(async () => meter.getAttribute('aria-valuenow'), { timeout: 30000 })
      .not.toBe('4');
    await expect(saveBtn).toBeDisabled();

    // 4. Strong phrase: meter 4, Save enabled, saved → "is set".
    await input.fill(suggested);
    await expect
      .poll(async () => meter.getAttribute('aria-valuenow'), { timeout: 30000 })
      .toBe('4');
    await expect(saveBtn).toBeEnabled();
    await shotBoth(page, '03-strong');
    await saveBtn.click();
    // The E2E harness creates a MEMORY-provider pod with no `.beanpod` envelope ("No data
    // file" in the sidebar), so the store refuses the save with `recovery.podNotOpen`, as
    // it did before #81. A real pod (file or Drive) is the manual check in the plan's
    // Testing Plan step 2. Accept either outcome here and record which one happened.
    const saved = page.getByText(ui('recovery.passphraseIsSet'));
    const refused = page.getByRole('alert').filter({ hasText: ui('recovery.podNotOpen') });
    await expect(saved.or(refused)).toBeVisible({ timeout: 15000 });
    console.log(
      '[kdf-81 walk] save outcome:',
      (await saved.isVisible())
        ? 'saved (envelope present)'
        : 'refused: pod has no envelope (E2E memory provider)'
    );
    await shotBoth(page, '04-after-save');

    // 5. The envelope wrap records its iterations (gate closed in dev → 100000).
    const recorded = await page.evaluate(async () => {
      const dbs = await indexedDB.databases();
      return dbs.map((d) => d.name);
    });
    console.log('[kdf-81 walk] indexedDB databases:', recorded.join(', '));
    console.log('[kdf-81 walk] console rows:', consoleRows.slice(0, 20).join('\n'));
  });

  test('dev benchmark page renders and runs', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await gotoRoute(page, '/dev/kdf-benchmark');
    await expect(page.getByRole('button', { name: /run suite/i })).toBeVisible({ timeout: 15000 });
    await shotBoth(page, '10-benchmark-idle');
    await page.getByRole('button', { name: /run suite/i }).click();
    await expect(page.getByText(/600,?000/).first()).toBeVisible({ timeout: 120000 });
    await expect
      .poll(async () => (await page.locator('table tbody tr').count()) >= 4, { timeout: 120000 })
      .toBe(true);
    await shotBoth(page, '11-benchmark-results');
    const text = await page.locator('table').innerText();
    console.log('[kdf-81 walk] benchmark table:\n' + text);
  });
});
