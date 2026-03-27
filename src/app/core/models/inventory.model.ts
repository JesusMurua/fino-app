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

/** A stock movement record (in, out, adjustment) */
export interface InventoryMovement {
  id: number;
  inventoryItemId: number;
  type: 'in' | 'out' | 'adjustment';
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
