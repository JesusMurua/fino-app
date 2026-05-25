import { type Page } from '@playwright/test';

/**
 * JWT + AuthUser fixture for Playwright E2E.
 *
 * AUDIT-058 Vector C (§3.2). Lets specs validate vertical-specific UI
 * rendering by seeding a synthetic JWT and AuthUser into localStorage
 * BEFORE any page script runs — bypasses `/api/auth/email-login` and
 * runs offline relative to the .NET backend.
 *
 * Pair with `seedDeviceConfig()` when the route under test requires
 * both a configured device AND an authenticated user.
 *
 * Drift strategy: this file intentionally duplicates the
 * `FeatureKey` string set + auth localStorage keys from `src/` (per
 * AUDIT-058 §3.2 mitigation). The smoke spec in
 * `e2e/tests/jwt-mock-smoke.spec.ts` doubles as drift detector — if
 * a renamed FeatureKey breaks tenant UI rendering, the smoke tests
 * go red on the next CI run.
 */

// ---------------------------------------------------------------------------
// Constants duplicated from src/ (intentionally — keeps E2E independent
// of the Angular tsconfig paths). Kept in sync manually.
// ---------------------------------------------------------------------------

/** Mirrors `AUTH_TOKEN_KEY` in `src/app/core/models/auth.model.ts`. */
const AUTH_TOKEN_KEY = 'pos_auth_token';

/** Mirrors `AUTH_USER_KEY` in `src/app/core/models/auth.model.ts`. */
const AUTH_USER_KEY = 'pos_auth_user';

/** Mirrors `ACTIVE_BRANCH_KEY` in `src/app/core/models/auth.model.ts`. */
const ACTIVE_BRANCH_KEY = 'pos_active_branch_id';

// ---------------------------------------------------------------------------
// Type-safe enumerations of backend claim values
// ---------------------------------------------------------------------------

/** Mirrors `MacroCategoryType` in `src/app/core/enums/config.enum.ts`. */
export type TestMacroCategory =
  | 'FoodBeverage'
  | 'QuickService'
  | 'Retail'
  | 'Services';

/** Mirrors `SubCategoryType` in `src/app/core/enums/config.enum.ts`. */
export type TestSubCategory = 'Generic' | 'Gym' | 'Yoga' | 'Crossfit';

/** Mirrors `PlanTypeId` numeric ids in `src/app/core/enums/config.enum.ts`. */
export const TEST_PLAN_TYPE = {
  Free:       1,
  Basic:      2,
  Pro:        3,
  Enterprise: 4,
} as const;

/** Mirrors `UserRoleId` numeric ids in `src/app/core/enums/config.enum.ts`. */
export const TEST_USER_ROLE = {
  Owner:   1,
  Manager: 2,
  Cashier: 3,
  Waiter:  4,
  Host:    5,
} as const;

/**
 * Mirror of every `FeatureKey` string value from
 * `src/app/core/enums/feature-key.enum.ts`. Kept manually in sync —
 * the smoke spec detects drift by exercising tenant scenarios.
 */
export const TEST_FEATURE_KEYS = {
  // Core
  CoreHardware:            'CoreHardware',
  CfdiInvoicing:           'CfdiInvoicing',
  UnlimitedProducts:       'UnlimitedProducts',

  // Food & Beverage
  PrintedTickets:          'PrintedTickets',
  RealtimeKds:             'RealtimeKds',
  TableMap:                'TableMap',
  WaiterApp:               'WaiterApp',
  MultiTill:               'MultiTill',
  MultiBranch:             'MultiBranch',
  PublicApi:               'PublicApi',
  RecipeInventory:         'RecipeInventory',
  DeliveryPlatforms:       'DeliveryPlatforms',

  // Quick Service
  LoyaltyCrm:              'LoyaltyCrm',

  // Retail
  CustomerCredit:          'CustomerCredit',
  MultiWarehouseInventory: 'MultiWarehouseInventory',
  ComparativeReports:      'ComparativeReports',
  StockAlerts:             'StockAlerts',

  // Specialized Services
  SimpleFolios:            'SimpleFolios',
  CustomerDatabase:        'CustomerDatabase',
  CustomFolios:            'CustomFolios',
  CustomerHistory:         'CustomerHistory',
  Reminders:               'Reminders',
  RealtimeAccessControl:   'RealtimeAccessControl',

  // Hardware quotas
  MaxCashRegisters:        'MaxCashRegisters',
  MaxKdsScreens:           'MaxKdsScreens',
  MaxKiosks:               'MaxKiosks',
  MaxReceptionsPerBranch:  'MaxReceptionsPerBranch',

  // Reporting
  AdvancedReports:         'AdvancedReports',

  // Payments
  ProviderPayments:        'ProviderPayments',
} as const;

