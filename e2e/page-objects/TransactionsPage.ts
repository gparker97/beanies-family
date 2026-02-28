import { Page, expect } from '@playwright/test';

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

    // Category (BaseSelect with grouped options)
    if (data.category) {
      // Category is the first <select> in the dialog
      await this.page.locator('[role="dialog"] select').first().selectOption(data.category);
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
