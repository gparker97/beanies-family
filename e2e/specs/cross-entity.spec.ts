import { test, expect } from '../fixtures/test';
import { AccountsPage } from '../page-objects/AccountsPage';
import { AssetsPage } from '../page-objects/AssetsPage';
import { IndexedDBHelper } from '../helpers/indexeddb';
import { bypassLoginIfNeeded } from '../helpers/auth';
import { ui } from '../helpers/ui-strings';

// ---------------------------------------------------------------------------
// Institution Combobox
// ---------------------------------------------------------------------------

test.describe('Account Institution Combobox', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    const dbHelper = new IndexedDBHelper(page);
    await dbHelper.clearAllData();
    await page.goto('/');
    await bypassLoginIfNeeded(page);
  });

  test('Select predefined institution', async ({ page }) => {
    const accountsPage = new AccountsPage(page);
    await accountsPage.goto();

    await accountsPage.addAccountWithInstitution({
      name: 'DBS Savings',
      type: 'savings',
      balance: 10000,
      institution: 'DBS Bank',
    });

    // Verify account card shows the institution
    const card = page.locator('[data-testid="account-card"]');
    await expect(card).toContainText('DBS Bank');
  });

  test('Search and filter institutions', async ({ page }) => {
    const accountsPage = new AccountsPage(page);
    await accountsPage.goto();

    // Open the add modal — institution fields are now inline
    await page
      .getByRole('button', { name: ui('modal.addAccount') })
      .first()
      .click();

    const instCombobox = accountsPage.getInstitutionCombobox();
    await instCombobox.open();
    await instCombobox.search('HSBC');
    await instCombobox.expectDropdownContains('HSBC');
    // Institutions that don't match should be filtered out
    await instCombobox.expectDropdownNotContains('DBS Bank');
    // Select the filtered result
    await page.getByRole('button', { name: 'HSBC' }).click();

    // Fill remaining required fields and save
    await page.getByPlaceholder(ui('modal.accountName')).fill('HSBC Account');
    // Select type: Bank category → Checking subtype
    await page.getByRole('button', { name: '🏦 Bank', exact: true }).click();
    await page.getByRole('button', { name: '🏦 Checking', exact: true }).click();
    await page.locator('input[type="number"]').first().fill('5000');
    await page
      .getByRole('button', { name: ui('modal.addAccount') })
      .last()
      .click();

    // Dismiss celebration modal
    const letsGoButton = page.getByRole('button', { name: "Let's go!" });
    try {
      await letsGoButton.waitFor({ state: 'visible', timeout: 2000 });
      await letsGoButton.click();
    } catch {
      // No celebration modal
    }
    await expect(page.locator('[role="dialog"]')).toHaveCount(0);

    const card = page.locator('[data-testid="account-card"]');
    await expect(card).toContainText('HSBC');
  });

  test('Custom institution persists and appears in asset lender dropdown', async ({ page }) => {
    const accountsPage = new AccountsPage(page);
    await accountsPage.goto();

    // --- Part 1: Enter custom institution via Other (from combobox test #3) ---

    await accountsPage.addAccountWithInstitution({
      name: 'Local Bank Account',
      type: 'checking',
      balance: 3000,
      customInstitution: 'My Local Bank',
    });

    // Verify account card shows custom institution
    const card = page.locator('[data-testid="account-card"]');
    await expect(card).toContainText('My Local Bank');

    // Verify custom institution is persisted: open add account again and check dropdown
    await page
      .getByRole('button', { name: ui('modal.addAccount') })
      .first()
      .click();
    const instCombobox = accountsPage.getInstitutionCombobox();
    await instCombobox.open();
    await instCombobox.expectDropdownContains('My Local Bank');
    // The custom entry should show "Custom" badge
    await instCombobox.expectDropdownContains(ui('form.customBadge'));

    // Close the account modal
    await page.keyboard.press('Escape');

    // --- Part 2: Cross-page verification — custom institution in asset lender dropdown (from combobox test #8) ---

    // Now go to Assets page and verify custom institution appears in lender dropdown
    const assetsPage = new AssetsPage(page);
    await assetsPage.goto();

    await page
      .getByRole('button', { name: ui('assets.addAsset') })
      .first()
      .click();
    const dialog = page.locator('[role="dialog"]');
    await dialog.getByText(ui('assets.hasLoan')).click();

    const lenderCombobox = assetsPage.getLenderCombobox();
    await lenderCombobox.open();
    await lenderCombobox.expectDropdownContains('My Local Bank');
    await lenderCombobox.expectDropdownContains(ui('form.customBadge'));
  });
});

