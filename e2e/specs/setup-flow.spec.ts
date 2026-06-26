import { test, expect } from '../fixtures/test';
import { IndexedDBHelper } from '../helpers/indexeddb';
import { navigateToAddMembers } from '../helpers/auth';
import { gotoRoot } from '../helpers/navigation';
import { ui } from '../helpers/ui-strings';

test.describe('Setup Flow', () => {
  test('Fresh setup creates pod with family member and persists to IndexedDB', async ({ page }) => {
    // Navigate first so we have a page context for IndexedDB operations
    await gotoRoot(page);
    const dbHelper = new IndexedDBHelper(page);
    await dbHelper.clearAllData();
    await gotoRoot(page);

    // Walk through the create flow: homepage → welcome → identity → injected
    // storage → password → the add-members step on the finish surface.
    await navigateToAddMembers(page);

    // Open the add-member form by clicking the "Add an adult" chip. The
    // form is no longer pre-opened — per the 2026-05-14 step-3 simplification,
    // the empty state shows two chip buttons (Add an adult / Add a little bean)
    // and the form only appears once the user explicitly opts in.
    await page.getByRole('button', { name: ui('loginV6.addAnAdult') }).click();

    // Add a family member with birthday during step 3
    // Add Member button should be disabled when name/birthday not filled
    const addButton = page.getByRole('button', { name: ui('loginV6.addMember') });
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
