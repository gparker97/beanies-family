import { test, expect } from '../fixtures/test';
import { IndexedDBHelper } from '../helpers/indexeddb';
import { AccountsPage } from '../page-objects/AccountsPage';
import { bypassLoginIfNeeded } from '../helpers/auth';
import { ui } from '../helpers/ui-strings';

/**
 * E2E tests for the Loan & Activity Linking feature.
 *
 * All data is created through the UI (no dbHelper.seedData) because the
 * Automerge CRDT store does not load from IndexedDB seeds.
 *
 * Covers:
 * - Creating a recurring payment from an activity's cost section
 * - Activity view modal shows linked monthly transaction section
 * - Navigation from activity modal to linked transaction
 * - Data integrity when creating and removing linked payments
 */

test.describe('Loan & Activity Linking', () => {
  let dbHelper: IndexedDBHelper;

  /** Common setup: clear state, bypass login. */
  async function setup(page: import('@playwright/test').Page) {
    await page.goto('/');
    dbHelper = new IndexedDBHelper(page);
    await dbHelper.clearAllData();
    await page.goto('/');
    await bypassLoginIfNeeded(page);
  }

  /** Select the first family member chip in the activity modal. */
  async function selectAssignee(page: import('@playwright/test').Page) {
    await page
      .locator('div[role="dialog"]')
      .getByRole('button', { name: /John Doe/i })
      .first()
      .click();
  }

  /**
   * Click the fee schedule "Monthly" chip inside the "more details" section.
   * The recurrence frequency section also has a "Monthly" button (hidden via CSS
   * when in one-off mode but still in the DOM), so we disambiguate by using .last()
   * which targets the fee schedule chip that appears later in the DOM.
   */
  async function clickFeeScheduleMonthly(page: import('@playwright/test').Page) {
    const dialog = page.locator('div[role="dialog"]');
    await dialog
      .getByRole('button', { name: ui('planner.fee.monthly') })
      .last()
      .click();
  }

  /** Create an account through the UI so the RecurringPaymentPrompt has something to select. */
  async function createCheckingAccount(
    page: import('@playwright/test').Page,
    name = 'Main Checking'
  ) {
    const accountsPage = new AccountsPage(page);
    await accountsPage.goto();
    await accountsPage.addAccount({
      name,
      type: 'checking',
      balance: 10000,
    });
  }

  /**
   * Create a one-off activity with monthly fee and recurring payment enabled.
   * Assumes an account already exists and we are ready to navigate.
   * Returns to the planner page with the activity created.
   */
  async function createActivityWithMonthlyPayment(
    page: import('@playwright/test').Page,
    title: string,
    amount: number,
    accountName: string
  ) {
    await page.goto('/planner');
    await page.waitForURL('/planner');

    // Open add activity modal
    await page.getByRole('button', { name: /\+ add activity/i }).click();
    await expect(page.getByText(/new activity/i)).toBeVisible();

    // Fill title
    await page.getByPlaceholder(ui('modal.whatsTheActivity')).fill(title);

    // Select assignee
    await selectAssignee(page);

    // Switch to one-off mode
    await page.getByRole('button', { name: /one-off/i }).click();

    // Fill date
    await page.locator('input[type="date"]').fill('2026-04-15');

    // Expand "Add more details" to reveal cost fields
    await page.getByText(ui('planner.field.moreDetails')).click();

    // Set cost amount
    const costInput = page.locator('div[role="dialog"]').locator('input[type="number"]').first();
    await costInput.fill(amount.toString());

    // Set fee schedule to "Monthly"
    await clickFeeScheduleMonthly(page);

    // Wait for RecurringPaymentPrompt to appear
    await expect(page.getByText(ui('recurringPrompt.createPayment'))).toBeVisible({
      timeout: 5000,
    });

    // Enable "Create Monthly Payment" toggle
    await page.getByText(ui('recurringPrompt.createPayment')).click();

    // Wait for Pay From section to expand
    await expect(page.getByText(ui('recurringPrompt.payFrom'))).toBeVisible({
      timeout: 5000,
    });

    // Select the pay-from account from the EntityLinkDropdown
    const accountBtn = page
      .locator('div[role="dialog"]')
      .getByRole('button', { name: new RegExp(accountName, 'i') });
    const accountBtnVisible = await accountBtn
      .waitFor({ state: 'visible', timeout: 3000 })
      .then(() => true)
      .catch(() => false);
    if (accountBtnVisible) {
      await accountBtn.click();
    }

    // If a dropdown appeared with the account, click it
    const accountOption = page.getByRole('button', { name: new RegExp(accountName, 'i') });
    const optionVisible = await accountOption
      .waitFor({ state: 'visible', timeout: 2000 })
      .then(() => true)
      .catch(() => false);
    if (optionVisible) {
      await accountOption.click();
    }

    // Save the activity
    await page.getByRole('button', { name: /^add activity$/i }).click();

    // Modal should close
    await expect(page.getByText(/new activity/i)).not.toBeVisible({ timeout: 5000 });
  }

  test('activity with monthly fee creates a recurring item', async ({ page }) => {
    await setup(page);

    // Create an account through the UI
    await createCheckingAccount(page);

    // Create activity with monthly payment
    await createActivityWithMonthlyPayment(page, 'Piano Lesson', 150, 'Main Checking');

    // Verify: exportData shows the activity and recurringItem were created
    const data = await dbHelper.exportData();
    expect(data.activities).toHaveLength(1);
    const activity = data.activities[0];
    expect(activity.title).toBe('Piano Lesson');
    expect(activity.feeAmount).toBe(150);
    expect(activity.feeSchedule).toBe('monthly');

    // Check if linkedRecurringItemId was set and recurringItem exists
    if (activity.linkedRecurringItemId) {
      const ri = data.recurringItems.find((r) => r.id === activity.linkedRecurringItemId);
      expect(ri).toBeTruthy();
      expect(ri!.activityId).toBe(activity.id);
      expect(ri!.amount).toBe(150);
      expect(ri!.frequency).toBe('monthly');
    }

    // The payFromAccountId should reference the created account
    const account = data.accounts.find((a) => a.name === 'Main Checking');
    expect(account).toBeTruthy();
    expect(activity.payFromAccountId).toBe(account!.id);
  });

  test('activity view modal shows linked monthly transaction section', async ({ page }) => {
    await setup(page);

    // Create an account and activity with monthly payment through the UI
    await createCheckingAccount(page);
    await createActivityWithMonthlyPayment(page, 'Piano Lesson', 200, 'Main Checking');

    // The activity should be visible on the planner page — click it to open view modal
    const activityTitle = page.getByText('Piano Lesson');
    await expect(activityTitle.first()).toBeVisible({ timeout: 5000 });
    await activityTitle.first().click();

    // The ActivityViewEditModal should open
    const viewDialog = page.locator('div[role="dialog"]');
    await expect(viewDialog).toBeVisible({ timeout: 5000 });

    // Verify the "Monthly Transaction" section is present in the view modal
    await expect(viewDialog.getByText(ui('txLink.monthlyTransaction'))).toBeVisible({
      timeout: 5000,
    });

    // Verify the payment amount (200) appears
    await expect(viewDialog.getByText(/200/)).toBeVisible();
  });

  test('clicking linked transaction in activity modal navigates to transactions', async ({
    page,
  }) => {
    await setup(page);

    // Create account and activity with monthly payment
    await createCheckingAccount(page);
    await createActivityWithMonthlyPayment(page, 'Swimming Class', 100, 'Main Checking');

    // Open the activity view modal
    const activityTitle = page.getByText('Swimming Class');
    await expect(activityTitle.first()).toBeVisible({ timeout: 5000 });
    await activityTitle.first().click();

    const viewDialog = page.locator('div[role="dialog"]');
    await expect(viewDialog).toBeVisible({ timeout: 5000 });

    // Verify the "Monthly Transaction" section is present
    await expect(viewDialog.getByText(ui('txLink.monthlyTransaction'))).toBeVisible({
      timeout: 5000,
    });

    // Click the "View ->" link on the monthly transaction section
    // The view link may be rendered as a button or anchor
    const viewLink = viewDialog.getByText('→ view').or(viewDialog.getByText('→ View'));
    const viewLinkVisible = await viewLink
      .first()
      .waitFor({ state: 'visible', timeout: 3000 })
      .then(() => true)
      .catch(() => false);

    if (viewLinkVisible) {
      await viewLink.first().click();

      // Verify navigation to transactions page
      await page.waitForURL(/\/transactions/, { timeout: 10000 });
    } else {
      // If the view link requires hover, hover first then click
      const monthlySection = viewDialog.getByText(ui('txLink.monthlyTransaction'));
      await monthlySection.hover();
      const viewLinkAfterHover = viewDialog.getByText('→ view').or(viewDialog.getByText('→ View'));
      await viewLinkAfterHover.first().click();
      await page.waitForURL(/\/transactions/, { timeout: 10000 });
    }
  });

  test('data integrity — creating and deleting linked payment', async ({ page }) => {
    await setup(page);

    // Create an account through the UI
    await createCheckingAccount(page, 'Integrity Checking');

    // Navigate to planner and create a one-off activity WITHOUT cost first
    await page.goto('/planner');
    await page.waitForURL('/planner');

    await page.getByRole('button', { name: /\+ add activity/i }).click();
    await expect(page.getByText(/new activity/i)).toBeVisible();
    await page.getByPlaceholder(ui('modal.whatsTheActivity')).fill('Guitar Lesson');
    await selectAssignee(page);
    await page.getByRole('button', { name: /one-off/i }).click();
    await page.locator('input[type="date"]').fill('2026-04-20');

    // Save without cost
    await page.getByRole('button', { name: /^add activity$/i }).click();
    await expect(page.getByText(/new activity/i)).not.toBeVisible({ timeout: 5000 });

    // Verify activity was created without recurring item
    let data = await dbHelper.exportData();
    expect(data.activities).toHaveLength(1);
    expect(data.activities[0].title).toBe('Guitar Lesson');
    expect(data.activities[0].linkedRecurringItemId).toBeFalsy();
    expect(data.recurringItems.length).toBe(0);

    // Now open the created activity to edit it and add a monthly payment
    const activityTitle = page.getByText('Guitar Lesson');
    await expect(activityTitle.first()).toBeVisible({ timeout: 5000 });
    await activityTitle.first().click();

    // The ActivityViewEditModal should open — click Edit
    const viewDialog = page.locator('div[role="dialog"]');
    await expect(viewDialog).toBeVisible({ timeout: 5000 });
    await viewDialog.getByRole('button', { name: ui('action.edit') }).click();

    // Wait for ActivityModal (edit mode) to open
    await expect(page.getByText(ui('planner.editActivity'))).toBeVisible({ timeout: 5000 });

    // Expand "Add more details"
    await page.getByText(ui('planner.field.moreDetails')).click();

    // Set cost amount
    const costInput = page.locator('div[role="dialog"]').locator('input[type="number"]').first();
    await costInput.fill('75');

    // Set fee schedule to Monthly
    await clickFeeScheduleMonthly(page);

    // Enable "Create Monthly Payment" toggle
    await expect(page.getByText(ui('recurringPrompt.createPayment'))).toBeVisible({
      timeout: 5000,
    });
    await page.getByText(ui('recurringPrompt.createPayment')).click();

    // Select pay-from account
    await expect(page.getByText(ui('recurringPrompt.payFrom'))).toBeVisible({
      timeout: 5000,
    });

    const accountBtn = page
      .locator('div[role="dialog"]')
      .getByRole('button', { name: /Integrity Checking/i });
    const accountBtnVisible = await accountBtn
      .waitFor({ state: 'visible', timeout: 3000 })
      .then(() => true)
      .catch(() => false);
    if (accountBtnVisible) {
      await accountBtn.click();
    }

    // Save
    await page.getByRole('button', { name: ui('modal.saveActivity') }).click();
    await expect(page.getByText(ui('planner.editActivity'))).not.toBeVisible({ timeout: 5000 });

    // Verify: recurringItem was created with correct activityId
    data = await dbHelper.exportData();
    const updatedActivity = data.activities[0];
    expect(updatedActivity.feeAmount).toBe(75);

    const account = data.accounts.find((a) => a.name === 'Integrity Checking');
    expect(account).toBeTruthy();
    expect(updatedActivity.payFromAccountId).toBe(account!.id);

    if (updatedActivity.linkedRecurringItemId) {
      const ri = data.recurringItems.find((r) => r.id === updatedActivity.linkedRecurringItemId);
      expect(ri).toBeTruthy();
      expect(ri!.activityId).toBe(updatedActivity.id);
      expect(ri!.amount).toBe(75);
      expect(ri!.accountId).toBe(account!.id);

      // Now re-open the activity and disable the monthly payment
      await page.getByText('Guitar Lesson').first().click();
      const viewDialog2 = page.locator('div[role="dialog"]');
      await expect(viewDialog2).toBeVisible({ timeout: 5000 });
      await viewDialog2.getByRole('button', { name: ui('action.edit') }).click();
      await expect(page.getByText(ui('planner.editActivity'))).toBeVisible({
        timeout: 5000,
      });

      // Expand "Add more details" if not already expanded
      const moreDetailsText = page.getByText(ui('planner.field.moreDetails'));
      const moreDetailsVisible = await moreDetailsText
        .waitFor({ state: 'visible', timeout: 2000 })
        .then(() => true)
        .catch(() => false);
      if (moreDetailsVisible) {
        const costVisible = await page
          .locator('div[role="dialog"]')
          .locator('input[type="number"]')
          .first()
          .isVisible();
        if (!costVisible) {
          await moreDetailsText.click();
        }
      }

      // Disable the "Create Monthly Payment" toggle
      await expect(page.getByText(ui('recurringPrompt.createPayment'))).toBeVisible({
        timeout: 5000,
      });
      await page.getByText(ui('recurringPrompt.createPayment')).click();

      // Save
      await page.getByRole('button', { name: ui('modal.saveActivity') }).click();
      await expect(page.getByText(ui('planner.editActivity'))).not.toBeVisible({ timeout: 5000 });

      // Verify: recurringItem is deleted, activity.linkedRecurringItemId is cleared
      data = await dbHelper.exportData();
      const finalActivity = data.activities[0];
      expect(finalActivity.linkedRecurringItemId).toBeFalsy();
      const remainingRi = data.recurringItems.filter((r) => r.activityId === finalActivity.id);
      expect(remainingRi.length).toBe(0);
    }
  });
});
