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
    await this.page.getByLabel('Type').selectOption(data.type);
    await this.page.getByLabel('Account').selectOption(data.account);
    await this.page.getByLabel('Description').fill(data.description);
    await this.page.getByLabel('Amount').fill(data.amount.toString());
    if (data.category) {
      await this.page.getByLabel('Category').selectOption(data.category);
    }
    await this.page.getByRole('button', { name: 'Add Transaction' }).last().click();
    await expect(this.page.locator('[role="dialog"]')).toHaveCount(0);
  }

  async getTransactionCount(): Promise<number> {
    const transactions = this.page.locator('[data-testid="transaction-item"]');
    return await transactions.count();
  }
}
