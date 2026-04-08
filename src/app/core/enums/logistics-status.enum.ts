/** Inventory movement type — maps to InventoryMovementTypeCatalog in backend */
export enum InventoryMovementType {
  In = 1,
  Out = 2,
  Adjustment = 3,
}

/** Restaurant table status — maps to TableStatusCatalog in backend */
export enum TableStatus {
  Available = 1,
  Occupied = 2,
  Reserved = 3,
  Maintenance = 4,
}

/** Kitchen display status — maps to KitchenStatusCatalog in backend */
export enum KitchenStatusId {
  Pending = 1,
  Ready = 2,
  Delivered = 3,
}

/** Order sync lifecycle — maps to SyncStatusCatalog in backend */
export enum SyncStatusId {
  Pending = 1,
  Synced = 2,
  Failed = 3,
  PermanentlyFailed = 4,
}

// ---------------------------------------------------------------------------
// Display helpers — label and CSS class lookups for templates
// ---------------------------------------------------------------------------

export const INVENTORY_MOVEMENT_TYPE_LABELS: Record<InventoryMovementType, string> = {
  [InventoryMovementType.In]:         'Entrada',
  [InventoryMovementType.Out]:        'Salida',
  [InventoryMovementType.Adjustment]: 'Ajuste',
};

export const INVENTORY_MOVEMENT_TYPE_CLASSES: Record<InventoryMovementType, string> = {
  [InventoryMovementType.In]:         'movement-badge--in',
  [InventoryMovementType.Out]:        'movement-badge--out',
  [InventoryMovementType.Adjustment]: 'movement-badge--adj',
};

export const TABLE_STATUS_LABELS: Record<TableStatus, string> = {
  [TableStatus.Available]:   'Disponible',
  [TableStatus.Occupied]:    'Ocupada',
  [TableStatus.Reserved]:    'Reservada',
  [TableStatus.Maintenance]: 'Mantenimiento',
};

export const TABLE_STATUS_CLASSES: Record<TableStatus, string> = {
  [TableStatus.Available]:   'badge--available',
  [TableStatus.Occupied]:    'badge--occupied',
  [TableStatus.Reserved]:    'badge--reserved',
  [TableStatus.Maintenance]: 'badge--maintenance',
};

export const KITCHEN_STATUS_LABELS: Record<KitchenStatusId, string> = {
  [KitchenStatusId.Pending]:   'En cocina',
  [KitchenStatusId.Ready]:     'Listo',
  [KitchenStatusId.Delivered]: 'Entregado',
};

export const KITCHEN_STATUS_CLASSES: Record<KitchenStatusId, string> = {
  [KitchenStatusId.Pending]:   'badge--pending',
  [KitchenStatusId.Ready]:     'badge--ready',
  [KitchenStatusId.Delivered]: 'badge--delivered',
};

export const SYNC_STATUS_LABELS: Record<SyncStatusId, string> = {
  [SyncStatusId.Pending]:           'Pendiente',
  [SyncStatusId.Synced]:            'Sincronizado',
  [SyncStatusId.Failed]:            'Fallido',
  [SyncStatusId.PermanentlyFailed]: 'Error permanente',
};
