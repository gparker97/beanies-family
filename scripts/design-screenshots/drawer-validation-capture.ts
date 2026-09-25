import { test } from '../../e2e/fixtures/test';
import { bypassLoginIfNeeded } from '../../e2e/helpers/auth';
import { gotoRoute } from '../../e2e/helpers/navigation';
import { openAddActivity } from '../../e2e/helpers/activity-modal';
import type { Page } from '@playwright/test';

/**
 * NOT a test — the browser walk for "Save tells you what is missing"
 * (docs/plans/2026-09-25-drawer-save-validation.md). Lives OUTSIDE `e2e/specs/` on purpose.
 *   npx playwright test -c playwright.design.config.ts --grep "drawer validation"
 *
 * Logs facts (toast text, which field pulsed, whether it is on screen, Save's colours) and
 * saves screenshots to look at. Soft-fails each step so one bad selector does not hide the rest.
 */
const SHOTS = 'scratch-shots/drawer-validation';

const WIDTHS = [
  { name: 'phone', size: { width: 360, height: 740 } },
  { name: 'desktop', size: { width: 1280, height: 800 } },
];

const dialog = (page: Page) => page.locator('[role="dialog"]').last();

async function shot(page: Page, name: string) {
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

/** The facts an invalid Save should produce, read straight from the DOM. */
async function afterBlockedSave(page: Page, tag: string) {
  await page.waitForTimeout(550); // scroll settles, pulse lands (400ms)
  const facts = await page.evaluate(() => {
    const pulsed = document.querySelector('.attention-pulse') as HTMLElement | null;
    const r = pulsed?.getBoundingClientRect();
    const toast = [...document.querySelectorAll('body *')]
      .map((e) => (e as HTMLElement).innerText ?? '')
      .find((txt) => /still needed/i.test(txt) && txt.length < 300);
    return {
      pulsed: pulsed?.getAttribute('data-form-label') ?? null,
      pulsedOnScreen: r ? r.top >= 0 && r.bottom <= window.innerHeight : null,
      toast: toast?.replace(/\s+/g, ' ').trim() ?? null,
      requiredMessages: [...document.querySelectorAll('p')].filter((p) =>
        /this field is required/i.test(p.textContent ?? '')
      ).length,
    };
  });
  console.log(`[${tag}] blocked:`, JSON.stringify(facts));
  await shot(page, `${tag}-blocked`);
}

async function saveLook(page: Page, name: RegExp, tag: string) {
  const btn = dialog(page).getByRole('button', { name }).last();
  const look = await btn.evaluate((el) => {
    const s = getComputedStyle(el);
    return {
      bg: s.backgroundImage !== 'none' ? 'gradient' : s.backgroundColor,
      color: s.color,
      disabled: (el as HTMLButtonElement).disabled,
    };
  });
  console.log(`[${tag}] save look:`, JSON.stringify(look));
  return btn;
}

async function step(tag: string, fn: () => Promise<void>) {
  try {
    await fn();
  } catch (e) {
    console.log(`[${tag}] STEP FAILED: ${(e as Error).message.split('\n')[0]}`);
  }
}

for (const theme of ['light', 'dark'] as const)
  for (const w of WIDTHS) {
    test(`drawer validation ${theme} ${w.name}`, async ({ page }) => {
      const tagBase = `${theme}-${w.name}`;
      page.on('console', (m) => {
        if (/useFormValidation|\[theme\]/.test(m.text()))
          console.log(`[console.${m.type()}] ${m.text()}`);
      });
      page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
      page.setDefaultTimeout(10_000);
      await page.emulateMedia({ colorScheme: theme });
      await page.setViewportSize(w.size);
      await gotoRoute(page, '/');
      await bypassLoginIfNeeded(page);
      const setTheme = () =>
        page.evaluate(
          (t) => document.documentElement.classList.toggle('dark', t === 'dark'),
          theme
        );
      await setTheme();

      // 1. Activity: scroll to the bottom, tap Save on an empty drawer.
      await step(`${tagBase}-activity`, async () => {
        await gotoRoute(page, '/activities');
        await setTheme();
        await openAddActivity(page);
        await dialog(page).getByRole('button', { name: 'Add Activity', exact: true }).waitFor();
        await page.waitForTimeout(400);
        await saveLook(page, /^Add Activity$/, `${tagBase}-activity-empty`);
        await shot(page, `${tagBase}-activity-0-open`);
        await page.evaluate(() => {
          document
            .querySelectorAll('[role="dialog"] .overflow-y-auto')
            .forEach((el) => (el.scrollTop = el.scrollHeight));
        });
        await dialog(page).getByRole('button', { name: 'Add Activity', exact: true }).click();
        await afterBlockedSave(page, `${tagBase}-activity`);

        // 1b. Recurring + cost + Custom schedule with the period cleared.
        await dialog(page)
          .getByPlaceholder(/activity/i)
          .first()
          .fill('Swimming');
        await dialog(page)
          .locator('button', { hasText: /^\s*🔁\s*Recurring/ })
          .first()
          .click();
        await dialog(page).locator('input[type="number"]').first().fill('40');
        await dialog(page).getByRole('button', { name: 'Custom', exact: true }).last().click();
        const period = dialog(page).locator('[data-form-label="Custom Period"] input');
        await period.fill('');
        await dialog(page).getByRole('button', { name: 'Add Activity', exact: true }).click();
        await afterBlockedSave(page, `${tagBase}-activity-custom`);
        await page.keyboard.press('Escape');
      });

      // 2. Goal: not ready → blocked → fill both → ready.
      await step(`${tagBase}-goal`, async () => {
        await gotoRoute(page, '/goals');
        await setTheme();
        await page
          .getByRole('button', { name: /add goal/i })
          .first()
          .click();
        await dialog(page)
          .getByRole('button', { name: /^Add Goal$/ })
          .waitFor();
        await page.waitForTimeout(400);
        const btn = await saveLook(page, /^Add Goal$/, `${tagBase}-goal-empty`);
        await shot(page, `${tagBase}-goal-0-notready`);
        await btn.click();
        await afterBlockedSave(page, `${tagBase}-goal`);
        await dialog(page).locator('input[type="text"]').first().fill('New bikes');
        await dialog(page).locator('input[type="number"]').first().fill('500');
        await page.waitForTimeout(250);
        await saveLook(page, /^Add Goal$/, `${tagBase}-goal-filled`);
        await shot(page, `${tagBase}-goal-2-ready`);
        await page.keyboard.press('Escape');
      });

      // 3. Transaction: empty Save.
      await step(`${tagBase}-transaction`, async () => {
        await gotoRoute(page, '/transactions');
        await setTheme();
        await page.getByRole('button', { name: /\+.*Add Transaction/ }).click();
        await dialog(page)
          .getByRole('button', { name: /^Add Transaction$/ })
          .waitFor();
        await page.waitForTimeout(400);
        const btn = await saveLook(page, /^Add Transaction$/, `${tagBase}-tx-empty`);
        await btn.click();
        await afterBlockedSave(page, `${tagBase}-transaction`);
        await page.keyboard.press('Escape');
      });

      // 4. Account: credit card with a bad last-4, then try to collapse More Details.
      await step(`${tagBase}-account`, async () => {
        await gotoRoute(page, '/accounts');
        await setTheme();
        await page.getByRole('button', { name: 'Add Account' }).first().click();
        await dialog(page).getByPlaceholder('Account Name').fill('Visa');
        await dialog(page).getByRole('button', { name: '🏦 Bank', exact: true }).click();
        await dialog(page).getByRole('button', { name: '💳 Credit Card', exact: true }).click();
        await dialog(page)
          .getByRole('button', { name: /more details/i })
          .click();
        await dialog(page).locator('[data-form-label="Last 4 Digits"]').locator('input').fill('12');
        await dialog(page)
          .getByRole('button', { name: /more details/i })
          .click(); // try to collapse
        await page.waitForTimeout(250);
        const stillOpen = await dialog(page).locator('[data-form-label="Last 4 Digits"]').count();
        console.log(`[${tagBase}-account] details still open after collapse tap:`, stillOpen > 0);
        await dialog(page)
          .getByRole('button', { name: /^Add Account$/ })
          .last()
          .click();
        await afterBlockedSave(page, `${tagBase}-account`);
        await page.keyboard.press('Escape');
      });

      // 5. Vacation wizard step 1: tap Next empty; then fill name and check it stays blocked.
      await step(`${tagBase}-wizard`, async () => {
        await gotoRoute(page, '/travel');
        await setTheme();
        await page
          .getByRole('button', { name: /plan a trip/i })
          .first()
          .click();
        const next = dialog(page).getByRole('button', { name: /^Next:/ });
        await next.waitFor();
        await page.waitForTimeout(400);
        await saveLook(page, /^Next:/, `${tagBase}-wizard-empty`);
        await next.click();
        await afterBlockedSave(page, `${tagBase}-wizard`);
        await page.keyboard.press('Escape');
      });
    });
  }

// Dark look: the app re-applies its saved theme on navigation, so force `html.dark` only after
// the drawer is open, then read Save's colours and ring/message ink straight from the DOM.
test('drawer validation dark forced', async ({ page }) => {
  page.setDefaultTimeout(10_000);
  await page.setViewportSize({ width: 360, height: 740 });
  await gotoRoute(page, '/');
  await bypassLoginIfNeeded(page);
  await gotoRoute(page, '/goals');
  await page
    .getByRole('button', { name: /add goal/i })
    .first()
    .click();
  const save = dialog(page).getByRole('button', { name: /^Add Goal$/ });
  await save.waitFor();
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  await page.waitForTimeout(300);
  await saveLook(page, /^Add Goal$/, 'forced-dark-goal-empty');
  await save.click();
  await afterBlockedSave(page, 'forced-dark-goal');
  const ink = await page.evaluate(() => {
    const p = [...document.querySelectorAll('p')].find((e) =>
      /this field is required/i.test(e.textContent ?? '')
    );
    return p ? getComputedStyle(p).color : null;
  });
  console.log('[forced-dark-goal] required message ink:', ink);
  await dialog(page).locator('input[type="text"]').first().fill('New bikes');
  await dialog(page).locator('input[type="number"]').first().fill('500');
  await page.waitForTimeout(250);
  await saveLook(page, /^Add Goal$/, 'forced-dark-goal-filled');
  await shot(page, 'forced-dark-goal-ready');
});
