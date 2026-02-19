import { test, expect } from '@playwright/test';
import { TransactionsPage } from '../page-objects/TransactionsPage';
import { IndexedDBHelper } from '../helpers/indexeddb';
import { TestDataFactory } from '../fixtures/data';
import { bypassLoginIfNeeded } from '../helpers/auth';

test.describe('Date Filtering', () => {
  test('should filter transactions by current month', async ({ page }) => {
    // Navigate first so we have a page context for IndexedDB operations
    await page.goto('/');
    const dbHelper = new IndexedDBHelper(page);
    await dbHelper.clearAllData();
    // Reload after clearing so the app re-initializes with empty state
    await page.goto('/');
    await bypassLoginIfNeeded(page);

    const member = TestDataFactory.createFamilyMember();
    const account = TestDataFactory.createAccount(member.id);

    const now = new Date();
    const currentMonth = new Date(now.getFullYear(), now.getMonth(), 15);
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 15);

    // Seed test data into the family DB (created by app during initialization)
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
    await transactionsPage.selectDateFilter('current_month');

    await expect(page.getByTestId('transaction-item').getByText('Current Month')).toBeVisible();
    await expect(page.getByTestId('transaction-item').getByText('Last Month')).not.toBeVisible();
  });

  test('should filter transactions by last month', async ({ page }) => {
    // Navigate first so we have a page context for IndexedDB operations
    await page.goto('/');
    const dbHelper = new IndexedDBHelper(page);
    await dbHelper.clearAllData();
    // Reload after clearing so the app re-initializes with empty state
    await page.goto('/');
    await bypassLoginIfNeeded(page);

    const member = TestDataFactory.createFamilyMember();
    const account = TestDataFactory.createAccount(member.id);

    const now = new Date();
    const currentMonth = new Date(now.getFullYear(), now.getMonth(), 15);
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 15);

    // Seed test data into the family DB (created by app during initialization)
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
    await transactionsPage.selectDateFilter('last_month');

    await expect(page.getByTestId('transaction-item').getByText('Last Month')).toBeVisible();
    await expect(page.getByTestId('transaction-item').getByText('Current Month')).not.toBeVisible();
  });

  test('should filter transactions by last 3 months', async ({ page }) => {
    // Navigate first so we have a page context for IndexedDB operations
    await page.goto('/');
    const dbHelper = new IndexedDBHelper(page);
    await dbHelper.clearAllData();
    // Reload after clearing so the app re-initializes with empty state
    await page.goto('/');
    await bypassLoginIfNeeded(page);

    const member = TestDataFactory.createFamilyMember();
    const account = TestDataFactory.createAccount(member.id);

    const now = new Date();
    const twoMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 2, 15);
    const fourMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 4, 15);

    // Seed test data into the family DB (created by app during initialization)
    await dbHelper.seedData({
      familyMembers: [member],
      accounts: [account],
      transactions: [
        TestDataFactory.createTransaction(account.id, {
          description: 'Within Range',
          date: twoMonthsAgo.toISOString().split('T')[0],
        }),
        TestDataFactory.createTransaction(account.id, {
          description: 'Outside Range',
          date: fourMonthsAgo.toISOString().split('T')[0],
        }),
      ],
      settings: TestDataFactory.createSettings(),
    });

    const transactionsPage = new TransactionsPage(page);
    await transactionsPage.goto();
    await transactionsPage.selectDateFilter('last_3_months');

    await expect(page.getByTestId('transaction-item').getByText('Within Range')).toBeVisible();
    await expect(page.getByTestId('transaction-item').getByText('Outside Range')).not.toBeVisible();
  });
});
