import { test } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';
import { StockReceiptsPage } from '../pages/StockReceiptsPage';

const E2E_EMAIL: string | undefined = process.env['E2E_EMAIL'];
const E2E_PASSWORD: string | undefined = process.env['E2E_PASSWORD'];

test.describe('Stock Receipts — Basic flow', () => {
  let stockReceiptsPage: StockReceiptsPage;

  test.beforeEach(async ({ page }) => {
    test.skip(
      !E2E_EMAIL || !E2E_PASSWORD,
      'E2E credentials not provided in environment',
    );

    // Authenticate through the real login UI before visiting the module.
    const loginPage = new LoginPage(page);
    await loginPage.navigate();
    await loginPage.loginWith(E2E_EMAIL as string, E2E_PASSWORD as string);

    stockReceiptsPage = new StockReceiptsPage(page);
    await stockReceiptsPage.navigate();
  });

  test('should load the receipts table', async () => {
    await stockReceiptsPage.expectTableLoaded();
  });

  test('should open the new receipt dialog', async () => {
    await stockReceiptsPage.openCreateDialog();
    await stockReceiptsPage.expectCreateDialogVisible();
  });

  test('should update the grand total after editing quantity and unit cost', async () => {
    const quantity = 3;
    const unitCost = 25.5;
    const expectedTotal = quantity * unitCost;

    await stockReceiptsPage.openCreateDialog();
    await stockReceiptsPage.addFirstAvailableItem();
    await stockReceiptsPage.setLineQuantity(0, quantity);
    await stockReceiptsPage.setLineUnitCost(0, unitCost);

    await stockReceiptsPage.expectGrandTotal(expectedTotal);
  });
});
