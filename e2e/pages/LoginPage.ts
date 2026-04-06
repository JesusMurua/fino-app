import { type Locator, type Page, expect } from '@playwright/test';
import { BasePage } from './BasePage';

/**
 * Page Object Model for the Login screen (/login).
 * Encapsulates all selectors — spec files must never use raw selectors.
 */
export class LoginPage extends BasePage {
  //#region Locators
  private readonly emailInput: Locator;
  private readonly passwordInput: Locator;
  private readonly submitButton: Locator;
  private readonly errorMessage: Locator;
  //#endregion

  constructor(page: Page) {
    super(page);
    this.emailInput = this.page.locator('#email');
    this.passwordInput = this.page.locator('p-password#password input');
    this.submitButton = this.page.locator('button.login-submit');
    this.errorMessage = this.page.locator('.login-error');
  }

  //#region Navigation
  /** Navigate directly to the login page. */
  async navigate(): Promise<void> {
    await this.goto('/login');
  }
  //#endregion

  //#region Actions
  /** Fill in the email field. */
  async fillEmail(email: string): Promise<void> {
    await this.emailInput.fill(email);
  }

  /** Fill in the password field. */
  async fillPassword(password: string): Promise<void> {
    await this.passwordInput.fill(password);
  }

  /** Click the submit / login button. */
  async submit(): Promise<void> {
    await this.submitButton.click();
  }

  /** Perform a full login attempt with the given credentials. */
  async loginWith(email: string, password: string): Promise<void> {
    await this.fillEmail(email);
    await this.fillPassword(password);
    await this.submit();
  }
  //#endregion

  //#region Assertions
  /** Assert that the core login form elements are visible. */
  async expectFormVisible(): Promise<void> {
    await expect(this.emailInput).toBeVisible();
    await expect(this.passwordInput).toBeVisible();
    await expect(this.submitButton).toBeVisible();
  }

  /** Assert that the error message is visible and optionally contains text. */
  async expectErrorVisible(expectedText?: string): Promise<void> {
    await expect(this.errorMessage).toBeVisible();
    if (expectedText) {
      await expect(this.errorMessage).toContainText(expectedText);
    }
  }

  /** Assert that the submit button is disabled. */
  async expectSubmitDisabled(): Promise<void> {
    await expect(this.submitButton).toBeDisabled();
  }

  /** Assert that the submit button is enabled. */
  async expectSubmitEnabled(): Promise<void> {
    await expect(this.submitButton).toBeEnabled();
  }
  //#endregion
}
