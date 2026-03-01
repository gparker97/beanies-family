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
   * Account type values map to category → subtype chip clicks in the new
   * AccountCategoryPicker. Returns the category chip label and (optional)
   * subtype chip label needed to select the given account type.
   */
  private typeToChipSequence(type: string): { category: string; subtype?: string } {
    const map: Record<string, { category: string; subtype?: string }> = {
      checking: { category: '🏦 Bank', subtype: '🏦 Checking' },
      savings: { category: '🏦 Bank', subtype: '🐷 Savings' },
      credit_card: { category: '🏦 Bank', subtype: '💳 Credit Card' },
      investment: { category: '📈 Investment', subtype: '📈 Brokerage' },
      crypto: { category: '📈 Investment', subtype: '₿ Crypto' },
      retirement_401k: { category: '🏛️ Retirement', subtype: '🏛️ 401k' },
      retirement_ira: { category: '🏛️ Retirement', subtype: '🏛️ IRA' },
      retirement_roth_ira: { category: '🏛️ Retirement', subtype: '🏛️ ROTH IRA' },
      retirement_bene_ira: { category: '🏛️ Retirement', subtype: '🏛️ BENE IRA' },
      retirement_kids_ira: { category: '🏛️ Retirement', subtype: '🏛️ Kids IRA' },
      retirement: { category: '🏛️ Retirement', subtype: '🏛️ Retirement' },
      education_529: { category: '📈 Investment', subtype: '🎓 College Fund (529)' },
      education_savings: { category: '📈 Investment', subtype: '🎓 Education Savings' },
      cash: { category: '💵 Cash' }, // auto-selects, no subtype needed
      loan: { category: '🏦 Loan' }, // auto-selects
      other: { category: '📦 Other' }, // auto-selects
    };
    return map[type] || { category: '📦 Other' };
  }

  /** Click the category and subtype chips to select an account type */
  private async selectAccountType(type: string) {
    const { category, subtype } = this.typeToChipSequence(type);
    await this.page.getByRole('button', { name: category, exact: true }).click();
    if (subtype) {
      await this.page.getByRole('button', { name: subtype, exact: true }).click();
    }
  }

  async addAccount(data: { name: string; type: string; balance: number; currency?: string }) {
    // Use .first() to always click the header button, avoiding strict mode violation
    // when both header and empty state buttons are visible
    await this.page.getByRole('button', { name: 'Add Account' }).first().click();

    // Name — raw input with placeholder "Account Name"
    await this.page.getByPlaceholder('Account Name').fill(data.name);

    // Type — AccountCategoryPicker: click category chip, then subtype chip
    await this.selectAccountType(data.type);

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

    // Type — AccountCategoryPicker: click category chip, then subtype chip
    await this.selectAccountType(data.type);

    // Balance
    const balanceInput = this.page.locator('input[type="number"]').first();
    await balanceInput.fill(data.balance.toString());

    // Institution/country fields are now inline (no "More Details" expansion needed)
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
