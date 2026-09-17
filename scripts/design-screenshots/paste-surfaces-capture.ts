import { test, expect } from '../../e2e/fixtures/test';
import { gotoRoot, gotoRoute } from '../../e2e/helpers/navigation';

/**
 * NOT a CI test. Proves the paste affordance is actually ON each surface a person holding a
 * link can land on, by looking for it in a real render rather than by reading the markup.
 *
 * It exists because reading the markup got it wrong: the panel was nested inside the
 * `google_drive` arm of the join step, so the one arrival that needs it most — tapping
 * "Join your family" with no url params — never rendered it.
 *
 * Run: npx playwright test -c playwright.design.config.ts --grep "paste-surfaces"
 */
const OUT = process.env.SHOT_DIR ?? 'screenshots';

test('paste-surfaces: welcome gate, join screen, sign-in screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });

  // 1. The welcome gate.
  await gotoRoot(page);
  await gotoRoute(page, '/welcome');
  await page.waitForLoadState('networkidle');
  await expect(page.getByTestId('open-paste-link').first()).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: `${OUT}/surface-welcome.png`, fullPage: true });

  // 2. The join screen with NO params — the arm that was broken.
  await gotoRoute(page, '/join');
  await page.waitForLoadState('networkidle');
  await expect(page.getByTestId('open-paste-link').first()).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: `${OUT}/surface-join.png`, fullPage: true });

  // 3. The "Welcome back" sign-in screen. Reached by tapping the card, because that is how a
  // person gets there and because the route alone does not decide which view renders.
  await gotoRoute(page, '/welcome');
  await page.waitForLoadState('networkidle');
  await page.getByText('Welcome back', { exact: false }).first().click();
  await expect(page.getByTestId('open-paste-link').first()).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: `${OUT}/surface-signin.png`, fullPage: true });
});
