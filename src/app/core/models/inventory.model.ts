/** A stockable item tracked in inventory */
export interface InventoryItem {
  id: number;
  branchId: number;
  name: string;
  unit: 'pza' | 'kg' | 'lt' | 'caja' | 'g' | 'ml';
  currentStock: number;
  lowStockThreshold: number;
  costCents: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

import { InventoryMovementType } from '../enums';

/** A stock movement record (in, out, adjustment) */
export interface InventoryMovement {
  id: number;
  inventoryItemId: number;
  /** 1=In, 2=Out, 3=Adjustment */
  inventoryMovementTypeId: InventoryMovementType;
  quantity: number;
  reason?: string;
  orderId?: string;
  createdAt: string;
}

/** Links a product to inventory items it consumes per sale */
export interface ProductConsumption {
  id: number;
  productId: number;
  inventoryItemId: number;
  quantityPerSale: number;
  inventoryItem?: InventoryItem;
}

// ---------------------------------------------------------------------------
// Ledger
// ---------------------------------------------------------------------------

/** Transaction type enum returned by the backend as an integer */
export type LedgerTransactionType = 0 | 1 | 2;

/** A single row in the global inventory ledger — maps to backend InventoryLedgerDto */
export interface InventoryLedgerDto {
  id: number;
  createdAt: string;
  itemName: string;
  transactionType: LedgerTransactionType;
  quantity: number;
  stockAfterTransaction: number;
  reason: string | null;
  createdBy: string | null;
  orderId: string | null;
}

// `PageData<T>` was extracted to `api.model.ts` (FDD-027 §3.3) so any
// feature can consume the generic pagination wrapper without crossing
// the inventory domain boundary.
