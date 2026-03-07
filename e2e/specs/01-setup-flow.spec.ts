import { test, expect } from '../fixtures/test';
import { IndexedDBHelper } from '../helpers/indexeddb';
import { bypassLoginIfNeeded, navigateToSetupStep3 } from '../helpers/auth';

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

    // Click through homepage to WelcomeGate
    await page.getByTestId('homepage-get-started').click();

    // Set e2e_auto_auth before clicking create to bypass InviteGateOverlay
    await page.evaluate(() => {
      sessionStorage.setItem('e2e_auto_auth', 'true');
    });
    await page.getByTestId('create-pod-button').click();

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

  test('should add a family member with birthday on step 3', async ({ page }) => {
    await page.goto('/');
    const dbHelper = new IndexedDBHelper(page);
    await dbHelper.clearAllData();
    await page.goto('/');
    await navigateToSetupStep3(page);

    // Add Member button should be disabled when name/birthday not filled
    const addButton = page.getByRole('button', { name: /add member/i });
    await expect(addButton).toBeDisabled();

    // Fill name
    await page.getByPlaceholder(/name/i).fill('Jane Doe');

    // Button still disabled — birthday month and day are required
    await expect(addButton).toBeDisabled();

    // Select month and day
    const selects = page.locator('select');
    await selects.nth(0).selectOption('3'); // March
    await selects.nth(1).selectOption('15'); // 15th

    // Now the button should be enabled
    await expect(addButton).toBeEnabled();
    await addButton.click();

    // Member should appear in the list
    await expect(page.getByText('Jane Doe')).toBeVisible();

    // Form should be reset — add button disabled again
    await expect(addButton).toBeDisabled();

    // Finish setup
    await page.getByRole('button', { name: 'Finish' }).click();
    await page.waitForURL('/nook', { timeout: 60000 });

    // Verify member was persisted with birthday
    const data = await dbHelper.exportData();
    const jane = data.familyMembers.find((m) => m.name === 'Jane Doe');
    expect(jane).toBeDefined();
    expect(jane!.dateOfBirth).toEqual({ month: 3, day: 15 });
  });

  test('should add a family member with birthday including year', async ({ page }) => {
    await page.goto('/');
    const dbHelper = new IndexedDBHelper(page);
    await dbHelper.clearAllData();
    await page.goto('/');
    await navigateToSetupStep3(page);

    // Fill name and birthday with year
    await page.getByPlaceholder(/name/i).fill('Baby Bean');
    const selects = page.locator('select');
    await selects.nth(0).selectOption('12'); // December
    await selects.nth(1).selectOption('25'); // 25th
    await page.getByPlaceholder('Year').fill('2020');

    // Select Child role
    await page.getByRole('button', { name: /child/i }).click();

    await page.getByRole('button', { name: /add member/i }).click();
    await expect(page.getByText('Baby Bean')).toBeVisible();

    // Finish setup
    await page.getByRole('button', { name: 'Finish' }).click();
    await page.waitForURL('/nook', { timeout: 60000 });

    // Verify member was persisted with full birthday
    const data = await dbHelper.exportData();
    const baby = data.familyMembers.find((m) => m.name === 'Baby Bean');
    expect(baby).toBeDefined();
    expect(baby!.dateOfBirth).toEqual({ month: 12, day: 25, year: 2020 });
    expect(baby!.ageGroup).toBe('child');
  });
});
