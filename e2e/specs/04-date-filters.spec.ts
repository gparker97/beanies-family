import { test, expect } from '@playwright/test';
import { TransactionsPage } from '../page-objects/TransactionsPage';
import { IndexedDBHelper } from '../helpers/indexeddb';
import { TestDataFactory } from '../fixtures/data';
import { bypassLoginIfNeeded } from '../helpers/auth';

test.describe('Date Filtering', () => {
  test('should show current month transactions by default', async ({ page }) => {
    await page.goto('/');
    const dbHelper = new IndexedDBHelper(page);
    await dbHelper.clearAllData();
    await page.goto('/');
    await bypassLoginIfNeeded(page);

    const member = TestDataFactory.createFamilyMember();
    const account = TestDataFactory.createAccount(member.id);

    const now = new Date();
    const currentMonth = new Date(now.getFullYear(), now.getMonth(), 15);
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 15);

    await dbHelper.seedData({
      familyMembers: [member],
      accounts: [account],
      transactions: [
        TestDataFactory.createTransaction(account.id, {
          description: 'Current Month',
          date: currentMonth.toISOString().split('T')[0],
        }),
        TestDataFactory.createTransaction(account.id, {
          description: 'Last Month',
          date: lastMonth.toISOString().split('T')[0],
        }),
      ],
      settings: TestDataFactory.createSettings(),
    });

    const transactionsPage = new TransactionsPage(page);
    await transactionsPage.goto();

    // Default view shows current month — no navigation needed
    await expect(page.getByTestId('transaction-item').getByText('Current Month')).toBeVisible();
    await expect(page.getByTestId('transaction-item').getByText('Last Month')).not.toBeVisible();
  });

  test('should show last month transactions when navigating back', async ({ page }) => {
    await page.goto('/');
    const dbHelper = new IndexedDBHelper(page);
    await dbHelper.clearAllData();
    await page.goto('/');
    await bypassLoginIfNeeded(page);

    const member = TestDataFactory.createFamilyMember();
    const account = TestDataFactory.createAccount(member.id);

    const now = new Date();
    const currentMonth = new Date(now.getFullYear(), now.getMonth(), 15);
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 15);

    await dbHelper.seedData({
      familyMembers: [member],
      accounts: [account],
      transactions: [
        TestDataFactory.createTransaction(account.id, {
          description: 'Current Month',
          date: currentMonth.toISOString().split('T')[0],
        }),
        TestDataFactory.createTransaction(account.id, {
          description: 'Last Month',
          date: lastMonth.toISOString().split('T')[0],
        }),
      ],
      settings: TestDataFactory.createSettings(),
    });

    const transactionsPage = new TransactionsPage(page);
    await transactionsPage.goto();
    await transactionsPage.navigateMonth(-1);

    await expect(page.getByTestId('transaction-item').getByText('Last Month')).toBeVisible();
    await expect(page.getByTestId('transaction-item').getByText('Current Month')).not.toBeVisible();
  });

  test('should show only selected month when navigating to a past month', async ({ page }) => {
    await page.goto('/');
    const dbHelper = new IndexedDBHelper(page);
    await dbHelper.clearAllData();
    await page.goto('/');
    await bypassLoginIfNeeded(page);

    const member = TestDataFactory.createFamilyMember();
    const account = TestDataFactory.createAccount(member.id);

    const now = new Date();
    const twoMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 2, 15);
    const fourMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 4, 15);

    await dbHelper.seedData({
      familyMembers: [member],
      accounts: [account],
      transactions: [
        TestDataFactory.createTransaction(account.id, {
          description: 'Two Months Ago',
          date: twoMonthsAgo.toISOString().split('T')[0],
        }),
        TestDataFactory.createTransaction(account.id, {
          description: 'Four Months Ago',
          date: fourMonthsAgo.toISOString().split('T')[0],
        }),
      ],
      settings: TestDataFactory.createSettings(),
    });

    const transactionsPage = new TransactionsPage(page);
    await transactionsPage.goto();
    await transactionsPage.navigateMonth(-2);

    await expect(page.getByTestId('transaction-item').getByText('Two Months Ago')).toBeVisible();
    await expect(
      page.getByTestId('transaction-item').getByText('Four Months Ago')
    ).not.toBeVisible();
  });
});
