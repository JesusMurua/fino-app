import { type Page } from '@playwright/test';

/**
 * Test helper to satisfy the `setupGuard` before visiting /login or /pin.
 *
 * The guard checks `ConfigService.isDeviceConfigured()`, which reads from
 * localStorage under the key `pos-device-config`. Without a valid config
 * (businessId > 0 && branchId > 0), the guard redirects to /setup and
 * every login-related selector times out.
 *
 * NOTE: the constants below are duplicated intentionally from
 * `src/app/core/models/device-config.model.ts` so that the E2E suite
 * does not depend on the Angular tsconfig / paths.
 */

/** localStorage key used by ConfigService to persist the device config. */
export const DEVICE_CONFIG_KEY = 'pos-device-config';

/** Shape of the persisted device config (subset needed by setupGuard). */
export interface TestDeviceConfig {
  mode: 'cashier' | 'kiosk' | 'tables' | 'kitchen';
  deviceName: string;
  businessId: number;
  branchId: number;
  businessName: string;
  branchName: string;
  configuredAt: string;
}

/**
 * Default config used in tests. Uses `cashier` mode on purpose —
 * `kiosk` would trigger a redirect to /kiosk inside setupGuard.
 */
export const defaultTestDeviceConfig: TestDeviceConfig = {
  mode: 'cashier',
  deviceName: 'E2E Test Device',
  businessId: 1,
  branchId: 1,
  businessName: 'E2E Business',
  branchName: 'E2E Branch',
  configuredAt: '2026-01-01T00:00:00.000Z',
};

/**
 * Injects a valid DeviceConfig into localStorage BEFORE any page script
 * runs. Call this once per test (typically in beforeEach) prior to the
 * first `page.goto(...)`.
 */
export async function seedDeviceConfig(
  page: Page,
  overrides: Partial<TestDeviceConfig> = {},
): Promise<void> {
  const config: TestDeviceConfig = { ...defaultTestDeviceConfig, ...overrides };
  await page.addInitScript(
    ({ key, value }: { key: string; value: string }) => {
      window.localStorage.setItem(key, value);
    },
    { key: DEVICE_CONFIG_KEY, value: JSON.stringify(config) },
  );
}
