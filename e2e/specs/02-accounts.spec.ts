import { test, expect } from '@playwright/test';
import { DashboardPage } from '../page-objects/DashboardPage';
import { AccountsPage } from '../page-objects/AccountsPage';
import { IndexedDBHelper } from '../helpers/indexeddb';
import { bypassLoginIfNeeded } from '../helpers/auth';

test.describe('Account Management', () => {
  test('should create account and update dashboard net worth', async ({ page }) => {
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

  test('should create multiple accounts', async ({ page }) => {
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

    await accountsPage.addAccount({
      name: 'Savings',
      type: 'savings',
      balance: 10000,
    });

    // Use auto-waiting assertion (account list updates asynchronously)
    await expect(page.locator('[data-testid="account-card"]')).toHaveCount(2);
  });
});
