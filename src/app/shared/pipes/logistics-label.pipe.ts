import { Pipe, PipeTransform } from '@angular/core';

import {
  InventoryMovementType,
  KitchenStatusId,
  SyncStatusId,
  TableStatus,
  INVENTORY_MOVEMENT_TYPE_LABELS,
  INVENTORY_MOVEMENT_TYPE_CLASSES,
  TABLE_STATUS_LABELS,
  TABLE_STATUS_CLASSES,
  KITCHEN_STATUS_LABELS,
  KITCHEN_STATUS_CLASSES,
  SYNC_STATUS_LABELS,
} from '../../core/enums';

type LogisticsDomain = 'inventoryMovement' | 'table' | 'kitchen' | 'sync';

const LABEL_MAPS: Record<LogisticsDomain, Record<number, string>> = {
  inventoryMovement: INVENTORY_MOVEMENT_TYPE_LABELS,
  table:             TABLE_STATUS_LABELS,
  kitchen:           KITCHEN_STATUS_LABELS,
  sync:              SYNC_STATUS_LABELS,
};

const CLASS_MAPS: Record<LogisticsDomain, Record<number, string>> = {
  inventoryMovement: INVENTORY_MOVEMENT_TYPE_CLASSES,
  table:             TABLE_STATUS_CLASSES,
  kitchen:           KITCHEN_STATUS_CLASSES,
  sync:              {}, // sync statuses don't have badge classes
};

/**
 * Converts a numeric logistics status ID to a human-readable label.
 * Usage: {{ order.kitchenStatusId | logisticsLabel:'kitchen' }}  →  "En cocina"
 */
@Pipe({ name: 'logisticsLabel', standalone: true })
export class LogisticsLabelPipe implements PipeTransform {
  transform(id: number | null | undefined, domain: LogisticsDomain): string {
    if (id == null) return '';
    return LABEL_MAPS[domain]?.[id] ?? `ID ${id}`;
  }
}

/**
 * Converts a numeric logistics status ID to a CSS badge class.
 * Usage: [ngClass]="table.tableStatusId | logisticsClass:'table'"
 */
@Pipe({ name: 'logisticsClass', standalone: true })
export class LogisticsClassPipe implements PipeTransform {
  transform(id: number | null | undefined, domain: LogisticsDomain): string {
    if (id == null) return '';
    return CLASS_MAPS[domain]?.[id] ?? '';
  }
}
