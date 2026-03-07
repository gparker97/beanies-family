import { test, expect } from '../fixtures/test';
import { bypassLoginIfNeeded } from '../helpers/auth';
import { IndexedDBHelper } from '../helpers/indexeddb';

test.describe('Onboarding Wizard', () => {
  /**
   * Helper: create a pod via normal setup flow, then restart onboarding
   * so the wizard is visible (bypassing the e2e_auto_auth auto-skip).
   */
  async function setupWithOnboarding(page: import('@playwright/test').Page) {
    await page.goto('/');
    const dbHelper = new IndexedDBHelper(page);
    await dbHelper.clearAllData();
    await page.goto('/');
    await bypassLoginIfNeeded(page);

    // bypassLoginIfNeeded sets e2e_auto_auth which auto-skips onboarding.
    // Restart it via Settings and clear the flag so the wizard renders.
    await page.goto('/settings');
    await page.getByTestId('restart-onboarding').click();

    // Wait for the router navigation triggered by restart-onboarding to settle
    await page.waitForURL('**/nook', { timeout: 10000 });

    // Remove e2e_auto_auth so OnboardingWizard doesn't auto-skip on next mount
    await page.evaluate(() => {
      sessionStorage.removeItem('e2e_auto_auth');
    });

    // Full reload so the wizard mounts fresh without the e2e_auto_auth flag
    await page.goto('/nook');
    await page.getByTestId('onboarding-wizard').waitFor({ state: 'visible', timeout: 10000 });
  }

  test('shows wizard on /nook after restart onboarding', async ({ page }) => {
    await setupWithOnboarding(page);
    await expect(page.getByTestId('onboarding-wizard')).toBeVisible();
  });

  test('step 1: welcome screen with pillar cards and CTA', async ({ page }) => {
    await setupWithOnboarding(page);

    // Step 1 should show the "Let\'s Go" CTA
    await expect(page.getByTestId('onboarding-start')).toBeVisible();
  });

  test('navigates from step 1 to step 2', async ({ page }) => {
    await setupWithOnboarding(page);

    await page.getByTestId('onboarding-start').click();

    // Step 2 should show account creation
    await expect(page.getByTestId('onboarding-add-account')).toBeVisible({ timeout: 5000 });
  });

  test('step 2: can add an account', async ({ page }) => {
    await setupWithOnboarding(page);

    // Go to step 2
    await page.getByTestId('onboarding-start').click();
    await page.getByTestId('onboarding-add-account').waitFor({ state: 'visible', timeout: 5000 });

    // Open the bank combobox and select the first option
    await page.getByTestId('onboarding-bank-select').getByTestId('combobox-trigger').click();
    await page.getByTestId('combobox-dropdown').waitFor({ state: 'visible', timeout: 3000 });
    await page.getByTestId('combobox-dropdown').locator('button').first().click();
    await page.getByTestId('onboarding-add-account').click();

    // Should show confirmation
    await expect(page.getByText(/added/i)).toBeVisible({ timeout: 5000 });
  });

  test('step 2 to step 3 navigation via Next button', async ({ page }) => {
    await setupWithOnboarding(page);

    // Step 1 → Step 2
    await page.getByTestId('onboarding-start').click();
    await page.getByTestId('onboarding-add-account').waitFor({ state: 'visible', timeout: 5000 });

    // Step 2 → Step 3
    await page.getByTestId('onboarding-next').click();

    // Step 3 should show activity presets
    await expect(page.getByText(/family life/i)).toBeVisible({ timeout: 5000 });
  });

  test('step 3: can select an activity preset', async ({ page }) => {
    await setupWithOnboarding(page);

    // Navigate to step 3
    await page.getByTestId('onboarding-start').click();
    await page.getByTestId('onboarding-next').waitFor({ state: 'visible', timeout: 5000 });
    await page.getByTestId('onboarding-next').click();
    await expect(page.getByText(/family life/i)).toBeVisible({ timeout: 5000 });

    // Click an activity preset chip (e.g., Soccer)
    await page.getByRole('button', { name: /soccer/i }).click();

    // Should show the activity card with day selectors
    await expect(page.getByTestId('onboarding-activity-card')).toBeVisible();
  });

  test('step 3 to completion screen', async ({ page }) => {
    await setupWithOnboarding(page);

    // Navigate through steps 1 → 2 → 3 → Complete
    await page.getByTestId('onboarding-start').click();
    await page.getByTestId('onboarding-next').waitFor({ state: 'visible', timeout: 5000 });
    await page.getByTestId('onboarding-next').click();
    await expect(page.getByText(/family life/i)).toBeVisible({ timeout: 5000 });

    // Click "All Done" to go to completion
    await page.getByTestId('onboarding-next').click();

    // Completion screen should show
    await expect(page.getByTestId('onboarding-finish')).toBeVisible({ timeout: 5000 });
  });

  test('completion screen closes wizard and returns to nook', async ({ page }) => {
    await setupWithOnboarding(page);

    // Navigate through all steps
    await page.getByTestId('onboarding-start').click();
    await page.getByTestId('onboarding-next').waitFor({ state: 'visible', timeout: 5000 });
    await page.getByTestId('onboarding-next').click();
    await expect(page.getByText(/family life/i)).toBeVisible({ timeout: 5000 });
    await page.getByTestId('onboarding-next').click();
    await page.getByTestId('onboarding-finish').waitFor({ state: 'visible', timeout: 5000 });

    // Click "Enter The Nook"
    await page.getByTestId('onboarding-finish').click();

    // Wizard should close
    await expect(page.getByTestId('onboarding-wizard')).not.toBeVisible({ timeout: 5000 });
  });

  test('skip closes wizard at any step', async ({ page }) => {
    await setupWithOnboarding(page);

    // Go to step 2
    await page.getByTestId('onboarding-start').click();
    await page.getByTestId('onboarding-next').waitFor({ state: 'visible', timeout: 5000 });

    // Click skip
    await page.getByRole('button', { name: /skip/i }).click();

    // Wizard should close
    await expect(page.getByTestId('onboarding-wizard')).not.toBeVisible({ timeout: 5000 });
  });

  test('back button navigates to previous step', async ({ page }) => {
    await setupWithOnboarding(page);

    // Step 1 → Step 2
    await page.getByTestId('onboarding-start').click();
    await page.getByTestId('onboarding-next').waitFor({ state: 'visible', timeout: 5000 });

    // Step 2 → Step 3
    await page.getByTestId('onboarding-next').click();
    await expect(page.getByText(/family life/i)).toBeVisible({ timeout: 5000 });

    // Back → Step 2
    await page.getByRole('button', { name: /back/i }).click();
    await expect(page.getByTestId('onboarding-add-account')).toBeVisible({ timeout: 5000 });
  });

  test('restart onboarding in settings re-shows wizard', async ({ page }) => {
    await setupWithOnboarding(page);

    // Complete the wizard
    await page.getByTestId('onboarding-start').click();
    await page.getByTestId('onboarding-next').waitFor({ state: 'visible', timeout: 5000 });
    await page.getByTestId('onboarding-next').click();
    await expect(page.getByText(/family life/i)).toBeVisible({ timeout: 5000 });
    await page.getByTestId('onboarding-next').click();
    await page.getByTestId('onboarding-finish').waitFor({ state: 'visible', timeout: 5000 });
    await page.getByTestId('onboarding-finish').click();
    await expect(page.getByTestId('onboarding-wizard')).not.toBeVisible({ timeout: 5000 });

    // Go to Settings and restart
    await page.goto('/settings');
    await page.getByTestId('restart-onboarding').click();

    // Go back to /nook — wizard should reappear
    await page.goto('/nook');
    await expect(page.getByTestId('onboarding-wizard')).toBeVisible({ timeout: 10000 });
  });
});
