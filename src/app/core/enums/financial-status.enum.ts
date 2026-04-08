/** Payment lifecycle status — maps to PaymentStatusCatalog in backend */
export enum PaymentStatus {
  Pending = 1,
  Completed = 2,
  Failed = 3,
  Refunded = 4,
}

/** Cash register session status — maps to CashRegisterStatusCatalog in backend */
export enum CashRegisterStatus {
  Open = 1,
  Closed = 2,
  Auditing = 3,
}

/** Cash movement type — maps to CashMovementTypeCatalog in backend */
export enum CashMovementType {
  In = 1,
  Out = 2,
  Adjustment = 3,
}

// ---------------------------------------------------------------------------
// Display helpers — label and CSS class lookups for templates
// ---------------------------------------------------------------------------

/** Human-readable labels for PaymentStatus */
export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  [PaymentStatus.Pending]:   'Pendiente',
  [PaymentStatus.Completed]: 'Completado',
  [PaymentStatus.Failed]:    'Fallido',
  [PaymentStatus.Refunded]:  'Reembolsado',
};

/** CSS badge classes for PaymentStatus */
export const PAYMENT_STATUS_CLASSES: Record<PaymentStatus, string> = {
  [PaymentStatus.Pending]:   'badge--pending',
  [PaymentStatus.Completed]: 'badge--completed',
  [PaymentStatus.Failed]:    'badge--failed',
  [PaymentStatus.Refunded]:  'badge--refunded',
};

/** Human-readable labels for CashRegisterStatus */
export const CASH_REGISTER_STATUS_LABELS: Record<CashRegisterStatus, string> = {
  [CashRegisterStatus.Open]:     'Abierto',
  [CashRegisterStatus.Closed]:   'Cerrado',
  [CashRegisterStatus.Auditing]: 'En auditoría',
};

/** CSS badge classes for CashRegisterStatus */
export const CASH_REGISTER_STATUS_CLASSES: Record<CashRegisterStatus, string> = {
  [CashRegisterStatus.Open]:     'badge--open',
  [CashRegisterStatus.Closed]:   'badge--closed',
  [CashRegisterStatus.Auditing]: 'badge--auditing',
};

/** Human-readable labels for CashMovementType */
export const CASH_MOVEMENT_TYPE_LABELS: Record<CashMovementType, string> = {
  [CashMovementType.In]:         'Retiro',
  [CashMovementType.Out]:        'Gasto',
  [CashMovementType.Adjustment]: 'Ajuste',
};

/** CSS badge classes for CashMovementType */
export const CASH_MOVEMENT_TYPE_CLASSES: Record<CashMovementType, string> = {
  [CashMovementType.In]:         'badge--withdrawal',
  [CashMovementType.Out]:        'badge--expense',
  [CashMovementType.Adjustment]: 'badge--adjustment',
};
