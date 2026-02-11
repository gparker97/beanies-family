import { test, expect } from '@playwright/test';
import { SetupPage } from '../page-objects/SetupPage';
import { DashboardPage } from '../page-objects/DashboardPage';
import { AccountsPage } from '../page-objects/AccountsPage';
import { IndexedDBHelper } from '../helpers/indexeddb';

test.describe('Account Management', () => {
  test('should create account and update dashboard net worth', async ({ page }) => {
    await page.goto('/');
    const dbHelper = new IndexedDBHelper(page);
    await dbHelper.clearAllData();

    const setupPage = new SetupPage(page);
    await setupPage.completeSetup();

    const accountsPage = new AccountsPage(page);
    await accountsPage.goto();
    await accountsPage.addAccount({
      name: 'Checking',
      type: 'checking',
      balance: 5000,
    });

    const dashboardPage = new DashboardPage(page);
    await dashboardPage.goto();

    const netWorth = await dashboardPage.getNetWorth();
    expect(netWorth).toContain('5,000');
  });

  test('should create multiple accounts', async ({ page }) => {
    await page.goto('/');
    const dbHelper = new IndexedDBHelper(page);
    await dbHelper.clearAllData();

    const setupPage = new SetupPage(page);
    await setupPage.completeSetup();

    const accountsPage = new AccountsPage(page);
    await accountsPage.goto();

    await accountsPage.addAccount({
      name: 'Checking',
      type: 'checking',
      balance: 5000,
    });

    await accountsPage.addAccount({
      name: 'Savings',
      type: 'savings',
      balance: 10000,
    });

    const accountCount = await accountsPage.getAccountCount();
    expect(accountCount).toBe(2);
  });
});
