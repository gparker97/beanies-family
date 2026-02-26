import { test, expect } from '@playwright/test';
import { IndexedDBHelper } from '../helpers/indexeddb';
import { bypassLoginIfNeeded } from '../helpers/auth';

test.describe('Setup Flow', () => {
  test('should complete fresh setup successfully', async ({ page }) => {
    // Navigate first so we have a page context for IndexedDB operations
    await page.goto('/');
    const dbHelper = new IndexedDBHelper(page);
    await dbHelper.clearAllData();
    // Reload after clearing so the app re-initializes with empty state
    await page.goto('/');
    await bypassLoginIfNeeded(page);

    await expect(page).toHaveURL('/nook');

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

    // Click "Create a new pod" on WelcomeGate
    await page.getByRole('button', { name: 'Create a new pod' }).click();

    // Fill some fields but leave password empty to bypass native required
    // validation on the first field and trigger the JS-level check
    await page.getByLabel('Family Name').fill('Test');
    await page.getByLabel('Your Name').fill('Test');
    await page.getByLabel('Email').fill('test@example.com');
    // Leave Password and Confirm password empty

    // Remove required attribute so native validation doesn't block submit
    await page.evaluate(() => {
      document.querySelectorAll('input[required]').forEach((el) => {
        el.removeAttribute('required');
      });
    });

    await page.getByRole('button', { name: 'Next' }).click();

    // Should still be on welcome page with custom JS validation error
    await expect(page).toHaveURL('/welcome');
    await expect(page.getByText('Please fill in all fields')).toBeVisible();
  });
});
