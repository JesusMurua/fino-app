/** User role — maps to RoleCatalog in backend */
export enum UserRoleId {
  Owner = 1,
  Admin = 2,
  Manager = 3,
  Cashier = 4,
  Waiter = 5,
  Kitchen = 6,
  Host = 7,
  Kiosk = 8,
}

/** Subscription plan tier — maps to PlanTypeCatalog in backend */
export enum PlanTypeId {
  Free = 1,
  Basic = 2,
  Pro = 3,
  Enterprise = 4,
}

/** Business vertical — maps to BusinessTypeCatalog in backend */
export enum BusinessTypeId {
  Restaurant = 1,
  Retail = 2,
  Cafe = 3,
  Bar = 4,
  FoodTruck = 5,
  General = 6,
  Taqueria = 7,
  Abarrotes = 8,
  Ferreteria = 9,
  Papeleria = 10,
  Farmacia = 11,
  Servicios = 12,
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
  [UserRoleId.Admin]:   'Admin',
  [UserRoleId.Manager]: 'Gerente',
  [UserRoleId.Cashier]: 'Cajero',
  [UserRoleId.Waiter]:  'Mesero',
  [UserRoleId.Kitchen]: 'Cocina',
  [UserRoleId.Host]:    'Host',
  [UserRoleId.Kiosk]:   'Kiosko',
};

export const PLAN_TYPE_LABELS: Record<PlanTypeId, string> = {
  [PlanTypeId.Free]:       'Gratuito',
  [PlanTypeId.Basic]:      'Básico',
  [PlanTypeId.Pro]:        'Pro',
  [PlanTypeId.Enterprise]: 'Enterprise',
};

export const BUSINESS_TYPE_LABELS: Record<BusinessTypeId, string> = {
  [BusinessTypeId.Restaurant]: 'Restaurante',
  [BusinessTypeId.Retail]:     'Abarrotes / Tienda',
  [BusinessTypeId.Cafe]:       'Café',
  [BusinessTypeId.Bar]:        'Bar',
  [BusinessTypeId.FoodTruck]:  'Food Truck',
  [BusinessTypeId.General]:    'General',
  [BusinessTypeId.Taqueria]:   'Taquería',
  [BusinessTypeId.Abarrotes]:  'Abarrotes',
  [BusinessTypeId.Ferreteria]: 'Ferretería',
  [BusinessTypeId.Papeleria]:  'Papelería',
  [BusinessTypeId.Farmacia]:   'Farmacia',
  [BusinessTypeId.Servicios]:  'Servicios',
};

export const PROMOTION_TYPE_LABELS: Record<PromotionTypeId, string> = {
  [PromotionTypeId.Percentage]:    'Porcentaje',
  [PromotionTypeId.Fixed]:         'Monto fijo',
  [PromotionTypeId.Bogo]:          '2×1',
  [PromotionTypeId.Bundle]:        'Bundle',
  [PromotionTypeId.OrderDiscount]: 'Desc. de orden',
  [PromotionTypeId.FreeProduct]:   'Producto gratis',
};
