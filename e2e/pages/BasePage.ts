import { type Page, type Response } from '@playwright/test';

/**
 * Base Page Object Model class.
 * Provides common navigation and wait helpers for all page objects.
 */
export class BasePage {
  constructor(protected readonly page: Page) {}

  /** Navigate to a relative path and wait for the network to settle. */
  async goto(path: string): Promise<Response | null> {
    return this.page.goto(path, { waitUntil: 'networkidle' });
  }

  /** Wait until the DOM content is fully loaded. */
  async waitForLoadState(
    state: 'load' | 'domcontentloaded' | 'networkidle' = 'domcontentloaded',
  ): Promise<void> {
    await this.page.waitForLoadState(state);
  }

  /** Return the current page title. */
  async getTitle(): Promise<string> {
    return this.page.title();
  }

  /** Return the current URL pathname. */
  getCurrentPath(): string {
    return new URL(this.page.url()).pathname;
  }
}
