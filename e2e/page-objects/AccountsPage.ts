import { Page, expect } from '@playwright/test';

export class AccountsPage {
  constructor(private page: Page) {}

  async goto() {
    await this.page.goto('/accounts');
  }

  async addAccount(data: { name: string; type: string; balance: number; currency?: string }) {
    await this.page.getByRole('button', { name: 'Add Account' }).click();
    await this.page.getByLabel('Account Name').fill(data.name);
    await this.page.getByLabel('Account Type').selectOption(data.type);
    await this.page.getByLabel('Balance').fill(data.balance.toString());
    if (data.currency) {
      await this.page.getByLabel('Currency').selectOption(data.currency);
    }
    await this.page.getByRole('button', { name: 'Add Account' }).last().click();
    await expect(this.page.getByRole('dialog')).not.toBeVisible();
  }

  async getAccountCount(): Promise<number> {
    const accounts = this.page.locator('[data-testid="account-card"]');
    return await accounts.count();
  }
}
