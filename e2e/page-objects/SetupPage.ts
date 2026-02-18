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
  get backButton() {
    return this.page.getByRole('button', { name: 'Back' });
  }
  get downloadButton() {
    return this.page.getByRole('button', { name: 'Download Your Data' });
  }

  async goto() {
    await this.page.goto('/setup');
  }

  /**
   * Complete the 3-step setup wizard.
   * Step 1: Profile (name + email)
   * Step 2: Currency
   * Step 3: Secure Your Data — uses "Download Your Data" fallback
   *
   * Disables File System Access API so the download fallback button appears
   * (the API exists in headless Chromium but file pickers can't open).
   */
  async completeSetup(name = 'John Doe', email = 'john@example.com', currency = 'USD') {
    // Disable File System Access API so the "Download Your Data" fallback appears
    // (headless Chromium has the API but file picker dialogs can't open)
    await this.page.addInitScript(() => {
      delete (window as any).showSaveFilePicker;
      delete (window as any).showOpenFilePicker;
    });

    await this.goto();
    // Step 1: Profile
    await this.nameInput.fill(name);
    await this.emailInput.fill(email);
    await this.continueButton.click();
    // Step 2: Currency
    await this.currencySelect.selectOption(currency);
    await this.continueButton.click();
    // Step 3: Secure Your Data — use download fallback
    // manualExport() triggers a file download before navigating to /dashboard.
    // Capture the download event to prevent Playwright from treating it as a
    // failed navigation (throws "Download is starting" in Firefox/WebKit).
    await Promise.all([this.page.waitForEvent('download'), this.downloadButton.click()]);
    await this.page.waitForURL('/dashboard');
  }
}
