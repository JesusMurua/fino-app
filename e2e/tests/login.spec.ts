import { test } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';
import { seedDeviceConfig } from '../fixtures/device-config';

test.describe('Login — Smoke Tests', () => {
  let loginPage: LoginPage;

  test.beforeEach(async ({ page }) => {
    await seedDeviceConfig(page);
    loginPage = new LoginPage(page);
    await loginPage.navigate();
  });

  test('should display the login form', async () => {
    await loginPage.expectFormVisible();
  });

  test('should keep submit disabled when fields are empty', async () => {
    await loginPage.expectSubmitDisabled();
  });

  test('should enable submit after filling credentials', async () => {
    await loginPage.fillEmail('test@example.com');
    await loginPage.fillPassword('wrongpassword');
    await loginPage.expectSubmitEnabled();
  });

  test('should show error on invalid credentials', async () => {
    await loginPage.loginWith('test@example.com', 'wrongpassword');
    await loginPage.expectErrorVisible();
  });
});
