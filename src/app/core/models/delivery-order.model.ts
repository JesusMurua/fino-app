import { DeliveryStatus, OrderSource } from '../enums';

/** A line item in a delivery order — flattened, no nested Product */
export interface DeliveryOrderItemDto {
  id: number;
  productName: string;
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
