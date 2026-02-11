import { Page } from '@playwright/test';

export class DashboardPage {
  constructor(private page: Page) {}

  async goto() {
    await this.page.goto('/dashboard');
  }

  async getNetWorth(): Promise<string> {
    const card = this.page.locator('text=Net Worth').locator('..');
    return (await card.locator('.text-2xl').textContent()) || '';
  }

  async getMonthlyIncome(): Promise<string> {
    const card = this.page.locator('text=Monthly Income').locator('..');
    return (await card.locator('.text-2xl').textContent()) || '';
  }

  async getMonthlyExpenses(): Promise<string> {
    const card = this.page.locator('text=Monthly Expenses').locator('..');
    return (await card.locator('.text-2xl').textContent()) || '';
  }

  async getNetCashFlow(): Promise<string> {
    const card = this.page.locator('text=Net Cash Flow').locator('..');
    return (await card.locator('.text-2xl').textContent()) || '';
  }
}
