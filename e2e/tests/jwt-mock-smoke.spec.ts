import { expect, test } from '@playwright/test';

import { seedDeviceConfig } from '../fixtures/device-config';
import { mockAuthMeEndpoint, seedJwtClaims } from '../fixtures/jwt-mock';
import { TEST_TENANT_SCENARIOS } from '../fixtures/scenarios';

/**
 * Smoke suite for the AUDIT-058 §3.2 JWT-mock fixture.
 *
 * Scope of this suite: validate the FIXTURE itself — that
 * `seedJwtClaims()` correctly injects the auth payload into
 * `localStorage` so downstream specs can boot the Angular app under
 * a synthetic tenant identity. Each scenario covers a distinct
 * macro × plan × features combination.
 *
 * What this suite does NOT cover: full vertical-aware UI rendering
 * end-to-end. That requires backend mocks for `/business/settings`,
 * `/tax/catalog`, `/products`, etc. — out of scope for the §3.2
 * deliverable. Once `CapturingPrinterTransport` (§3.3) and other
 * backend mocks land, future smoke specs can extend coverage to UI
 * rendering by composing this fixture with those mocks.
 *
 * Drift detection: if a `TestFeatureKey` value diverges from src's
 * `FeatureKey` enum, the seeded `features` array becomes stale.
 * Future UI-rendering specs (post §3.3 / §3.4) would catch the drift
 * via failed feature-gated assertions; this fixture-only suite
 * cannot detect that class of drift on its own.
 */

test.describe('JWT-Mock fixture — localStorage seeding contract', () => {

  for (const [name, scenario] of Object.entries(TEST_TENANT_SCENARIOS)) {

    test(`${name} seeds auth localStorage with the expected shape`, async ({ page }) => {
      await seedDeviceConfig(page);
      await seedJwtClaims(page, scenario);
      await mockAuthMeEndpoint(page, scenario);

      // Trigger the init scripts by navigating anywhere on the origin.
      // We use about:blank-style early navigation so no Angular guards
      // kick in — we only need the addInitScript hooks to fire.
      await page.goto('/', { waitUntil: 'commit' });

      const seeded = await page.evaluate(() => ({
        token:  window.localStorage.getItem('pos_auth_token'),
        user:   window.localStorage.getItem('pos_auth_user'),
        branch: window.localStorage.getItem('pos_active_branch_id'),
      }));

      // Token is a 3-segment JWT (header.payload.signature).
      expect(seeded.token).not.toBeNull();
      expect(seeded.token!.split('.').length).toBe(3);

      // AuthUser is a parseable JSON object carrying the required claim
      // fields (the schema guard in `loadUserFromStorage()` rejects
      // anything missing `primaryMacroCategoryId` — which would also
      // silently wipe the storage, so we verify it survives).
      const user = JSON.parse(seeded.user!) as {
        primaryMacroCategoryId: number;
        planTypeId: number;
        roleId: number;
        onboardingStatusId: number;
        features: string[];
      };
      expect(user.primaryMacroCategoryId).toBeGreaterThanOrEqual(1);
      expect(user.primaryMacroCategoryId).toBeLessThanOrEqual(4);
      expect(user.planTypeId).toBe(scenario.planType);
      expect(user.onboardingStatusId).toBe(3);
      expect(user.features).toEqual([...scenario.features]);

      // Active branch is set so `BranchContextService` boots immediately.
      expect(seeded.branch).toBe('1');

      // JWT payload carries the macro/feature claims `TenantContextService`
      // reads via `jwt.utils.ts` (`extractMacroCategoryFromJwt`,
      // `extractFeaturesFromJwt`).
      const payload = JSON.parse(
        Buffer.from(seeded.token!.split('.')[1], 'base64').toString('utf8'),
      ) as { macroCategory: string; features: string[]; planType: number };
      expect(payload.macroCategory).toBe(scenario.macroCategory);
      expect(payload.features).toEqual([...scenario.features]);
      expect(payload.planType).toBe(scenario.planType);
    });

  }

});
