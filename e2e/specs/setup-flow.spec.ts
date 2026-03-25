import { test, expect } from '../fixtures/test';
import { IndexedDBHelper } from '../helpers/indexeddb';
import { navigateToSetupStep3 } from '../helpers/auth';
import { ui } from '../helpers/ui-strings';

test.describe('Setup Flow', () => {
  test('Fresh setup creates pod with family member and persists to IndexedDB', async ({ page }) => {
    // Navigate first so we have a page context for IndexedDB operations
    await page.goto('/');
    const dbHelper = new IndexedDBHelper(page);
    await dbHelper.clearAllData();
    await page.goto('/');

    // Walk through the full setup wizard: homepage → welcome → create pod steps 1-3
    await navigateToSetupStep3(page);

    // Add a family member with birthday during step 3
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

    // Form should collapse after adding — "add another" prompt shown
    await expect(page.getByText(/add another family member/i)).toBeVisible();

    // Finish setup
    await page.getByRole('button', { name: ui('loginV6.finish') }).click();
    await page.waitForURL('/nook', { timeout: 60000 });

    // Verify data persists in IndexedDB
    const data = await dbHelper.exportData();

    // Owner (John Doe) from setup + added family member (Jane Doe)
    expect(data.familyMembers).toHaveLength(2);
    expect(data.familyMembers.find((m) => m.name === 'John Doe')).toBeDefined();
    expect(data.settings?.baseCurrency).toBe('USD');

    // Verify the added member was persisted with birthday
    const jane = data.familyMembers.find((m) => m.name === 'Jane Doe');
    expect(jane).toBeDefined();
    expect(jane!.dateOfBirth).toEqual({ month: 3, day: 15 });
  });
});