/** Type-safe union of all feature key strings. */
export type TestFeatureKey = typeof TEST_FEATURE_KEYS[keyof typeof TEST_FEATURE_KEYS];

// ---------------------------------------------------------------------------
// Public input shape
// ---------------------------------------------------------------------------

/**
 * Claims accepted by `seedJwtClaims()`. Optional fields fall back to
 * safe defaults appropriate for most test scenarios (Pro plan,
 * Owner role, business 1 / branch 1, 1-hour token lifetime).
 */
export interface MockJwtClaims {
  /** Backend macro category claim — drives capability resolution. */
  macroCategory: TestMacroCategory;

  /** FeatureKey strings included in the synthetic JWT `features` claim. */
  features: readonly TestFeatureKey[];

  /** Plan tier numeric id. Defaults to `TEST_PLAN_TYPE.Pro` (3). */
  planType?: number;

  /** Optional vertical sub-category claim (gym / yoga / etc.). */
  subCategory?: TestSubCategory;

  /** Business id claim. Defaults to 1. */
  businessId?: number;

  /** Branch id claim. Defaults to 1. */
  branchId?: number;

  /** User id claim. Defaults to 1. */
  userId?: number;

  /** User role id claim. Defaults to `TEST_USER_ROLE.Owner` (1). */
  roleId?: number;

  /** Token lifetime in seconds. Defaults to 3600 (1 hour). */
  expiresInSec?: number;
}

// ---------------------------------------------------------------------------
// Internal shape of the AuthUser persisted alongside the JWT
// Mirrors `AuthUser` in `src/app/core/models/auth.model.ts` exactly.
// Critical: `primaryMacroCategoryId` is a NUMERIC `MacroCategoryType` id
// (1=FoodBeverage, 2=QuickService, 3=Retail, 4=Services) — NOT the
// string variant used by the JWT `macroCategory` claim parser.
// ---------------------------------------------------------------------------

interface MockAuthUser {
  roleId:                 number;
  name:                   string;
  businessId:             number;
  branchId:               number;
  token:                  string;
  branches:               { id: number; name: string }[];
  currentBranchId:        number;
  planTypeId:             number;
  primaryMacroCategoryId: number;
  /** `3` = Completed. Required to satisfy `authGuard.isOnboardingComplete()`. */
  onboardingStatusId:     number;
  features:               readonly string[];
  sessionType:            'email' | 'pin';
}

