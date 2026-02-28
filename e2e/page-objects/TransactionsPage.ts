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

  async selectDateFilter(filter: 'current_month' | 'last_month' | 'last_3_months') {
    // Switch to transactions tab if not already there (date filters only visible on transactions tab)
    await this.page.getByRole('button', { name: 'One Time Transactions' }).click();

    const filterButtons = {
      current_month: 'Current Month',
      last_month: 'Last Month',
      last_3_months: 'Last 3 Months',
    };
    await this.page.getByRole('button', { name: filterButtons[filter] }).click();
  }

  async addTransaction(data: {
    type: 'income' | 'expense';
    account: string;
    description: string;
    amount: number;
    category?: string;
  }) {
    // Switch to transactions tab if not already there (default is recurring tab)
    await this.page.getByRole('button', { name: 'One Time Transactions' }).click();
    await this.page.getByRole('button', { name: 'Add Transaction' }).click();

    // Direction toggle (TogglePillGroup) — default is "out" (expense)
    if (data.type === 'income') {
      await this.page.getByRole('button', { name: /Money In/ }).click();
    }

    // Amount (AmountInput — number input)
    await this.page.locator('input[type="number"]').fill(data.amount.toString());

    // Description (raw input with placeholder)
    await this.page.getByPlaceholder('Description').fill(data.description);

    // Category — two-level CategoryChipPicker: click group chip, then sub-category chip
    if (data.category) {
      const group = CATEGORY_GROUP_MAP[data.category];
      if (group) {
        // Click the group chip to expand it
        await this.page.locator('[role="dialog"]').getByRole('button', { name: group }).click();
      }
      // Click the sub-category chip (capitalize first letter to match display name)
      const categoryName = data.category
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase());
      await this.page
        .locator('[role="dialog"]')
        .getByRole('button', { name: categoryName })
        .click();
    }

    // Account — BaseSelect with "Select an account" placeholder option
    await this.page
      .locator('select')
      .filter({ has: this.page.locator('option', { hasText: 'Select an account' }) })
      .selectOption({ label: data.account });

    // Save
    await this.page.getByRole('button', { name: 'Add Transaction' }).last().click();
    await expect(this.page.locator('[role="dialog"]')).toHaveCount(0);
  }

  async getTransactionCount(): Promise<number> {
    const transactions = this.page.locator('[data-testid="transaction-item"]');
    return await transactions.count();
  }
}
