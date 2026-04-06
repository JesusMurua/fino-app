import { type Locator, type Page, expect } from '@playwright/test';
import { BasePage } from './BasePage';

/**
 * Page Object Model for the PIN login screen (/pin).
 * Encapsulates every selector needed to drive the numeric keypad.
 */
export class PinPage extends BasePage {
  //#region Locators
  private readonly pinCard: Locator;
  private readonly numpad: Locator;
  private readonly dots: Locator;
  private readonly filledDots: Locator;
  private readonly deleteKey: Locator;
  private readonly errorMessage: Locator;
  private readonly lockoutBanner: Locator;
  private readonly ownerLoginLink: Locator;
  private readonly offlineBadge: Locator;
  //#endregion

  constructor(page: Page) {
    super(page);
    this.pinCard = this.page.locator('.pin-card');
    this.numpad = this.page.locator('.pin-numpad');
    this.dots = this.page.locator('.pin-dot');
    this.filledDots = this.page.locator('.pin-dot.pin-dot--filled');
    this.deleteKey = this.page.locator('.pin-key--del');
    this.errorMessage = this.page.locator('.pin-error');
    this.lockoutBanner = this.page.locator('.pin-lockout');
    this.ownerLoginLink = this.page.locator('.pin-owner-link');
    this.offlineBadge = this.page.locator('.pin-offline-badge');
  }

  //#region Navigation
  /** Navigate directly to the PIN screen. */
  async navigate(): Promise<void> {
    await this.goto('/pin');
  }
  //#endregion

  //#region Keypad actions
  /** Return the locator for a digit key by its aria-label. */
  private digitKey(digit: number): Locator {
    return this.page.locator(`.pin-key[aria-label="Dígito ${digit}"]`);
  }

  /** Press a single digit key. */
  async pressDigit(digit: number): Promise<void> {
    await this.digitKey(digit).click();
  }

  /** Press the delete key to remove the last digit. */
  async pressDelete(): Promise<void> {
    await this.deleteKey.click();
  }

  /** Type every character of the given PIN (one key press per digit). */
  async enterPin(pin: string): Promise<void> {
    for (const char of pin) {
      const digit = Number.parseInt(char, 10);
      await this.pressDigit(digit);
    }
  }

  /** Click the "¿Eres el dueño?" link that navigates to /login. */
  async goToOwnerLogin(): Promise<void> {
    await this.ownerLoginLink.click();
  }
  //#endregion

  //#region Assertions
  /** Assert that the keypad is rendered and visible. */
  async expectKeypadVisible(): Promise<void> {
    await expect(this.pinCard).toBeVisible();
    await expect(this.numpad).toBeVisible();
  }

  /** Return how many dots are currently filled. */
  async getFilledDotsCount(): Promise<number> {
    return this.filledDots.count();
  }

  /** Assert that exactly `count` dots are filled (polled to absorb timing). */
  async expectFilledDots(count: number): Promise<void> {
    await expect
      .poll(async () => this.getFilledDotsCount(), { timeout: 3_000 })
      .toBe(count);
  }

  /** Assert that the error message is visible. */
  async expectErrorVisible(): Promise<void> {
    await expect(this.errorMessage).toBeVisible();
  }

  /** Assert that the lockout banner is visible. */
  async expectLockoutVisible(): Promise<void> {
    await expect(this.lockoutBanner).toBeVisible();
  }

  /** Assert that the offline badge is visible. */
  async expectOfflineBadgeVisible(): Promise<void> {
    await expect(this.offlineBadge).toBeVisible();
  }
  //#endregion
}
