import { test, expect } from '../fixtures/test';
import { IndexedDBHelper } from '../helpers/indexeddb';
import { bypassLoginIfNeeded } from '../helpers/auth';

test.describe('Sound Effects', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    const dbHelper = new IndexedDBHelper(page);
    await dbHelper.clearAllData();
    await page.goto('/');
    await bypassLoginIfNeeded(page);
  });

  test('settings shows sound toggle, checked by default', async ({ page }) => {
    await page.goto('/settings');
    const toggle = page.getByTestId('sound-toggle');
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
  });

  test('toggling sound off and reloading persists the setting', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForTimeout(500); // Wait for splash overlay to fully disappear
    const toggle = page.getByTestId('sound-toggle');

    // Toggle off
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');

    // Wait for IndexedDB write to complete before reloading
    await page.waitForTimeout(1500);

    // Reload and verify persistence
    await page.reload();
    await expect(page.getByTestId('sound-toggle')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('sound-toggle')).toHaveAttribute('aria-checked', 'false', {
      timeout: 5000,
    });
  });

  test('sound toggle can be re-enabled', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForTimeout(500); // Wait for splash overlay to fully disappear
    const toggle = page.getByTestId('sound-toggle');

    // Disable then re-enable
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
  });
});
