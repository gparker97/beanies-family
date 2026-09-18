import { test, expect } from '../../e2e/fixtures/test';

/**
 * #98 verification harness. NOT a CI test, and deliberately OUTSIDE `e2e/specs/` — a file there
 * joins the CI matrix and counts against the ADR-007 budget (23 of a hard 25).
 *
 * WHAT THIS PROVES, and why it is worth a browser at all: this change added a leaf module that
 * `googleAuth` imports, and `googleAuth` is imported by most of the app. An import CYCLE would
 * pass type-check and pass every unit test (they mock the graph) and then fail at runtime during
 * module initialisation, as an undefined function or a TDZ error. Only a real page load catches
 * that. It also checks the registered flag is actually reachable in the UI.
 *
 * WHAT IT CANNOT PROVE, and does not pretend to: the Google redirect itself. Reaching that branch
 * needs a real Drive token and completing it needs a real Google consent screen. Manual list.
 *
 *   npx playwright test -c playwright.design.config.ts --grep "picker flag"
 */

test('picker flag — the app boots with the new import graph, in both themes', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

  await page.goto('/');
  await page.waitForLoadState('networkidle');

  // 1. THE IMPORT-CYCLE CHECK. These are the shapes a cycle takes at runtime.
  const fatal = errors.filter((e) =>
    /is not a function|Cannot access .* before initialization|Cannot read properties of undefined \(reading '(logEvent|platformContext|stashPickerSelection)'\)/i.test(
      e
    )
  );
  expect(fatal, `module-init errors: ${fatal.join(' | ')}`).toHaveLength(0);

  // Something actually rendered, so module init genuinely completed.
  await expect(page.locator('#app')).not.toBeEmpty();
  await page.screenshot({ path: 'screenshots/98-boot-light.png' });

  // 2. The new module is present in the graph and its key constant survived bundling.
  const modulesLoaded = await page.evaluate(async () => {
    const m = await import('/src/services/google/pickerRedirect.ts');
    return {
      hasStash: typeof m.stashPickerSelection === 'function',
      hasConsume: typeof m.consumePickerRedirectResult === 'function',
      surface: m.PICKER_EVENTS?.surface,
    };
  });
  expect(modulesLoaded).toEqual({
    hasStash: true,
    hasConsume: true,
    surface: 'system-browser-picker',
  });

  // 3. The round trip works in a REAL browser's sessionStorage, not happy-dom's.
  const roundTrip = await page.evaluate(async () => {
    const m = await import('/src/services/google/pickerRedirect.ts');
    m.stashPickerSelection('FILE_REAL', 'web');
    const first = m.consumePickerRedirectResult();
    const second = m.consumePickerRedirectResult(); // must be null: read-and-clear
    return { first, second };
  });
  expect(roundTrip.first).toMatchObject({ kind: 'picked', fileId: 'FILE_REAL' });
  expect(roundTrip.second).toBeNull();

  // 4. Dark mode, asserted on the PAINTED result — asserting the `dark` class alone once passed
  //    while the picture stayed light.
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  await page.waitForTimeout(400);
  const painted = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(painted, `body background in dark mode: ${painted}`).not.toBe('rgb(248, 249, 250)');
  await page.screenshot({ path: 'screenshots/98-boot-dark.png' });

  // 5. Phone width.
  await page.emulateMedia({ colorScheme: 'light' });
  await page.evaluate(() => document.documentElement.classList.remove('dark'));
  await page.setViewportSize({ width: 400, height: 900 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'screenshots/98-boot-phone.png' });

  console.log(`[verify] console errors seen (non-fatal): ${errors.length}`);
});
