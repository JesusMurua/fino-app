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

/** Offline fallback — business type catalog with feature flags */
export const BUSINESS_TYPES: BusinessTypeCatalog[] = [
  { id: 1, code: 'Restaurant', name: 'Restaurante', hasKitchen: true,  hasTables: true,  sortOrder: 1 },
  { id: 2, code: 'Retail',     name: 'Abarrotes',   hasKitchen: false, hasTables: false, sortOrder: 2 },
  { id: 3, code: 'Cafe',       name: 'Café',         hasKitchen: true,  hasTables: true,  sortOrder: 3 },
  { id: 4, code: 'Bar',        name: 'Bar',           hasKitchen: true,  hasTables: true,  sortOrder: 4 },
  { id: 5, code: 'FoodTruck',  name: 'Food Truck',   hasKitchen: true,  hasTables: false, sortOrder: 5 },
  { id: 6, code: 'General',    name: 'General',       hasKitchen: false, hasTables: false, sortOrder: 6 },
];

/** Offline fallback — zone type catalog */
export const ZONE_TYPES: ZoneTypeCatalog[] = [
  { id: 1, code: 'Salon',    name: 'Salón', sortOrder: 1 },
  { id: 2, code: 'BarSeats', name: 'Barra', sortOrder: 2 },
  { id: 3, code: 'Other',    name: 'Otro',  sortOrder: 3 },
];
