import { test, expect } from '@playwright/test';
import { TransactionsPage } from '../page-objects/TransactionsPage';
import { DashboardPage } from '../page-objects/DashboardPage';
import { IndexedDBHelper } from '../helpers/indexeddb';
import { TestDataFactory } from '../fixtures/data';

test.describe('Transaction Management', () => {
  test('should create transaction and update dashboard', async ({ page }) => {
    await page.goto('/');
    const dbHelper = new IndexedDBHelper(page);
    await dbHelper.clearAllData();

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

    const income = await dashboardPage.getMonthlyIncome();
    expect(income).toContain('5,000');
  });

  test('should create expense and update dashboard', async ({ page }) => {
    await page.goto('/');
    const dbHelper = new IndexedDBHelper(page);
    await dbHelper.clearAllData();

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

    const expenses = await dashboardPage.getMonthlyExpenses();
    expect(expenses).toContain('150');
  });
});
