import { test, expect } from '@playwright/test';
import { AccountsPage } from '../page-objects/AccountsPage';
import { AssetsPage } from '../page-objects/AssetsPage';
import { IndexedDBHelper } from '../helpers/indexeddb';
import { bypassLoginIfNeeded } from '../helpers/auth';

test.describe('Account Institution Combobox', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    const dbHelper = new IndexedDBHelper(page);
    await dbHelper.clearAllData();
    await page.goto('/');
    await bypassLoginIfNeeded(page);
  });

  test('should select a predefined institution from dropdown', async ({ page }) => {
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

  test('should search and filter institutions', async ({ page }) => {
    const accountsPage = new AccountsPage(page);
    await accountsPage.goto();

    // Open the add modal — institution fields are now inline
    await page.getByRole('button', { name: 'Add Account' }).first().click();

    const instCombobox = accountsPage.getInstitutionCombobox();
    await instCombobox.open();
    await instCombobox.search('HSBC');
    await instCombobox.expectDropdownContains('HSBC');
    // Institutions that don't match should be filtered out
    await instCombobox.expectDropdownNotContains('DBS Bank');
    // Select the filtered result
    await page.getByRole('button', { name: 'HSBC' }).click();

    // Fill remaining required fields and save
    await page.getByPlaceholder('Account Name').fill('HSBC Account');
    await page.getByRole('button', { name: '🏦 Checking Account', exact: true }).click();
    await page.locator('input[type="number"]').first().fill('5000');
    await page.getByRole('button', { name: 'Add Account' }).last().click();

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

  test('should enter custom institution via Other', async ({ page }) => {
    const accountsPage = new AccountsPage(page);
    await accountsPage.goto();

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
    await page.getByRole('button', { name: 'Add Account' }).first().click();
    const instCombobox = accountsPage.getInstitutionCombobox();
    await instCombobox.open();
    await instCombobox.expectDropdownContains('My Local Bank');
    // The custom entry should show "Custom" badge
    await instCombobox.expectDropdownContains('Custom');
  });

  test('should select a country alongside institution', async ({ page }) => {
    const accountsPage = new AccountsPage(page);
    await accountsPage.goto();

    await accountsPage.addAccountWithInstitution({
      name: 'SG Account',
      type: 'checking',
      balance: 8000,
      institution: 'DBS Bank',
      country: 'Singapore',
      countrySearch: 'Singapore',
    });

    // Verify card shows institution and country code
    const card = page.locator('[data-testid="account-card"]');
    await expect(card).toContainText('DBS Bank');
    await expect(card).toContainText('SG');
  });

  test('should pre-select institution when editing an existing account', async ({ page }) => {
    const accountsPage = new AccountsPage(page);
    await accountsPage.goto();

    // Create account with JPMorgan Chase
    await accountsPage.addAccountWithInstitution({
      name: 'JPM Account',
      type: 'checking',
      balance: 15000,
      institution: 'JPMorgan Chase',
    });

    // Click edit on the account card
    await page.getByTestId('edit-account-btn').click();

    // Verify institution combobox shows "JPMorgan Chase"
    const instCombobox = accountsPage.getInstitutionCombobox();
    await instCombobox.expectDisplayText('JPMorgan Chase');

    // Change to Citibank
    await instCombobox.selectOption('Citibank');

    // Save edit
    await page.getByRole('button', { name: 'Save Account' }).click();
    await expect(page.locator('[role="dialog"]')).toHaveCount(0);

    // Verify card updated
    const card = page.locator('[data-testid="account-card"]');
    await expect(card).toContainText('Citibank');
    await expect(card).not.toContainText('JPMorgan Chase');
  });
});

test.describe('Asset Loan Lender Combobox', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    const dbHelper = new IndexedDBHelper(page);
    await dbHelper.clearAllData();
    await page.goto('/');
    await bypassLoginIfNeeded(page);
  });

  test('should select a predefined lender for asset loan', async ({ page }) => {
    const assetsPage = new AssetsPage(page);
    await assetsPage.goto();

    await assetsPage.addAssetWithLoan({
      name: 'Family Home',
      type: 'real_estate',
      purchaseValue: 500000,
      currentValue: 550000,
      hasLoan: true,
      outstandingBalance: 400000,
      lender: 'HSBC',
    });

    // Verify asset card shows lender in loan section
    const card = page.locator('[data-testid="asset-card"]');
    await expect(card).toContainText('HSBC');
  });

  test('should enter custom lender via Other', async ({ page }) => {
    const assetsPage = new AssetsPage(page);
    await assetsPage.goto();

    await assetsPage.addAssetWithLoan({
      name: 'Company Car',
      type: 'vehicle',
      purchaseValue: 40000,
      currentValue: 35000,
      hasLoan: true,
      outstandingBalance: 25000,
      customLender: 'Regional Credit Union',
    });

    // Verify asset card shows custom lender
    const card = page.locator('[data-testid="asset-card"]');
    await expect(card).toContainText('Regional Credit Union');
  });

  test('should share custom institutions between accounts and assets', async ({ page }) => {
    // First add an account with a custom institution
    const accountsPage = new AccountsPage(page);
    await accountsPage.goto();

    await accountsPage.addAccountWithInstitution({
      name: 'Shared Bank Account',
      type: 'checking',
      balance: 5000,
      customInstitution: 'Shared Bank',
    });

    // Now go to Assets page and verify custom institution appears in lender dropdown
    const assetsPage = new AssetsPage(page);
    await assetsPage.goto();

    await page.getByRole('button', { name: 'Add Asset' }).first().click();
    await page.getByText('This asset has a loan').click();

    const lenderCombobox = assetsPage.getLenderCombobox();
    await lenderCombobox.open();
    await lenderCombobox.expectDropdownContains('Shared Bank');
    await lenderCombobox.expectDropdownContains('Custom');
  });
});
