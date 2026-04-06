import { type Locator, type Page, expect } from '@playwright/test';
import { BasePage } from './BasePage';

/**
 * Page Object Model for the Stock Receipts (Recepciones) tab
 * under Admin → Inventory. Encapsulates every selector required
 * to list, create, and edit stock receipts. Spec files must never
 * use raw selectors — they interact exclusively through this POM.
 */
export class StockReceiptsPage extends BasePage {
  //#region Locators — Main tab
  private readonly newReceiptButton: Locator;
  private readonly receiptsTable: Locator;
  //#endregion

  //#region Locators — Form dialog
  private readonly formDialog: Locator;
  private readonly supplierDropdown: Locator;
  private readonly addManualButton: Locator;
  private readonly linesTable: Locator;
  private readonly grandTotalValue: Locator;
  private readonly confirmButton: Locator;
  //#endregion

  //#region Locators — Item picker sub-dialog
  private readonly itemPickerDialog: Locator;
  private readonly itemPickerDropdown: Locator;
  private readonly itemPickerConfirmButton: Locator;
  //#endregion

  constructor(page: Page) {
    super(page);

    // Main tab
    this.newReceiptButton = this.page.getByRole('button', {
      name: 'Nueva recepción',
    });
    this.receiptsTable = this.page.locator('app-stock-receipts-table p-table');

    // Form dialog — scoped so that nested locators never leak to the sub-dialog
    this.formDialog = this.page
      .locator('p-dialog')
      .filter({ hasText: 'Nueva recepción de mercancía' });
    this.supplierDropdown = this.formDialog.locator('p-dropdown').first();
    this.addManualButton = this.formDialog.getByRole('button', { name: 'Agregar' });
    this.linesTable = this.formDialog.locator('p-table');
    this.grandTotalValue = this.formDialog.locator('span.text-xl.font-bold');
    this.confirmButton = this.formDialog.getByRole('button', {
      name: /Confirmar recepción/,
    });

    // Item picker sub-dialog
    this.itemPickerDialog = this.page
      .locator('p-dialog')
      .filter({ hasText: 'Agregar producto / insumo' });
    this.itemPickerDropdown = this.itemPickerDialog.locator('p-dropdown').first();
    this.itemPickerConfirmButton = this.itemPickerDialog.getByRole('button', {
      name: 'Agregar',
    });
  }

  //#region Navigation
  /** Navigate directly to the Stock Receipts tab. */
  async navigate(): Promise<void> {
    await this.goto('/admin/inventory?tab=2');
  }
  //#endregion

  //#region Main tab — assertions and actions
  /** Assert that the main receipts table is rendered. */
  async expectTableLoaded(): Promise<void> {
    await expect(this.receiptsTable).toBeVisible();
  }

  /** Open the "Nueva recepción" dialog and wait until it is visible. */
  async openCreateDialog(): Promise<void> {
    await this.newReceiptButton.click();
    await expect(this.formDialog).toBeVisible();
  }

  /** Assert that the create-receipt dialog is currently visible. */
  async expectCreateDialogVisible(): Promise<void> {
    await expect(this.formDialog).toBeVisible();
  }
  //#endregion

  //#region Item picker
  /** Open the manual item picker sub-dialog. */
  async openItemPicker(): Promise<void> {
    await this.addManualButton.click();
    await expect(this.itemPickerDialog).toBeVisible();
  }

  /**
   * Select the first option available in the picker dropdown, without
   * relying on a hard-coded item name, and confirm to push it into the
   * lines table.
   */
  async selectFirstAvailableItem(): Promise<void> {
    await this.itemPickerDropdown.click();
    const firstOption = this.page.locator('.p-dropdown-items .p-dropdown-item').first();
    await expect(firstOption).toBeVisible();
    await firstOption.click();
    await this.itemPickerConfirmButton.click();
    await expect(this.itemPickerDialog).toBeHidden();
  }

  /** Convenience helper: open picker + select first item + close picker. */
  async addFirstAvailableItem(): Promise<void> {
    await this.openItemPicker();
    await this.selectFirstAvailableItem();
  }
  //#endregion

  //#region Lines table — per-row editing
  /** Return the row locator for a given index inside the lines table. */
  private getLineRow(rowIndex: number): Locator {
    return this.linesTable.locator('tbody tr').nth(rowIndex);
  }

  /** Return the native input inside a p-inputNumber for a cell index. */
  private getRowInput(rowIndex: number, inputIndex: number): Locator {
    return this.getLineRow(rowIndex).locator('p-inputNumber input').nth(inputIndex);
  }

  /** Set the quantity for a given line row. */
  async setLineQuantity(rowIndex: number, quantity: number): Promise<void> {
    const input = this.getRowInput(rowIndex, 0);
    await input.click();
    await input.press('Control+A');
    await input.fill(String(quantity));
    await input.press('Tab');
  }

  /** Set the unit cost (in pesos) for a given line row. */
  async setLineUnitCost(rowIndex: number, costPesos: number): Promise<void> {
    const input = this.getRowInput(rowIndex, 1);
    await input.click();
    await input.press('Control+A');
    await input.fill(costPesos.toFixed(2));
    await input.press('Tab');
  }

  /** Return how many line rows are currently in the receipt. */
  async getLineCount(): Promise<number> {
    return this.linesTable.locator('tbody tr').count();
  }
  //#endregion

  //#region Grand total
  /** Return the raw text displayed in the grand total (e.g. "$76.50"). */
  async getGrandTotalText(): Promise<string> {
    const raw = await this.grandTotalValue.innerText();
    return raw.trim();
  }

  /** Parse the displayed grand total into a plain number. */
  async getGrandTotalAsNumber(): Promise<number> {
    const text = await this.getGrandTotalText();
    const normalized = text.replace(/[^0-9.-]/g, '');
    return Number.parseFloat(normalized);
  }

  /**
   * Assert the displayed grand total equals `expected` (MXN, two decimals).
   * Comparison uses `toBeCloseTo` to absorb floating-point rounding.
   */
  async expectGrandTotal(expected: number): Promise<void> {
    await expect
      .poll(async () => this.getGrandTotalAsNumber(), { timeout: 5_000 })
      .toBeCloseTo(expected, 2);
  }
  //#endregion
}
