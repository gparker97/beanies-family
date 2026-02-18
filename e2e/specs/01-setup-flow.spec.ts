import { test, expect } from '@playwright/test';
import { SetupPage } from '../page-objects/SetupPage';
import { IndexedDBHelper } from '../helpers/indexeddb';

test.describe('Setup Flow', () => {
  test('should complete fresh setup successfully', async ({ page }) => {
    // Navigate first so we have a page context for IndexedDB operations
    await page.goto('/');
    const dbHelper = new IndexedDBHelper(page);
    await dbHelper.clearAllData();
    // Reload after clearing so the app re-initializes with empty state
    await page.goto('/');
    // Bypass login (Cognito is configured but we test without an account)
    await page.getByRole('button', { name: 'Continue without an account' }).click();
    await page.waitForURL('/setup');

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
    // Navigate first so we have a page context for IndexedDB operations
    await page.goto('/');
    const dbHelper = new IndexedDBHelper(page);
    await dbHelper.clearAllData();
    // Reload after clearing so the app re-initializes with empty state
    await page.goto('/');
    // Bypass login (Cognito is configured but we test without an account)
    await page.getByRole('button', { name: 'Continue without an account' }).click();
    await page.waitForURL('/setup');

    const setupPage = new SetupPage(page);

    // Try to continue without filling form
    await setupPage.continueButton.click();

    // Should still be on setup page
    await expect(page).toHaveURL('/setup');
  });
});
