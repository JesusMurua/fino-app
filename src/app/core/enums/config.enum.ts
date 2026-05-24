/**
 * User role — maps to RoleCatalog in backend (post-BDD-018).
 *
 * Aligned with the cleaned-up backend catalog (FDD-023):
 *   - `Admin` was removed (legacy, never used in production; Owner / Manager cover it).
 *   - `Kitchen` and `Kiosk` were removed from the human role catalog.
 *     They were misclassified — Kitchen Display screens and self-service
 *     kiosks are unattended **device modes**, not human-authenticated
 *     roles. They continue to live in `DeviceConfig['mode']` for the
 *     hardware routing layer.
 *
 * IDs are 1-based and contiguous; do not insert new entries without
 * a coordinated backend migration (see BDD-018 + FDD-023 for the
 * shift contract).
 */
export enum UserRoleId {
  Owner = 1,
  Manager = 2,
  Cashier = 3,
  Waiter = 4,
  Host = 5,
}

/**
 * Roles that belong exclusively to the cloud Back Office. These users
 * log in from any browser (laptop, phone) and should never be forced
 * through device-setup / cash-register flows when navigating to
 * `/admin` — they only need hardware gating when they try to sell.
 */
export const BACK_OFFICE_ROLES: readonly UserRoleId[] = [
  UserRoleId.Owner,
  UserRoleId.Manager,
];

/** Returns true when the given role is a Back Office role (Owner/Manager) */
export function isBackOfficeRole(roleId: UserRoleId | null | undefined): boolean {
  return roleId != null && BACK_OFFICE_ROLES.includes(roleId);
}

/** Subscription plan tier — maps to PlanTypeCatalog in backend */
export enum PlanTypeId {
  Free = 1,
  Basic = 2,
  Pro = 3,
  Enterprise = 4,
}

/**
 * Macro business category — top of the hierarchy. The JWT carries
 * `primaryMacroCategoryId` and the tenant context is keyed by this enum.
 *
 * IDs match the backend `MacroCategory` catalog. There are exactly 4
 * values and they drive feature gating, pricing, and POS experience.
 */
export enum MacroCategoryType {
  FoodBeverage = 1,
  QuickService = 2,
  Retail       = 3,
  Services     = 4,
}

/**
 * Sub-giro — the user's specific vertical inside a macro category.
 * IDs match the backend `BusinessTypeCatalog` seed emitted by
 * commit 75eacdf (sequential 1-20 across 4 macro groups).
 *
 * Sub-giros are stored as an N:M relation (`BusinessGiro` table) and
 * are NOT carried on the JWT — the onboarding wizard persists them via
 * `PUT /business/giro` and consumers that need them must fetch a
 * dedicated endpoint.
 */
export enum BusinessTypeId {
  // Macro 1 — Food & Beverage
  Restaurante    = 1,
  BarCantina     = 2,
  SportsBar      = 3,

  // Macro 2 — Quick Service
  Taqueria       = 4,
  Dogos          = 5,
  Hamburguesas   = 6,
  Cafeteria      = 7,
  Paleteria      = 8,
  Panaderia      = 9,

  // Macro 3 — Retail
  Abarrotes      = 10,
  Expendio       = 11,
  Refaccionaria  = 12,
  Ferreteria     = 13,
  Papeleria      = 14,
  Farmacia       = 15,
  Boutique       = 16,

  // Macro 4 — Specialized Services
  Estetica       = 17,
  TallerMecanico = 18,
  Consultorio    = 19,
  Gimnasio       = 20,
}

// Note: `macroOfBusinessType(id)` ID-range helper deleted in FDD-028
// F4 (closes AUDIT-058 §1.2 Critical). Backend now ships
// `BusinessTypeDto.primaryMacroCategoryId` as an explicit FK; resolve
// the macro via `catalogService.resolveMacro(businessTypeId)` which
// joins against the cached `/catalog/macro-categories` response.

/**
 * Vertical sub-category — secondary axis of tenant context, layered on
 * top of `MacroCategoryType`. Drives UI verticalization (POS layout
 * variants, cart slots, member selectors) without changing feature
 * gating, which remains keyed by the macro.
 *
 * `Generic` is the catch-all when the tenant's sub-giros do not map to
 * any known specialization. Backend may emit this on the JWT in a
 * future release; until then `TenantContextService` derives it from
 * the sub-giro selection persisted via `PUT /business/giro`.
 */
export enum SubCategoryType {
  Generic  = 'Generic',
  Gym      = 'Gym',
  Yoga     = 'Yoga',
  Crossfit = 'Crossfit',
}

