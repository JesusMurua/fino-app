import { Pipe, PipeTransform } from '@angular/core';

import {
  CashMovementType,
  CashRegisterStatus,
  PaymentStatus,
  CASH_MOVEMENT_TYPE_LABELS,
  CASH_MOVEMENT_TYPE_CLASSES,
  CASH_REGISTER_STATUS_LABELS,
  CASH_REGISTER_STATUS_CLASSES,
  PAYMENT_STATUS_LABELS,
  PAYMENT_STATUS_CLASSES,
} from '../../core/enums';

type StatusDomain = 'payment' | 'cashRegister' | 'cashMovement';

const LABEL_MAPS: Record<StatusDomain, Record<number, string>> = {
  payment:      PAYMENT_STATUS_LABELS,
  cashRegister: CASH_REGISTER_STATUS_LABELS,
  cashMovement: CASH_MOVEMENT_TYPE_LABELS,
};

const CLASS_MAPS: Record<StatusDomain, Record<number, string>> = {
  payment:      PAYMENT_STATUS_CLASSES,
  cashRegister: CASH_REGISTER_STATUS_CLASSES,
  cashMovement: CASH_MOVEMENT_TYPE_CLASSES,
};

/**
 * Converts a numeric status/type ID to a human-readable label.
 * Usage: {{ session.cashRegisterStatusId | statusLabel:'cashRegister' }}  →  "Abierto"
 */
@Pipe({ name: 'statusLabel', standalone: true })
export class StatusLabelPipe implements PipeTransform {
  transform(id: number | null | undefined, domain: StatusDomain): string {
    if (id == null) return '';
    return LABEL_MAPS[domain]?.[id] ?? `ID ${id}`;
  }
}

/**
 * Converts a numeric status/type ID to a CSS badge class.
 * Usage: [class]="movement.cashMovementTypeId | statusClass:'cashMovement'"
 */
@Pipe({ name: 'statusClass', standalone: true })
export class StatusClassPipe implements PipeTransform {
  transform(id: number | null | undefined, domain: StatusDomain): string {
    if (id == null) return '';
    return CLASS_MAPS[domain]?.[id] ?? '';
  }
}
