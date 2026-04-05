/** A single line item within a stock receipt */
export interface StockReceiptItem {
  id: number;
  stockReceiptId: number;
  inventoryItemId?: number;
  productId?: number;
  inventoryItemName?: string;
  productName?: string;
  quantity: number;
  costCents: number;
  totalCents: number;
  notes?: string;
}

/** A stock receipt document recording goods received */
export interface StockReceipt {
  id: number;
  branchId: number;
  supplierId?: number;
  supplierName?: string;
  receivedByUserId: number;
  receivedByName?: string;
  receivedAt: string;
  notes?: string;
  totalCents: number;
  createdAt: string;
  items: StockReceiptItem[];
}

/** Request body for creating a new stock receipt */
export interface CreateStockReceiptRequest {
  supplierId?: number;
  notes?: string;
  items: CreateStockReceiptItemRequest[];
}

/** A single line item in a create stock receipt request */
export interface CreateStockReceiptItemRequest {
  inventoryItemId?: number;
  productId?: number;
  quantity: number;
  costCents: number;
  notes?: string;
}
