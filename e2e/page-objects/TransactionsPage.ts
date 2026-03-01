import { Page, expect } from '@playwright/test';

/**
 * Maps category IDs to their group name for the two-level CategoryChipPicker.
 * Only categories used in E2E tests need to be listed here.
 */
const CATEGORY_GROUP_MAP: Record<string, string> = {
  groceries: 'Food',
  dining_out: 'Food',
  coffee_snacks: 'Food',
  rent: 'Housing',
  utilities: 'Housing',
  salary: 'Employment',
  freelance: 'Employment',
};

export class TransactionsPage {
  constructor(private page: Page) {}

  async goto() {
    await this.page.goto('/transactions');
  }

  /**
   * Navigate the MonthNavigator by a number of months.
   * Negative offset = past months, positive = future months, 0 = no-op.
   */
  async navigateMonth(offset: number) {
    const label = offset < 0 ? 'Previous month' : 'Next month';
    const clicks = Math.abs(offset);
    for (let i = 0; i < clicks; i++) {
      await this.page.getByRole('button', { name: label }).click();
    }
  }

  async addTransaction(data: {
    type: 'income' | 'expense';
    account: string;
    description: string;
    amount: number;
    category?: string;
  }) {
    // Click the gradient "+ Add Transaction" button on the page
    await this.page.getByRole('button', { name: /\+.*Add Transaction/ }).click();

    const dialog = this.page.locator('[role="dialog"]');

    // Direction toggle — default is "out" (expense)
    if (data.type === 'income') {
      await dialog.getByRole('button', { name: /Money In/ }).click();
    }

    // Account — BaseSelect with placeholder option
    await dialog
      .locator('select')
      .filter({ has: this.page.locator('option', { hasText: 'Select an account' }) })
      .selectOption({ label: data.account });

    // Description
    await dialog.getByPlaceholder('Description').fill(data.description);

    // Amount (AmountInput — number input)
    await dialog.locator('input[type="number"]').fill(data.amount.toString());

    // Category — two-level CategoryChipPicker
    if (data.category) {
      const group = CATEGORY_GROUP_MAP[data.category];
      if (group) {
        await dialog.getByRole('button', { name: group }).click();
      }
      const categoryName = data.category
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase());
      await dialog.getByRole('button', { name: categoryName }).click();
    }

    // Switch schedule to "One-time" (default is "Recurring")
    await dialog.getByRole('button', { name: 'One-time' }).click();

    // Save — button text is "Add Transaction"
    await dialog.getByRole('button', { name: 'Add Transaction' }).click();
    await expect(dialog).toHaveCount(0);
  }

  async getTransactionCount(): Promise<number> {
    const transactions = this.page.locator('[data-testid="transaction-item"]');
    return await transactions.count();
  }
}
