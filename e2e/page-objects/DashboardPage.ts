import { Page } from '@playwright/test';

export class DashboardPage {
  constructor(private page: Page) {}

  async goto() {
    await this.page.goto('/dashboard');
  }

  /** Click the privacy mode unlock button to reveal masked financial figures */
  async unlockPrivacyMode() {
    await this.page.getByRole('button', { name: 'Show financial figures' }).click();
  }

  /** Returns the locator for the Net Worth value (hero card) */
  get netWorthValue() {
    return this.page.getByTestId('hero-amount');
  }

  /** Returns the locator for the Monthly Income value */
  get monthlyIncomeValue() {
    return this.page.getByTestId('stat-monthly-income').getByTestId('stat-amount');
  }

  /** Returns the locator for the Monthly Expenses value */
  get monthlyExpensesValue() {
    return this.page.getByTestId('stat-monthly-expenses').getByTestId('stat-amount');
  }

  /** Returns the locator for the Net Cash Flow value */
  get netCashFlowValue() {
    return this.page.getByTestId('stat-net-cash-flow').getByTestId('stat-amount');
  }

  // Legacy methods (read text immediately without waiting for specific values)
  async getNetWorth(): Promise<string> {
    return (await this.netWorthValue.textContent()) || '';
  }

  async getMonthlyIncome(): Promise<string> {
    return (await this.monthlyIncomeValue.textContent()) || '';
  }

  async getMonthlyExpenses(): Promise<string> {
    return (await this.monthlyExpensesValue.textContent()) || '';
  }

  async getNetCashFlow(): Promise<string> {
    return (await this.netCashFlowValue.textContent()) || '';
  }
}
