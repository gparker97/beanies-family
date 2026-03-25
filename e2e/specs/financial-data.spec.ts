import { test, expect } from '../fixtures/test';
import { DashboardPage } from '../page-objects/DashboardPage';
import { AccountsPage } from '../page-objects/AccountsPage';
import { TransactionsPage } from '../page-objects/TransactionsPage';
import { IndexedDBHelper } from '../helpers/indexeddb';
import { TestDataFactory } from '../fixtures/data';
import { bypassLoginIfNeeded } from '../helpers/auth';

test.describe('Financial Data', () => {
  test('Create account and verify dashboard net worth', async ({ page }) => {
    // Navigate first so we have a page context for IndexedDB operations
    await page.goto('/');
    const dbHelper = new IndexedDBHelper(page);
    await dbHelper.clearAllData();
    // Reload after clearing so the app re-initializes with empty state
    await page.goto('/');
    await bypassLoginIfNeeded(page);

    const accountsPage = new AccountsPage(page);
    await accountsPage.goto();
    await accountsPage.addAccount({
      name: 'Checking',
      type: 'checking',
      balance: 5000,
    });

    const dashboardPage = new DashboardPage(page);
    await dashboardPage.goto();
    // Unlock privacy mode to reveal masked financial figures
    await dashboardPage.unlockPrivacyMode();

    // Use auto-waiting assertion (data loads asynchronously from IndexedDB)
    await expect(dashboardPage.netWorthValue).toContainText('5,000', { timeout: 10000 });
  });

  test('Create income and expense, verify dashboard summary', async ({ page }) => {
    // Navigate first so we have a page context for IndexedDB operations
    await page.goto('/');
    const dbHelper = new IndexedDBHelper(page);
    await dbHelper.clearAllData();
    // Reload after clearing so the app re-initializes with empty state
    await page.goto('/');
    await bypassLoginIfNeeded(page);

    // Seed test data into the family DB (created by app during initialization)
    const member = TestDataFactory.createFamilyMember();
    const account = TestDataFactory.createAccount(member.id, { name: 'Checking' });
    await dbHelper.seedData({
      familyMembers: [member],
      accounts: [account],
      settings: TestDataFactory.createSettings(),
    });

    const transactionsPage = new TransactionsPage(page);
    await transactionsPage.goto();

    // Create income transaction
    await transactionsPage.addTransaction({
      type: 'income',
      account: 'Checking',
      description: 'Salary',
      amount: 5000,
    });

    // Create expense transaction
    await transactionsPage.addTransaction({
      type: 'expense',
      account: 'Checking',
      description: 'Groceries',
      amount: 150,
      category: 'groceries',
    });

    // Navigate to dashboard and verify both income and expense
    const dashboardPage = new DashboardPage(page);
    await dashboardPage.goto();
    // Unlock privacy mode to reveal masked financial figures
    await dashboardPage.unlockPrivacyMode();

    // Use auto-waiting assertions (data loads asynchronously from IndexedDB)
    await expect(dashboardPage.monthlyIncomeValue).toContainText('5,000', { timeout: 10000 });
    await expect(dashboardPage.monthlyExpensesValue).toContainText('150', { timeout: 10000 });
  });
});
