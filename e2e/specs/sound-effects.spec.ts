import { test, expect } from '@playwright/test';
import { SetupPage } from '../page-objects/SetupPage';
import { IndexedDBHelper } from '../helpers/indexeddb';
import { bypassLoginIfNeeded } from '../helpers/auth';

test.describe('Sound Effects', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    const dbHelper = new IndexedDBHelper(page);
    await dbHelper.clearAllData();
    await page.goto('/');
    await bypassLoginIfNeeded(page);

    // Complete setup
    const setupPage = new SetupPage(page);
    await setupPage.completeSetup();
  });

  test('settings shows sound toggle, checked by default', async ({ page }) => {
    await page.goto('/settings');
    const toggle = page.getByTestId('sound-toggle');
    await expect(toggle).toBeVisible();
    await expect(toggle).toBeChecked();
  });

  test('toggling sound off and reloading persists the setting', async ({ page }) => {
    await page.goto('/settings');
    const toggle = page.getByTestId('sound-toggle');

    // Uncheck
    await toggle.uncheck();
    await expect(toggle).not.toBeChecked();

    // Reload and verify persistence
    await page.reload();
    await expect(page.getByTestId('sound-toggle')).not.toBeChecked();
  });

  test('sound toggle can be re-enabled', async ({ page }) => {
    await page.goto('/settings');
    const toggle = page.getByTestId('sound-toggle');

    // Disable then re-enable
    await toggle.uncheck();
    await expect(toggle).not.toBeChecked();

    await toggle.check();
    await expect(toggle).toBeChecked();
  });
});
