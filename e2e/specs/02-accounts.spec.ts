import { test, expect } from '../fixtures/test';
import { DashboardPage } from '../page-objects/DashboardPage';
import { AccountsPage } from '../page-objects/AccountsPage';
import { IndexedDBHelper } from '../helpers/indexeddb';
import { bypassLoginIfNeeded } from '../helpers/auth';
import { ui } from '../helpers/ui-strings';

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

  test('should navigate from dashboard breakdown to accounts with category grouping', async ({
    page,
  }) => {
    await page.goto('/');
    const dbHelper = new IndexedDBHelper(page);
    await dbHelper.clearAllData();
    await page.goto('/');
    await bypassLoginIfNeeded(page);

    // Create an account so the breakdown card appears
    const accountsPage = new AccountsPage(page);
    await accountsPage.goto();
    await accountsPage.addAccount({
      name: 'My Checking',
      type: 'checking',
      balance: 5000,
    });

    // Go to dashboard and unlock privacy mode
    const dashboardPage = new DashboardPage(page);
    await dashboardPage.goto();
    await dashboardPage.unlockPrivacyMode();

    // Wait for breakdown card to appear and click the Cash category tile
    const cashTile = page.getByText(ui('dashboard.breakdown.cash'), { exact: true });
    await expect(cashTile).toBeVisible({ timeout: 10000 });
    await cashTile.click();

    // Should navigate to accounts page (SPA client-side routing)
    await expect(page).toHaveURL(/\/accounts/, { timeout: 15000 });

    // The category grouping toggle should be active
    await expect(page.getByText(ui('accounts.groupByCategory'))).toBeVisible();
  });
});
