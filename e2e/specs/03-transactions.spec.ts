import { test, expect } from '@playwright/test';
import { TransactionsPage } from '../page-objects/TransactionsPage';
import { DashboardPage } from '../page-objects/DashboardPage';
import { IndexedDBHelper } from '../helpers/indexeddb';
import { TestDataFactory } from '../fixtures/data';
import { bypassLoginIfNeeded } from '../helpers/auth';

test.describe('Transaction Management', () => {
  test('should create transaction and update dashboard', async ({ page }) => {
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
    await transactionsPage.addTransaction({
      type: 'income',
      account: 'Checking',
      description: 'Salary',
      amount: 5000,
    });

    const dashboardPage = new DashboardPage(page);
    await dashboardPage.goto();
    // Unlock privacy mode to reveal masked financial figures
    await dashboardPage.unlockPrivacyMode();

    // Use auto-waiting assertion (data loads asynchronously)
    await expect(dashboardPage.monthlyIncomeValue).toContainText('5,000');
  });

  test('should create expense and update dashboard', async ({ page }) => {
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
    await transactionsPage.addTransaction({
      type: 'expense',
      account: 'Checking',
      description: 'Groceries',
      amount: 150,
      category: 'groceries',
    });

    const dashboardPage = new DashboardPage(page);
    await dashboardPage.goto();
    // Unlock privacy mode to reveal masked financial figures
    await dashboardPage.unlockPrivacyMode();

    // Use auto-waiting assertion (data loads asynchronously)
    await expect(dashboardPage.monthlyExpensesValue).toContainText('150');
  });
});
