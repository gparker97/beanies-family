import { Locator, Page, expect } from '@playwright/test';

/**
 * Helper class for interacting with BaseCombobox components in E2E tests.
 *
 * Locates a combobox by its label text (the visible `<label>` rendered by
 * the component) and provides methods for opening, searching, selecting,
 * entering custom values, and asserting displayed text.
 */
export class ComboboxHelper {
  private container: Locator;

  constructor(
    private page: Page,
    label: string
  ) {
    // The BaseCombobox renders inside a `div.relative.space-y-1` that contains
    // a <label> with the provided text. Use that structure to scope all
    // selectors to the correct combobox instance.
    this.container = page.locator('.relative.space-y-1', {
      has: page.getByText(label, { exact: true }),
    });
  }

  get trigger() {
    return this.container.getByTestId('combobox-trigger');
  }

  get searchInput() {
    return this.container.getByTestId('combobox-search');
  }

  get customInput() {
    return this.container.getByTestId('combobox-custom-input');
  }

  get dropdown() {
    return this.container.getByTestId('combobox-dropdown');
  }

  get clearButton() {
    return this.container.getByTestId('combobox-clear');
  }

  /**
   * Programmatically click an element via JS dispatchEvent.
   * Used for dropdown options that may extend outside the viewport
   * (position: absolute dropdowns in long forms/modals).
   */
  private async jsClick(locator: Locator) {
    await locator.dispatchEvent('click');
  }

  /** Open the dropdown and wait for it to be visible. */
  async open() {
    // Scroll the trigger toward the top of the viewport so the dropdown
    // (position: absolute, opens downward) has room and stays in-viewport.
    await this.trigger.evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await this.trigger.click();
    await expect(this.dropdown).toBeVisible();
  }

  /** Type into the search input (dropdown must already be open). */
  async search(text: string) {
    await this.searchInput.fill(text);
  }

  /** Open the dropdown and click the option whose visible text matches `optionLabel`. */
  async selectOption(optionLabel: string) {
    await this.open();
    // Use dispatchEvent('click') — the option is inside a position:absolute
    // dropdown that may extend below the viewport boundary.
    await this.jsClick(this.container.getByRole('button', { name: optionLabel }));
    await expect(this.dropdown).not.toBeVisible();
  }

  /** Open, search, then click the matching option. */
  async searchAndSelect(query: string, optionLabel: string) {
    await this.open();
    await this.search(query);
    await this.jsClick(this.container.getByRole('button', { name: optionLabel }));
    await expect(this.dropdown).not.toBeVisible();
  }

  /** Click "Other", then fill and confirm a custom value. */
  async selectOther(customText: string) {
    await this.open();
    await this.jsClick(this.container.getByTestId('combobox-other'));
    await expect(this.dropdown).not.toBeVisible();
    await expect(this.customInput).toBeVisible();
    await this.customInput.fill(customText);
    await this.customInput.press('Enter');
  }

  /** Return the trimmed display text shown on the trigger button. */
  async getDisplayText(): Promise<string> {
    return (await this.trigger.innerText()).trim();
  }

  /** Clear the current selection. */
  async clear() {
    await this.clearButton.click();
  }

  /** Assert the trigger button contains the given text. */
  async expectDisplayText(text: string) {
    await expect(this.trigger).toContainText(text);
  }

  /** Assert the open dropdown contains the given text. */
  async expectDropdownContains(text: string) {
    await expect(this.dropdown).toContainText(text);
  }

  /** Assert the open dropdown does NOT contain the given text. */
  async expectDropdownNotContains(text: string) {
    await expect(this.dropdown).not.toContainText(text);
  }
}
