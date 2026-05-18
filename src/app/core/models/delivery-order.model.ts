import { DeliveryStatus, OrderSource } from '../enums';
import { ProductType } from './product.model';

/** A line item in a delivery order — flattened, no nested Product */
export interface DeliveryOrderItemDto {
  id: number;
  productName: string;
  /**
   * Frozen product classification (BE Phase 4.5). Lets the delivery card
   * render `kg` vs piece quantity without overfetching the full Product.
   */
  productType?: ProductType;
  /** SAT unit code (BE Phase 4.7+4.8) — drives unit suffix via `formatMeasureUnit`. */
  satUnitCode?: string;
  quantity: number;
  unitPriceCents: number;
  notes?: string;
  sizeName?: string;
}

/** A delivery order as returned by the delivery API endpoints */
export interface DeliveryOrderDto {
  id: string;
  orderNumber: number;
  orderSource: OrderSource;
  externalOrderId?: string;
  deliveryStatus: DeliveryStatus;
  deliveryCustomerName?: string;
  estimatedPickupAt?: string;
  totalCents: number;
  kitchenStatus: string;
  createdAt: string;
  items: DeliveryOrderItemDto[];
}
