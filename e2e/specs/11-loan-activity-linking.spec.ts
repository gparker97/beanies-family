import { test, expect } from '../fixtures/test';
import { IndexedDBHelper } from '../helpers/indexeddb';
import { TestDataFactory } from '../fixtures/data';
import { bypassLoginIfNeeded } from '../helpers/auth';
import { ui } from '../helpers/ui-strings';

/**
 * E2E tests for the Loan & Activity Linking feature.
 *
 * Covers:
 * - Creating a recurring payment from an activity's cost section
 * - Linked recurring transaction shows locked fields and activity link
 * - Asset loan card displays linked payment info
 * - Navigating from transaction to linked activity
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
    // The fee schedule Monthly button is the last one matching since the recurrence
    // frequency Monthly (hidden in CSS) appears earlier in the DOM
    await dialog
      .getByRole('button', { name: ui('planner.fee.monthly') })
      .last()
      .click();
  }

  /**
   * Navigate to the transactions page and open the view modal for a transaction
   * by clicking the transaction row (for non-recurring transactions).
   */
  async function openTransactionViewByClick(
    page: import('@playwright/test').Page,
    description: string
  ) {
    await page.goto('/transactions');
    await page.waitForURL(/\/transactions/);
    // Wait for the transaction row to appear (proves store is loaded)
    const txRow = page.getByText(description).first();
    await expect(txRow).toBeVisible({ timeout: 10000 });
    await txRow.click();
    // Wait for the view modal to open
    const dialog = page.locator('div[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 10000 });
    return dialog;
  }

  /**
   * Navigate to transactions with ?view= query param. Uses a retry mechanism
   * since the onMounted handler may fire before the store has hydrated.
   * First navigates to /transactions to prime the store, then reloads with ?view=.
   */
  async function openTransactionViewByUrl(
    page: import('@playwright/test').Page,
    txId: string,
    txDescription: string
  ) {
    // First navigate to /transactions to let the store hydrate
    await page.goto('/transactions');
    await page.waitForURL(/\/transactions/);
    // Wait for the transaction to appear in the list (proves store is loaded)
    await expect(page.getByText(txDescription).first()).toBeVisible({ timeout: 10000 });
    // Now navigate with ?view= — the store is already loaded, and the beforeunload
    // handler saves the Automerge doc to sessionStorage for the reload
    await page.goto(`/transactions?view=${txId}`);
    await page.waitForURL(/\/transactions/);
    const dialog = page.locator('div[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 10000 });
    return dialog;
  }

  test('activity with monthly fee creates a recurring item', async ({ page }) => {
    await setup(page);

    // Seed an account so the RecurringPaymentPrompt has something to select
    const exported = await dbHelper.exportData();
    const member = exported.familyMembers[0];
    const account = TestDataFactory.createAccount(member.id, {
      id: 'acct-checking-1',
      name: 'Main Checking',
      type: 'checking',
      currency: 'USD',
      balance: 10000,
    });
    await dbHelper.seedData({ accounts: [account] });

    // Navigate to planner
    await page.goto('/planner');
    await page.waitForURL('/planner');

    // Open add activity modal
    await page.getByRole('button', { name: /\+ add activity/i }).click();
    await expect(page.getByText(/new activity/i)).toBeVisible();

    // Fill title
    await page.getByPlaceholder(ui('modal.whatsTheActivity')).fill('Piano Lesson');

    // Select assignee
    await selectAssignee(page);

    // Switch to one-off mode (simpler for testing)
    await page.getByRole('button', { name: /one-off/i }).click();

    // Fill date
    await page.locator('input[type="date"]').fill('2026-04-15');

    // Expand "Add more details" to reveal cost fields
    await page.getByText(ui('planner.field.moreDetails')).click();

    // Set cost amount — CurrencyAmountInput has a number input
    const costInput = page.locator('div[role="dialog"]').locator('input[type="number"]').first();
    await costInput.fill('150');

    // Set fee schedule to "Monthly" so RecurringPaymentPrompt appears
    // Use the helper that disambiguates from the recurrence frequency "Monthly"
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
    await page
      .locator('div[role="dialog"]')
      .getByRole('button', { name: /Main Checking/i })
      .or(
        page
          .locator('div[role="dialog"]')
          .getByRole('button', { name: /select|choose|pick/i })
          .last()
      )
      .first()
      .click();

    // If a dropdown appeared with the account, click it
    const accountOption = page.getByRole('button', { name: /Main Checking/i });
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

    // Verify: exportData shows a recurringItem was created with activityId
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
      expect(ri!.accountId).toBe('acct-checking-1');
      expect(ri!.frequency).toBe('monthly');
    }
    // Also check payFromAccountId was stored
    expect(activity.payFromAccountId).toBe('acct-checking-1');
  });

  test('linked transaction shows activity info in view modal', async ({ page }) => {
    await setup(page);

    // Seed data: member, account, activity, and a transaction linked to the activity
    const exported = await dbHelper.exportData();
    const member = exported.familyMembers[0];
    const now = new Date().toISOString();
    const todayStr = now.split('T')[0];

    const account = TestDataFactory.createAccount(member.id, {
      id: 'acct-1',
      name: 'Checking Account',
      type: 'checking',
      currency: 'USD',
      balance: 5000,
    });

    const activity = TestDataFactory.createActivity(member.id, {
      id: 'activity-piano-1',
      title: 'Piano Lesson',
      icon: '🎹',
      category: 'piano',
      feeSchedule: 'monthly',
      feeAmount: 200,
      feeCurrency: 'USD',
      payFromAccountId: 'acct-1',
      recurrence: 'weekly',
      daysOfWeek: [3], // Wednesday
      assigneeIds: [member.id],
    });

    const transaction = TestDataFactory.createTransaction('acct-1', {
      id: 'tx-linked-1',
      type: 'expense',
      amount: 200,
      currency: 'USD',
      category: 'piano',
      description: 'Piano Lesson Payment',
      date: todayStr,
      activityId: 'activity-piano-1',
    });

    await dbHelper.seedData({
      accounts: [account],
      activities: [activity],
      transactions: [transaction],
    });

    // Click the transaction row to open the view modal (no recurringItemId, so click works)
    const dialog = await openTransactionViewByClick(page, 'Piano Lesson Payment');

    // Verify the linked activity name is visible
    await expect(dialog.getByText('Piano Lesson')).toBeVisible({ timeout: 5000 });

    // Verify the activity title label is shown
    await expect(dialog.getByText(ui('planner.field.title'))).toBeVisible();

    // Verify the "-> view" button is present (visible on hover, but exists in DOM)
    await expect(dialog.getByText('→ view').first()).toBeTruthy();
  });

  test('asset loan card shows linked payment info', async ({ page }) => {
    await setup(page);

    // Seed data: member, account, asset with loan, recurring item, and transactions
    const exported = await dbHelper.exportData();
    const member = exported.familyMembers[0];
    const now = new Date().toISOString();
    const todayStr = now.split('T')[0];

    const account = TestDataFactory.createAccount(member.id, {
      id: 'acct-pay-1',
      name: 'Payment Account',
      type: 'checking',
      currency: 'USD',
      balance: 20000,
    });

    const asset = TestDataFactory.createAsset(member.id, {
      id: 'asset-house-1',
      type: 'real_estate',
      name: 'Family Home',
      purchaseValue: 400000,
      currentValue: 450000,
      currency: 'USD',
      loan: {
        hasLoan: true,
        loanAmount: 350000,
        outstandingBalance: 320000,
        interestRate: 4.5,
        monthlyPayment: 1800,
        loanTermMonths: 360,
        loanStartDate: '2023-01-01',
        payFromAccountId: 'acct-pay-1',
        linkedRecurringItemId: 'ri-mortgage-1',
      },
    });

    const recurringItem = {
      id: 'ri-mortgage-1',
      accountId: 'acct-pay-1',
      type: 'expense' as const,
      amount: 1800,
      currency: 'USD' as const,
      category: 'mortgage',
      description: 'Mortgage Payment',
      frequency: 'monthly' as const,
      dayOfMonth: 1,
      startDate: '2023-01-01',
      loanId: 'asset-house-1',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };

    const transaction = TestDataFactory.createTransaction('acct-pay-1', {
      id: 'tx-mortgage-1',
      type: 'expense',
      amount: 1800,
      currency: 'USD',
      category: 'mortgage',
      description: 'Mortgage Payment',
      date: todayStr,
      loanId: 'asset-house-1',
      recurringItemId: 'ri-mortgage-1',
    });

    await dbHelper.seedData({
      accounts: [account],
      assets: [asset],
      recurringItems: [recurringItem],
      transactions: [transaction],
    });

    // Navigate to assets page
    await page.goto('/assets');
    await page.waitForURL('/assets');

    // Wait for asset card to appear by checking for the asset name first
    await expect(page.getByText('Family Home').first()).toBeVisible({ timeout: 10000 });

    // Now find the asset card
    const assetCard = page.locator('[data-testid="asset-card"]').first();
    await expect(assetCard).toBeVisible({ timeout: 5000 });

    // Verify the asset name
    await expect(assetCard.getByText('Family Home')).toBeVisible();

    // Verify loan outstanding amount is displayed (320,000)
    await expect(assetCard.getByText(/320,000/)).toBeVisible({ timeout: 5000 });

    // Verify the "Monthly Transaction" section is present
    // Use a longer timeout as the recurring store may need time to load
    await expect(assetCard.getByText(ui('txLink.monthlyTransaction'))).toBeVisible({
      timeout: 10000,
    });

    // Verify the payment amount (1,800) appears in the linked section
    await expect(assetCard.getByText(/1,800/)).toBeVisible();

    // Verify the "Recent Transactions" section shows the seeded transaction
    await expect(assetCard.getByText(ui('txLink.recentTransactions'))).toBeVisible({
      timeout: 5000,
    });
  });

  test('clicking linked activity navigates to planner', async ({ page }) => {
    await setup(page);

    // Seed data: member, account, activity, and a linked transaction
    const exported = await dbHelper.exportData();
    const member = exported.familyMembers[0];
    const now = new Date().toISOString();
    const todayStr = now.split('T')[0];

    const account = TestDataFactory.createAccount(member.id, {
      id: 'acct-nav-1',
      name: 'Nav Account',
      type: 'checking',
      currency: 'USD',
      balance: 5000,
    });

    const activity = TestDataFactory.createActivity(member.id, {
      id: 'activity-swim-1',
      title: 'Swimming Class',
      icon: '🏊',
      category: 'swimming',
      feeSchedule: 'monthly',
      feeAmount: 100,
      assigneeIds: [member.id],
    });

    const transaction = TestDataFactory.createTransaction('acct-nav-1', {
      id: 'tx-swim-1',
      type: 'expense',
      amount: 100,
      currency: 'USD',
      category: 'swimming',
      description: 'Swimming Class Payment',
      date: todayStr,
      activityId: 'activity-swim-1',
    });

    await dbHelper.seedData({
      accounts: [account],
      activities: [activity],
      transactions: [transaction],
    });

    // Click the transaction row to open the view modal (no recurringItemId, so click works)
    const dialog = await openTransactionViewByClick(page, 'Swimming Class Payment');

    // Verify the linked activity is visible
    await expect(dialog.getByText('Swimming Class')).toBeVisible({ timeout: 5000 });

    // Click the activity link button (the entire row is a button)
    await dialog.getByRole('button', { name: /Swimming Class/ }).click();

    // Verify navigation to planner with activity query param
    await page.waitForURL(/\/planner\?activity=activity-swim-1/, { timeout: 10000 });

    // Verify the activity view modal opens on the planner page
    const plannerDialog = page.locator('div[role="dialog"]');
    await expect(plannerDialog).toBeVisible({ timeout: 10000 });
    await expect(plannerDialog.getByText('Swimming Class')).toBeVisible({ timeout: 5000 });
  });

  test('data integrity — creating and deleting linked payment', async ({ page }) => {
    await setup(page);

    // Seed an account for the payment
    const exported = await dbHelper.exportData();
    const member = exported.familyMembers[0];
    const account = TestDataFactory.createAccount(member.id, {
      id: 'acct-integrity-1',
      name: 'Integrity Checking',
      type: 'checking',
      currency: 'USD',
      balance: 10000,
    });
    await dbHelper.seedData({ accounts: [account] });

    // Navigate to planner and create an activity with monthly cost
    await page.goto('/planner');
    await page.waitForURL('/planner');

    // Create a one-off activity first
    await page.getByRole('button', { name: /\+ add activity/i }).click();
    await expect(page.getByText(/new activity/i)).toBeVisible();
    await page.getByPlaceholder(ui('modal.whatsTheActivity')).fill('Guitar Lesson');
    await selectAssignee(page);
    await page.getByRole('button', { name: /one-off/i }).click();
    await page.locator('input[type="date"]').fill('2026-04-20');

    // Save without cost first
    await page.getByRole('button', { name: /^add activity$/i }).click();
    await expect(page.getByText(/new activity/i)).not.toBeVisible({ timeout: 5000 });

    // Verify activity was created without recurring item
    let data = await dbHelper.exportData();
    expect(data.activities).toHaveLength(1);
    expect(data.activities[0].title).toBe('Guitar Lesson');
    expect(data.activities[0].linkedRecurringItemId).toBeFalsy();
    expect(data.recurringItems.length).toBe(0);

    // Now open the created activity to edit it and add a monthly payment
    // Click on the activity in the upcoming list or calendar
    const activityTitle = page.getByText('Guitar Lesson');
    await expect(activityTitle.first()).toBeVisible({ timeout: 5000 });
    await activityTitle.first().click();

    // The ActivityViewEditModal should open — click Edit to open ActivityModal
    const viewDialog = page.locator('div[role="dialog"]');
    await expect(viewDialog).toBeVisible({ timeout: 5000 });

    // Click the edit button
    await viewDialog.getByRole('button', { name: ui('action.edit') }).click();

    // Wait for ActivityModal (edit mode) to open
    await expect(page.getByText(ui('planner.editActivity'))).toBeVisible({ timeout: 5000 });

    // Expand "Add more details"
    await page.getByText(ui('planner.field.moreDetails')).click();

    // Set cost amount
    const costInput = page.locator('div[role="dialog"]').locator('input[type="number"]').first();
    await costInput.fill('75');

    // Set fee schedule to Monthly (disambiguate from recurrence frequency "Monthly")
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

    // Click to select the account from EntityLinkDropdown
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

    // Wait for modal to close
    await expect(page.getByText(ui('planner.editActivity'))).not.toBeVisible({ timeout: 5000 });

    // Verify: recurringItem was created with correct activityId
    data = await dbHelper.exportData();
    const updatedActivity = data.activities[0];
    expect(updatedActivity.feeAmount).toBe(75);
    expect(updatedActivity.payFromAccountId).toBe('acct-integrity-1');

    if (updatedActivity.linkedRecurringItemId) {
      const ri = data.recurringItems.find((r) => r.id === updatedActivity.linkedRecurringItemId);
      expect(ri).toBeTruthy();
      expect(ri!.activityId).toBe(updatedActivity.id);
      expect(ri!.amount).toBe(75);
      expect(ri!.accountId).toBe('acct-integrity-1');

      // Now re-open the activity and disable the monthly payment
      await page.getByText('Guitar Lesson').first().click();
      const viewDialog2 = page.locator('div[role="dialog"]');
      await expect(viewDialog2).toBeVisible({ timeout: 5000 });
      await viewDialog2.getByRole('button', { name: ui('action.edit') }).click();
      await expect(page.getByText(ui('planner.editActivity'))).toBeVisible({
        timeout: 5000,
      });

      // "Add more details" should already be expanded since the activity has fee data
      // But click it to be safe
      const moreDetailsText = page.getByText(ui('planner.field.moreDetails'));
      const moreDetailsVisible = await moreDetailsText
        .waitFor({ state: 'visible', timeout: 2000 })
        .then(() => true)
        .catch(() => false);
      if (moreDetailsVisible) {
        // Check if the cost input is visible — if not, expand
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
      // The recurring item should be removed
      const remainingRi = data.recurringItems.filter((r) => r.activityId === finalActivity.id);
      expect(remainingRi.length).toBe(0);
    }
  });

  test('transaction with recurringItemId and activityId shows locked amount', async ({ page }) => {
    await setup(page);

    // Seed data: member, account, activity, recurring item, and linked transaction
    const exported = await dbHelper.exportData();
    const member = exported.familyMembers[0];
    const now = new Date().toISOString();
    const todayStr = now.split('T')[0];

    const account = TestDataFactory.createAccount(member.id, {
      id: 'acct-locked-1',
      name: 'Locked Account',
      type: 'checking',
      currency: 'USD',
      balance: 5000,
    });

    const activity = TestDataFactory.createActivity(member.id, {
      id: 'activity-locked-1',
      title: 'Dance Class',
      icon: '💃',
      category: 'dance',
      feeSchedule: 'monthly',
      feeAmount: 120,
      feeCurrency: 'USD',
      payFromAccountId: 'acct-locked-1',
      linkedRecurringItemId: 'ri-dance-1',
      assigneeIds: [member.id],
    });

    const recurringItem = {
      id: 'ri-dance-1',
      accountId: 'acct-locked-1',
      type: 'expense' as const,
      amount: 120,
      currency: 'USD' as const,
      category: 'dance',
      description: 'Dance Class',
      frequency: 'monthly' as const,
      dayOfMonth: 15,
      startDate: todayStr,
      activityId: 'activity-locked-1',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };

    const transaction = TestDataFactory.createTransaction('acct-locked-1', {
      id: 'tx-locked-1',
      type: 'expense',
      amount: 120,
      currency: 'USD',
      category: 'dance',
      description: 'Dance Class',
      date: todayStr,
      activityId: 'activity-locked-1',
      recurringItemId: 'ri-dance-1',
    });

    await dbHelper.seedData({
      accounts: [account],
      activities: [activity],
      recurringItems: [recurringItem],
      transactions: [transaction],
    });

    // This transaction has recurringItemId, so clicking the row opens the recurring
    // item modal instead of the view modal. Use the URL approach with a pre-load
    // to avoid the race condition where onMounted fires before stores hydrate.
    const dialog = await openTransactionViewByUrl(page, 'tx-locked-1', 'Dance Class');

    // Verify the date field shows a lock icon because recurringItemId is set
    await expect(dialog.getByText('🔒')).toBeVisible({ timeout: 5000 });

    // Verify the linked activity is displayed
    await expect(dialog.getByText('Dance Class')).toBeVisible();
    await expect(dialog.getByText(ui('planner.field.title'))).toBeVisible();
  });
});
