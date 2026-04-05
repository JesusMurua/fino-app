import { test, expect } from '@playwright/test';
import { PinPage } from '../pages/PinPage';
import { seedDeviceConfig } from '../fixtures/device-config';

test.describe('PIN Login — Smoke Tests', () => {
  let pinPage: PinPage;

  test.beforeEach(async ({ page }) => {
    await seedDeviceConfig(page);
    pinPage = new PinPage(page);
    await pinPage.navigate();
  });

  test('should display the PIN keypad', async () => {
    await pinPage.expectKeypadVisible();
  });

  test('should fill the dots when pressing digits', async () => {
    await pinPage.pressDigit(1);
    await pinPage.pressDigit(2);
    await pinPage.expectFilledDots(2);
  });

  test('should remove a digit when pressing delete', async () => {
    await pinPage.enterPin('12');
    await pinPage.expectFilledDots(2);
    await pinPage.pressDelete();
    await pinPage.expectFilledDots(1);
  });

  test('should show error when the backend rejects the PIN with 401', async ({ page }) => {
    // Intercept the PIN authentication endpoint and force a 401 response
    // so we can test the UI's error handling without depending on the backend.
    await page.route('**/api/auth/pin-login', async (route) => {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Invalid PIN' }),
      });
    });

    await pinPage.enterPin('9999');
    await pinPage.expectErrorVisible();
  });

  test('should navigate to /login when clicking the owner link', async ({ page }) => {
    await pinPage.goToOwnerLogin();
    await expect(page).toHaveURL(/\/login$/);
  });
});