/** Maps the string claim (used in JWT) to the numeric `MacroCategoryType` id. */
const MACRO_STRING_TO_ID: Record<TestMacroCategory, number> = {
  FoodBeverage: 1,
  QuickService: 2,
  Retail:       3,
  Services:     4,
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Seeds a synthetic JWT and AuthUser into localStorage before any page
 * script runs. On cold-boot, the Angular `AuthService` rehydrates from
 * these keys and hydrates `TenantContextService` with the synthetic
 * macro / features / plan / subCategory.
 *
 * Also seeds `pos_active_branch_id` so `BranchContextService` resolves
 * immediately without prompting a branch picker.
 *
 * If a route guard performs an outbound `/api/auth/me` request, the
 * caller can additionally set up `page.route()` to mock that endpoint
 * (the AUDIT-058 §3.2 deliverable allows extending the fixture if a
 * guard requires it).
 *
 * @param page Playwright page instance.
 * @param claims Tenant context to inject (macro / features / plan / etc.).
 */
export async function seedJwtClaims(
  page: Page,
  claims: MockJwtClaims,
): Promise<void> {
  const token = buildSyntheticJwt(claims);
  const user  = buildMockAuthUser(claims, token);
  const branchId = claims.branchId ?? 1;

  await page.addInitScript(
    ({ tokenKey, userKey, branchKey, tokenVal, userVal, branchVal }: {
      tokenKey:  string;
      userKey:   string;
      branchKey: string;
      tokenVal:  string;
      userVal:   string;
      branchVal: string;
    }) => {
      window.localStorage.setItem(tokenKey,  tokenVal);
      window.localStorage.setItem(userKey,   userVal);
      window.localStorage.setItem(branchKey, branchVal);
    },
    {
      tokenKey:  AUTH_TOKEN_KEY,
      userKey:   AUTH_USER_KEY,
      branchKey: ACTIVE_BRANCH_KEY,
      tokenVal:  token,
      userVal:   JSON.stringify(user),
      branchVal: String(branchId),
    },
  );
}

/**
 * Intercepts every `/api/Auth/me` (or analogue) request and returns a
 * minimal AuthUser-shaped JSON so route guards that re-hydrate from the
 * backend pass without a real .NET server online.
 *
 * Call AFTER `seedJwtClaims()` and BEFORE `page.goto()`. Idempotent:
 * Playwright tolerates duplicate route handlers, the last wins.
 *
 * @param page Playwright page instance.
 * @param claims Same claims passed to `seedJwtClaims()` — keeps the
 *               mocked endpoint in sync with localStorage.
 */
export async function mockAuthMeEndpoint(
  page: Page,
  claims: MockJwtClaims,
): Promise<void> {
  const user = buildMockAuthUser(claims, buildSyntheticJwt(claims));
  await page.route('**/api/auth/me', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(user),
    }),
  );
}

// ---------------------------------------------------------------------------
// Internal builders
// ---------------------------------------------------------------------------

/**
 * Builds an unsigned JWT (header.payload.signature shape) with the
 * claims the frontend parsers read. The "signature" segment is a fixed
 * placeholder — `jwt.utils.ts` on the client never verifies it.
 */
function buildSyntheticJwt(claims: MockJwtClaims): string {
  const expSec = Math.floor(Date.now() / 1000) + (claims.expiresInSec ?? 3600);

  const header  = { alg: 'HS256', typ: 'JWT' };
  const payload: Record<string, unknown> = {
    nameid:        String(claims.userId   ?? 1),
    role:          String(claims.roleId   ?? TEST_USER_ROLE.Owner),
    branchId:      String(claims.branchId ?? 1),
    businessId:    String(claims.businessId ?? 1),
    macroCategory: claims.macroCategory,
    planType:      claims.planType ?? TEST_PLAN_TYPE.Pro,
    features:      [...claims.features],
    exp:           expSec,
  };

  if (claims.subCategory) {
    payload['subCategory'] = claims.subCategory;
  }

  const b64url = (obj: object): string => {
    const json = JSON.stringify(obj);
    // btoa is available in Playwright's Node 18+ runtime.
    return btoa(json)
      .replace(/=+$/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
  };

  return `${b64url(header)}.${b64url(payload)}.e2e-mock-signature`;
}

/**
 * Builds the AuthUser persisted under `pos_auth_user`.
 *
 * Critical: `AuthService.loadUserFromStorage()` returns null AND wipes
 * the auth storage when `primaryMacroCategoryId` is missing — so this
 * field MUST be set (as the numeric `MacroCategoryType` id, not the
 * JWT string variant). The mapping happens via `MACRO_STRING_TO_ID`.
 *
 * `planTypeId`, `currentBranchId`, `features` are also load-bearing for
 * downstream signals in `AuthService`.
 */
function buildMockAuthUser(claims: MockJwtClaims, token: string): MockAuthUser {
  const branchId = claims.branchId ?? 1;
  return {
    roleId:                 claims.roleId ?? TEST_USER_ROLE.Owner,
    name:                   'E2E Test User',
    businessId:             claims.businessId ?? 1,
    branchId,
    token,
    branches:               [{ id: branchId, name: 'E2E Branch' }],
    currentBranchId:        branchId,
    planTypeId:             claims.planType ?? TEST_PLAN_TYPE.Pro,
    primaryMacroCategoryId: MACRO_STRING_TO_ID[claims.macroCategory],
    onboardingStatusId:     3, // 3 = Completed — satisfies `authGuard.isOnboardingComplete()`
    features:               [...claims.features],
    sessionType:            'email',
  };
}
