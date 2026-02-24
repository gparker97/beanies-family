import { Page, expect } from '@playwright/test';
import { ComboboxHelper } from '../helpers/combobox';

export class AssetsPage {
  constructor(private page: Page) {}

  async goto() {
    await this.page.goto('/assets');
  }

  getLenderCombobox() {
    return new ComboboxHelper(this.page, 'Lender');
  }

  getLenderCountryCombobox() {
    return new ComboboxHelper(this.page, 'Country');
  }

  async addAssetWithLoan(data: {
    name: string;
    type: string;
    purchaseValue: number;
    currentValue: number;
    hasLoan: boolean;
    outstandingBalance?: number;
    lender?: string;
    lenderSearch?: string;
    customLender?: string;
    lenderCountry?: string;
    lenderCountrySearch?: string;
  }) {
    await this.page.getByRole('button', { name: 'Add Asset' }).first().click();
    await this.page.getByLabel('Asset Name').fill(data.name);
    await this.page.getByLabel('Asset Type').selectOption(data.type);
    await this.page.getByLabel('Purchase Value').fill(data.purchaseValue.toString());
    await this.page.getByLabel('Current Value').fill(data.currentValue.toString());

    if (data.hasLoan) {
      await this.page.getByText('This asset has a loan').click();

      if (data.outstandingBalance !== undefined) {
        await this.page.getByLabel('Outstanding Balance').fill(data.outstandingBalance.toString());
      }

      if (data.lender) {
        const lenderCombobox = this.getLenderCombobox();
        if (data.lenderSearch) {
          await lenderCombobox.searchAndSelect(data.lenderSearch, data.lender);
        } else {
          await lenderCombobox.selectOption(data.lender);
        }
      } else if (data.customLender) {
        await this.getLenderCombobox().selectOther(data.customLender);
      }

      if (data.lenderCountry) {
        const countryCombobox = this.getLenderCountryCombobox();
        if (data.lenderCountrySearch) {
          await countryCombobox.searchAndSelect(data.lenderCountrySearch, data.lenderCountry);
        } else {
          await countryCombobox.selectOption(data.lenderCountry);
        }
      }
    }

    await this.page.getByRole('button', { name: 'Add Asset' }).last().click();
    // Dismiss celebration modal if it appears
    const letsGoButton = this.page.getByRole('button', { name: "Let's go!" });
    try {
      await letsGoButton.waitFor({ state: 'visible', timeout: 2000 });
      await letsGoButton.click();
    } catch {
      // No celebration modal appeared — that's fine
    }
    await expect(this.page.locator('[role="dialog"]')).toHaveCount(0);
  }

  async getAssetCount(): Promise<number> {
    return await this.page.locator('[data-testid="asset-card"]').count();
  }
}
