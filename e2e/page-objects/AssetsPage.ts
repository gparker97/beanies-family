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

    const dialog = this.page.locator('[role="dialog"]');

    // Select asset type via emoji chip (map type string to emoji label)
    const typeLabels: Record<string, string> = {
      real_estate: 'Real Estate',
      vehicle: 'Vehicle',
      boat: 'Boat',
      jewelry: 'Jewelry',
      electronics: 'Electronics',
      equipment: 'Equipment',
      art: 'Art',
      collectible: 'Collectible',
      other: 'Other',
    };
    const typeLabel = typeLabels[data.type] || data.type;
    await dialog.getByRole('button', { name: typeLabel }).click();

    // Fill asset name (placeholder-based input inside FormFieldGroup)
    await dialog.getByPlaceholder('Asset Name').fill(data.name);

    // Fill purchase value — first number input in the modal
    const amountInputs = dialog.locator('input[type="number"]');
    await amountInputs.nth(0).fill(data.purchaseValue.toString());

    // Fill current value — second number input
    await amountInputs.nth(1).fill(data.currentValue.toString());

    if (data.hasLoan) {
      // Toggle "Has a Loan" switch
      await dialog.getByText('Has a Loan').click();

      if (data.outstandingBalance !== undefined) {
        // Outstanding balance is the 4th number input (after loan amount)
        await amountInputs.nth(3).fill(data.outstandingBalance.toString());
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

    // Save — click the save button in the modal footer
    await dialog.getByRole('button', { name: /Add Asset/i }).click();
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