/**
 * Maps a sub-giro id to its vertical sub-category. Returns `Generic`
 * for sub-giros that do not have a dedicated vertical UI yet.
 *
 * Update this map as new vertical specializations land (e.g. when
 * Yoga / Crossfit get their own `BusinessTypeId` values).
 */
export function subCategoryOfBusinessType(id: BusinessTypeId): SubCategoryType {
  if (id === BusinessTypeId.Gimnasio) return SubCategoryType.Gym;
  return SubCategoryType.Generic;
}

/**
 * Picks the most specific sub-category from a set of selected sub-giros.
 * If any sub-giro maps to a non-Generic vertical, that wins; otherwise
 * the result is `Generic`. Used to hydrate `currentSubCategory` from a
 * `BusinessGiroResponse`.
 */
export function deriveSubCategory(ids: readonly BusinessTypeId[]): SubCategoryType {
  for (const id of ids) {
    const sub = subCategoryOfBusinessType(id);
    if (sub !== SubCategoryType.Generic) return sub;
  }
  return SubCategoryType.Generic;
}

/** Promotion type — maps to PromotionTypeCatalog in backend */
export enum PromotionTypeId {
  Percentage = 1,
  Fixed = 2,
  Bogo = 3,
  Bundle = 4,
  OrderDiscount = 5,
  FreeProduct = 6,
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

export const USER_ROLE_LABELS: Record<UserRoleId, string> = {
  [UserRoleId.Owner]:   'Dueño',
  [UserRoleId.Manager]: 'Gerente',
  [UserRoleId.Cashier]: 'Cajero',
  [UserRoleId.Waiter]:  'Mesero',
  [UserRoleId.Host]:    'Host',
};

export const PLAN_TYPE_LABELS: Record<PlanTypeId, string> = {
  [PlanTypeId.Free]:       'Gratuito',
  [PlanTypeId.Basic]:      'Básico',
  [PlanTypeId.Pro]:        'Pro',
  [PlanTypeId.Enterprise]: 'Enterprise',
};

export const MACRO_CATEGORY_LABELS: Record<MacroCategoryType, string> = {
  [MacroCategoryType.FoodBeverage]: 'Restaurantes y Bares',
  [MacroCategoryType.QuickService]: 'Comida Rápida y Cafés',
  [MacroCategoryType.Retail]:       'Tiendas y Comercios',
  [MacroCategoryType.Services]:     'Servicios Especializados',
};

export const BUSINESS_TYPE_LABELS: Record<BusinessTypeId, string> = {
  // Macro 1 — Food & Beverage
  [BusinessTypeId.Restaurante]:    'Restaurante',
  [BusinessTypeId.BarCantina]:     'Bar / Cantina',
  [BusinessTypeId.SportsBar]:      'Sports Bar / Wings',

  // Macro 2 — Quick Service
  [BusinessTypeId.Taqueria]:       'Taquería',
  [BusinessTypeId.Dogos]:          'Dogos',
  [BusinessTypeId.Hamburguesas]:   'Hamburguesas',
  [BusinessTypeId.Cafeteria]:      'Cafetería',
  [BusinessTypeId.Paleteria]:      'Paletería / Nevería',
  [BusinessTypeId.Panaderia]:      'Panadería / Repostería',

  // Macro 3 — Retail
  [BusinessTypeId.Abarrotes]:      'Abarrotes / Miscelánea',
  [BusinessTypeId.Expendio]:       'Expendio / Depósito',
  [BusinessTypeId.Refaccionaria]:  'Refaccionaria / Autopartes',
  [BusinessTypeId.Ferreteria]:     'Ferretería',
  [BusinessTypeId.Papeleria]:      'Papelería',
  [BusinessTypeId.Farmacia]:       'Farmacia',
  [BusinessTypeId.Boutique]:       'Boutique / Ropa y Calzado',

  // Macro 4 — Specialized Services
  [BusinessTypeId.Estetica]:       'Estética / Barbería',
  [BusinessTypeId.TallerMecanico]: 'Taller Mecánico',
  [BusinessTypeId.Consultorio]:    'Consultorio / Clínica',
  [BusinessTypeId.Gimnasio]:       'Gimnasio / Deportes',
};

export const PROMOTION_TYPE_LABELS: Record<PromotionTypeId, string> = {
  [PromotionTypeId.Percentage]:    'Porcentaje',
  [PromotionTypeId.Fixed]:         'Monto fijo',
  [PromotionTypeId.Bogo]:          '2×1',
  [PromotionTypeId.Bundle]:        'Bundle',
  [PromotionTypeId.OrderDiscount]: 'Desc. de orden',
  [PromotionTypeId.FreeProduct]:   'Producto gratis',
};