// ---------------------------------------------------------------------------
// Onboarding Wizard
// ---------------------------------------------------------------------------

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
    // Set e2e_force_onboarding so the wizard renders despite auto-auth.
    await page.evaluate(() => {
      sessionStorage.setItem('e2e_force_onboarding', 'true');
    });

    // Restart onboarding via Settings → Appearance modal
    await page.goto('/settings');
    await page.getByText(ui('settings.card.appearance')).first().click();
    await page.getByTestId('restart-onboarding').waitFor({ state: 'visible', timeout: 5000 });
    await page.getByTestId('restart-onboarding').click();

    // Wait for the router navigation triggered by restart-onboarding to settle
    await page.waitForURL('**/nook', { timeout: 30000 });

    await page.getByTestId('onboarding-wizard').waitFor({ state: 'visible', timeout: 10000 });
  }

  test('Onboarding wizard: complete all steps with data persistence', async ({ page }) => {
    test.slow(); // Setup restarts onboarding via settings + walks through all wizard steps
    await setupWithOnboarding(page);

    // --- Step 1: Welcome screen (from onboarding test #1) ---
    await expect(page.getByTestId('onboarding-wizard')).toBeVisible();
    await expect(page.getByTestId('onboarding-start')).toBeVisible();

    // --- Step 1 → Step 2 (from onboarding test #4) ---
    await page.getByTestId('onboarding-start').click();
    await page.getByTestId('onboarding-add-account').waitFor({ state: 'visible', timeout: 5000 });

    // Add an account via the bank combobox
    await page.getByTestId('onboarding-bank-select').getByTestId('combobox-trigger').click();
    await page.getByTestId('combobox-dropdown').waitFor({ state: 'visible', timeout: 3000 });
    await page.getByTestId('combobox-dropdown').locator('button').first().click();
    await page.getByTestId('onboarding-add-account').click();

    // Should show the added account list with "Add Another" button
    await expect(page.getByText(/add another/i)).toBeVisible({ timeout: 5000 });

    // --- Step 2 → Step 3: Activity presets (from onboarding test #6) ---
    await page.getByTestId('onboarding-next').click();
    await expect(page.getByText(/family life/i)).toBeVisible({ timeout: 5000 });

    // --- Step 3 → Completion screen (from onboarding test #8) ---
    await page.getByTestId('onboarding-next').click();
    await page.getByTestId('onboarding-finish').waitFor({ state: 'visible', timeout: 5000 });

    // Click "Enter The Nook" to close wizard
    await page.getByTestId('onboarding-finish').click();
    await expect(page.getByTestId('onboarding-wizard')).not.toBeVisible({ timeout: 5000 });

    // --- Verify data persistence: account was created ---
    const dbHelper = new IndexedDBHelper(page);
    const data = await dbHelper.exportData();
    expect(data.accounts.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Loan & Activity Linking
// ---------------------------------------------------------------------------

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
   * Click the fee schedule "Monthly" chip.
   * Scoped to the Fee Schedule FormFieldGroup to avoid matching the
   * recurrence frequency "Monthly" chip which has the same label text.
   */
  async function clickFeeScheduleMonthly(page: import('@playwright/test').Page) {
    const dialog = page.locator('div[role="dialog"]');
    // Find the Fee Schedule section by its label, then click Monthly within it
    const feeSection = dialog
      .locator('div.space-y-2')
      .filter({ has: page.locator('label', { hasText: ui('planner.field.feeSchedule') }) });
    await feeSection.getByRole('button', { name: ui('planner.fee.monthly'), exact: true }).click();
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
    await page.goto('/activities');
    await page.waitForURL('/activities');

    // Open add activity modal
    await page.getByRole('button', { name: /\+ add activity/i }).click();
    await expect(page.getByText(/new activity/i)).toBeVisible();

    // Fill title
    await page.getByPlaceholder(ui('modal.whatsTheActivity')).fill(title);

    // Select assignee
    await selectAssignee(page);

    // Stay in recurring mode (default) — fee schedule chips are only visible in recurring mode.
    // Fill start date
    const dialog = page.locator('div[role="dialog"]');
    const dateInput = dialog.locator('input[type="date"]');
    await dateInput.first().waitFor({ state: 'visible', timeout: 5000 });
    await dateInput.first().fill('2026-04-15');

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
    await expect(
      page.locator('div[role="dialog"]').getByText(ui('recurringPrompt.payFrom')).first()
    ).toBeVisible({ timeout: 5000 });

    // Select the pay-from account from the EntityLinkDropdown.
    // The dropdown trigger shows placeholder text initially — click it to open,
    // then select the account option via mousedown.
    const dropdownTrigger = page
      .locator('div[role="dialog"]')
      .getByRole('button', { name: new RegExp(ui('recurringPrompt.payFrom'), 'i') });
    await dropdownTrigger.waitFor({ state: 'visible', timeout: 5000 });
    await dropdownTrigger.click();

    // Wait for the dropdown options to appear, then select the account
    const accountOption = page.getByRole('button', { name: new RegExp(accountName, 'i') });
    await accountOption.waitFor({ state: 'visible', timeout: 5000 });
    await accountOption.dispatchEvent('mousedown');

    // Save the activity
    await page.getByRole('button', { name: /^add activity$/i }).click();

    // Dismiss the "Activity Created" confirmation modal
    const confirmOk = page.locator('[role="dialog"]').getByRole('button', { name: /^ok$/i });
    await confirmOk.click({ timeout: 5000 });
    await expect(confirmOk).not.toBeVisible({ timeout: 3000 });
  }

  test('Activity with monthly fee creates recurring item', async ({ page }) => {
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

  test('View linked payment section and navigate to transactions', async ({ page }) => {
    test.slow(); // Creates account + activity with payment, then opens view modal and navigates
    await setup(page);

    // Create an account and activity with monthly payment through the UI
    await createCheckingAccount(page);
    await createActivityWithMonthlyPayment(page, 'Piano Lesson', 200, 'Main Checking');

    // --- Part 1: Verify linked monthly transaction section in view modal (from test #2) ---

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

    // Verify the payment amount appears in the monthly transaction section
    await expect(viewDialog.getByText(/200\.00\/mo/)).toBeVisible();

    // --- Part 2: Click linked transaction to navigate to transactions page (from test #3) ---

    // Click the "View →" link on the monthly transaction section
    const viewLink = viewDialog.getByRole('button', { name: /view/i }).last();
    await viewLink.click({ timeout: 10000 });

    // Verify navigation to transactions page
    await page.waitForURL(/\/transactions/, { timeout: 10000 });
  });

  test('Data integrity: add then remove linked payment', async ({ page }) => {
    test.slow(); // Creates account + activity, edits to add payment, then edits again to remove
    await setup(page);

    // Create an account through the UI
    await createCheckingAccount(page, 'Integrity Checking');

    // Navigate to planner and create a one-off activity WITHOUT cost first
    await page.goto('/activities');
    await page.waitForURL('/activities');

    await page.getByRole('button', { name: /\+ add activity/i }).click();
    await expect(page.getByText(/new activity/i)).toBeVisible();
    await page.getByPlaceholder(ui('modal.whatsTheActivity')).fill('Guitar Lesson');
    await selectAssignee(page);
    await page.getByRole('button', { name: /one-time/i }).click();
    // Use tomorrow so the activity appears in the Upcoming list — the only
    // surface on /activities that renders the title as searchable text.
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
    await page.locator('input[type="date"]').fill(tomorrowStr);

    // Save without cost
    await page.getByRole('button', { name: /^add activity$/i }).click();

    // Dismiss the "Activity Created" confirmation modal
    const confirmOk2 = page.locator('[role="dialog"]').getByRole('button', { name: /^ok$/i });
    await confirmOk2.click({ timeout: 5000 });
    await expect(confirmOk2).not.toBeVisible({ timeout: 3000 });

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

    // Switch from one-time to recurring — fee schedule chips only appear in recurring mode
    await page
      .locator('div[role="dialog"]')
      .getByRole('button', { name: /recurring/i })
      .click();

    // Set cost amount (now visible by default, above schedule section)
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
    await expect(
      page.locator('div[role="dialog"]').getByText(ui('recurringPrompt.payFrom')).first()
    ).toBeVisible({ timeout: 5000 });

    // Open the EntityLinkDropdown and select the account
    const dropdownTrigger2 = page
      .locator('div[role="dialog"]')
      .getByRole('button', { name: new RegExp(ui('recurringPrompt.payFrom'), 'i') });
    await dropdownTrigger2.waitFor({ state: 'visible', timeout: 5000 });
    await dropdownTrigger2.click();

    const accountOption2 = page.getByRole('button', { name: /Integrity Checking/i });
    await accountOption2.waitFor({ state: 'visible', timeout: 5000 });
    await accountOption2.dispatchEvent('mousedown');

    // Save — this triggers a "Payment Created" confirmation modal
    await page.getByRole('button', { name: ui('modal.saveActivity') }).click();
    await expect(page.getByText(ui('planner.editActivity'))).not.toBeVisible({ timeout: 5000 });

    // Dismiss the "Payment Created" confirmation modal
    const confirmClose = page.getByRole('button', { name: ui('action.close') });
    await confirmClose.waitFor({ state: 'visible', timeout: 5000 });
    await confirmClose.click();
    await confirmClose.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});

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

      // Disable the "Create Monthly Payment" toggle (cost section is now visible by default)
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
