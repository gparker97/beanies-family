import { test, expect } from '@playwright/test';
import { SetupPage } from '../page-objects/SetupPage';
import { IndexedDBHelper } from '../helpers/indexeddb';

test.describe('Setup Flow', () => {
  test('should complete fresh setup successfully', async ({ page }) => {
    await page.goto('/');
    const dbHelper = new IndexedDBHelper(page);
    await dbHelper.clearAllData();

    const setupPage = new SetupPage(page);
    await expect(page).toHaveURL('/setup');

    await setupPage.completeSetup('John Doe', 'john@example.com', 'USD');
    await expect(page).toHaveURL('/dashboard');

    const data = await dbHelper.exportData();
    expect(data.familyMembers).toHaveLength(1);
    expect(data.familyMembers[0].name).toBe('John Doe');
    expect(data.settings?.baseCurrency).toBe('USD');
  });

  test('should validate required fields', async ({ page }) => {
    await page.goto('/');
    const dbHelper = new IndexedDBHelper(page);
    await dbHelper.clearAllData();

    const setupPage = new SetupPage(page);
    await setupPage.goto();

    // Try to continue without filling form
    await setupPage.continueButton.click();

    // Should still be on setup page
    await expect(page).toHaveURL('/setup');
  });
});
