import { Page, expect } from '@playwright/test';
import { ComboboxHelper } from '../helpers/combobox';

export class AccountsPage {
  constructor(private page: Page) {}

  async goto() {
    await this.page.goto('/accounts');
  }

  getInstitutionCombobox() {
    return new ComboboxHelper(this.page, 'Financial Institution');
  }

  getCountryCombobox() {
    return new ComboboxHelper(this.page, 'Country');
  }

  /**
   * Account type values map to FrequencyChips button labels in the new modal.
   * The modal uses emoji-prefixed chip labels (e.g., "🏦 Checking").
   */
  private typeToChipLabel(type: string): string {
    // Return the type text for matching (chips contain emoji + text)
    return type.charAt(0).toUpperCase() + type.slice(1).replace('_', ' ');
  }

  async addAccount(data: { name: string; type: string; balance: number; currency?: string }) {
    // Use .first() to always click the header button, avoiding strict mode violation
    // when both header and empty state buttons are visible
    await this.page.getByRole('button', { name: 'Add Account' }).first().click();

    // Name — raw input with placeholder "Account Name"
    await this.page.getByPlaceholder('Account Name').fill(data.name);

    // Type — FrequencyChips component, click the matching chip button
    const chipLabel = this.typeToChipLabel(data.type);
    await this.page.getByRole('button', { name: chipLabel }).click();

    // Balance — AmountInput with type="number", use the number input
    const balanceInput = this.page.locator('input[type="number"]').first();
    await balanceInput.fill(data.balance.toString());

    if (data.currency) {
      // Currency is a BaseSelect — find it by the nearby label text
      await this.page.getByLabel('Currency').selectOption(data.currency);
    }

    // Save button — "Add Account" button (inside the modal footer)
    await this.page.getByRole('button', { name: 'Add Account' }).last().click();

    // Dismiss any celebration modal that may appear (e.g. 'first-account' trigger)
    const letsGoButton = this.page.getByRole('button', { name: "Let's go!" });
    try {
      await letsGoButton.waitFor({ state: 'visible', timeout: 2000 });
      await letsGoButton.click();
    } catch {
      // No celebration modal appeared — that's fine
    }
    await expect(this.page.locator('[role="dialog"]')).toHaveCount(0);
  }

  async addAccountWithInstitution(data: {
    name: string;
    type: string;
    balance: number;
    institution?: string;
    institutionSearch?: string;
    customInstitution?: string;
    country?: string;
    countrySearch?: string;
  }) {
    await this.page.getByRole('button', { name: 'Add Account' }).first().click();

    // Name
    await this.page.getByPlaceholder('Account Name').fill(data.name);

    // Type — chip button
    const chipLabel = this.typeToChipLabel(data.type);
    await this.page.getByRole('button', { name: chipLabel }).click();

    // Balance
    const balanceInput = this.page.locator('input[type="number"]').first();
    await balanceInput.fill(data.balance.toString());

    // Expand "More Details" to access institution/country fields
    await this.page.getByRole('button', { name: 'More Details' }).click();

    if (data.institution) {
      const instCombobox = this.getInstitutionCombobox();
      if (data.institutionSearch) {
        await instCombobox.searchAndSelect(data.institutionSearch, data.institution);
      } else {
        await instCombobox.selectOption(data.institution);
      }
    } else if (data.customInstitution) {
      const instCombobox = this.getInstitutionCombobox();
      await instCombobox.selectOther(data.customInstitution);
    }

    if (data.country) {
      const countryCombobox = this.getCountryCombobox();
      if (data.countrySearch) {
        await countryCombobox.searchAndSelect(data.countrySearch, data.country);
      } else {
        await countryCombobox.selectOption(data.country);
      }
    }

    await this.page.getByRole('button', { name: 'Add Account' }).last().click();
    // Dismiss any celebration modal
    const letsGoButton = this.page.getByRole('button', { name: "Let's go!" });
    try {
      await letsGoButton.waitFor({ state: 'visible', timeout: 2000 });
      await letsGoButton.click();
    } catch {
      // No celebration modal appeared — that's fine
    }
    await expect(this.page.locator('[role="dialog"]')).toHaveCount(0);
  }

  async getAccountCount(): Promise<number> {
    const accounts = this.page.locator('[data-testid="account-card"]');
    return await accounts.count();
  }
}
