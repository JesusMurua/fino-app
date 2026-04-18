import {
  BusinessTypeCatalog,
  DeviceModeCatalog,
  DisplayStatusCatalog,
  KitchenStatusCatalog,
  PaymentMethodCatalog,
  ZoneTypeCatalog,
} from './catalog.model';

/** Offline fallback — kitchen status catalog */
export const KITCHEN_STATUSES: KitchenStatusCatalog[] = [
  { id: 1, code: 'Pending',   name: 'En cocina',  color: '#F59E0B', sortOrder: 1 },
  { id: 2, code: 'Ready',     name: 'Listo',       color: '#10B981', sortOrder: 2 },
  { id: 3, code: 'Delivered', name: 'Entregado',   color: '#3B82F6', sortOrder: 3 },
];

/** Offline fallback — display status catalog (floor map) */
export const DISPLAY_STATUSES: DisplayStatusCatalog[] = [
  { id: 1, code: 'free',         name: 'Disponible',   color: '#6B7280', sortOrder: 1 },
  { id: 2, code: 'in_kitchen',   name: 'En cocina',    color: '#F59E0B', sortOrder: 2 },
  { id: 3, code: 'ready',        name: 'Listo',        color: '#10B981', sortOrder: 3 },
  { id: 4, code: 'waiting_bill', name: 'Pidió cuenta', color: '#3B82F6', sortOrder: 4 },
  { id: 5, code: 'paid',         name: 'Pagada',       color: '#6B7280', sortOrder: 5 },
  { id: 6, code: 'reserved',     name: 'Reservada',    color: '#8B5CF6', sortOrder: 6 },
];

/** Offline fallback — payment method catalog */
export const PAYMENT_METHODS: PaymentMethodCatalog[] = [
  { id: 1, code: 'Cash',     name: 'Efectivo',      sortOrder: 1 },
  { id: 2, code: 'Card',     name: 'Tarjeta',       sortOrder: 2 },
  { id: 3, code: 'Transfer', name: 'Transferencia', sortOrder: 3 },
  { id: 4, code: 'Other',    name: 'Otro',          sortOrder: 4 },
];

/** Offline fallback — device mode catalog */
export const DEVICE_MODES: DeviceModeCatalog[] = [
  { id: 1, code: 'cashier', name: 'Cajero',  description: 'POS estándar de cobro' },
  { id: 2, code: 'kiosk',   name: 'Kiosk',   description: 'Autoservicio para clientes' },
  { id: 3, code: 'tables',  name: 'Mesas',   description: 'Vista de mesas para meseros' },
  { id: 4, code: 'kitchen', name: 'Cocina',   description: 'Pantalla de cocina KDS' },
];

/**
 * Offline fallback — business type catalog with feature flags.
 * Mirrors the backend seed (commit 75eacdf) — the 20 sub-giros keyed to
 * 4 macro categories. `posExperience` and `hasKitchen` / `hasTables`
 * are client-side defaults used when the API has not yet responded.
 */
export const BUSINESS_TYPES: BusinessTypeCatalog[] = [
  // Macro 1 — Food & Beverage
  { id: 1,  code: 'Restaurante',    name: 'Restaurante',             hasKitchen: true,  hasTables: true,  posExperience: 'Restaurant', sortOrder: 1 },
  { id: 2,  code: 'BarCantina',     name: 'Bar / Cantina',           hasKitchen: true,  hasTables: true,  posExperience: 'Restaurant', sortOrder: 2 },
  { id: 3,  code: 'SportsBar',      name: 'Sports Bar / Wings',      hasKitchen: true,  hasTables: true,  posExperience: 'Restaurant', sortOrder: 3 },

  // Macro 2 — Quick Service
  { id: 4,  code: 'Taqueria',       name: 'Taquería',                hasKitchen: true,  hasTables: false, posExperience: 'Counter',    sortOrder: 4 },
  { id: 5,  code: 'Dogos',          name: 'Dogos',                   hasKitchen: true,  hasTables: false, posExperience: 'Counter',    sortOrder: 5 },
  { id: 6,  code: 'Hamburguesas',   name: 'Hamburguesas',            hasKitchen: true,  hasTables: false, posExperience: 'Counter',    sortOrder: 6 },
  { id: 7,  code: 'Cafeteria',      name: 'Cafetería',               hasKitchen: true,  hasTables: true,  posExperience: 'Counter',    sortOrder: 7 },
  { id: 8,  code: 'Paleteria',      name: 'Paletería / Nevería',     hasKitchen: false, hasTables: false, posExperience: 'Counter',    sortOrder: 8 },
  { id: 9,  code: 'Panaderia',      name: 'Panadería / Repostería',  hasKitchen: true,  hasTables: false, posExperience: 'Counter',    sortOrder: 9 },

  // Macro 3 — Retail
  { id: 10, code: 'Abarrotes',      name: 'Abarrotes / Miscelánea',  hasKitchen: false, hasTables: false, posExperience: 'Retail',     sortOrder: 10 },
  { id: 11, code: 'Expendio',       name: 'Expendio / Depósito',     hasKitchen: false, hasTables: false, posExperience: 'Retail',     sortOrder: 11 },
  { id: 12, code: 'Refaccionaria',  name: 'Refaccionaria',           hasKitchen: false, hasTables: false, posExperience: 'Retail',     sortOrder: 12 },
  { id: 13, code: 'Ferreteria',     name: 'Ferretería',              hasKitchen: false, hasTables: false, posExperience: 'Retail',     sortOrder: 13 },
  { id: 14, code: 'Papeleria',      name: 'Papelería',               hasKitchen: false, hasTables: false, posExperience: 'Retail',     sortOrder: 14 },
  { id: 15, code: 'Farmacia',       name: 'Farmacia',                hasKitchen: false, hasTables: false, posExperience: 'Retail',     sortOrder: 15 },
  { id: 16, code: 'Boutique',       name: 'Boutique / Ropa y Calzado', hasKitchen: false, hasTables: false, posExperience: 'Retail',    sortOrder: 16 },

  // Macro 4 — Specialized Services
  { id: 17, code: 'Estetica',       name: 'Estética / Barbería',     hasKitchen: false, hasTables: false, posExperience: 'Quick',      sortOrder: 17 },
  { id: 18, code: 'TallerMecanico', name: 'Taller Mecánico',         hasKitchen: false, hasTables: false, posExperience: 'Quick',      sortOrder: 18 },
  { id: 19, code: 'Consultorio',    name: 'Consultorio / Clínica',   hasKitchen: false, hasTables: false, posExperience: 'Quick',      sortOrder: 19 },
  { id: 20, code: 'Gimnasio',       name: 'Gimnasio / Deportes',     hasKitchen: false, hasTables: false, posExperience: 'Quick',      sortOrder: 20 },
];

/** Offline fallback — zone type catalog */
export const ZONE_TYPES: ZoneTypeCatalog[] = [
  { id: 1, code: 'Salon',    name: 'Salón', sortOrder: 1 },
  { id: 2, code: 'BarSeats', name: 'Barra', sortOrder: 2 },
  { id: 3, code: 'Other',    name: 'Otro',  sortOrder: 3 },
];
