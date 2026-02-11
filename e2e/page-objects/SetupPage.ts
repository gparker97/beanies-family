import { Page } from '@playwright/test';

export class SetupPage {
  constructor(private page: Page) {}

  get nameInput() {
    return this.page.getByLabel('Your Name');
  }
  get emailInput() {
    return this.page.getByLabel('Email Address');
  }
  get currencySelect() {
    return this.page.getByLabel('Base Currency');
  }
  get continueButton() {
    return this.page.getByRole('button', { name: 'Continue' });
  }
  get getStartedButton() {
    return this.page.getByRole('button', { name: 'Get Started' });
  }

  async goto() {
    await this.page.goto('/setup');
  }

  async completeSetup(name = 'John Doe', email = 'john@example.com', currency = 'USD') {
    await this.goto();
    await this.nameInput.fill(name);
    await this.emailInput.fill(email);
    await this.continueButton.click();
    await this.currencySelect.selectOption(currency);
    await this.getStartedButton.click();
    await this.page.waitForURL('/dashboard');
  }
}
