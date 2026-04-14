/**
 * DTO returned by `GET /api/orders/orphaned?branchId={id}` — a lightweight
 * projection of an order that exists in the backend but is not tied to any
 * cash register session (e.g. orders created by kiosks or pulled before the
 * session-tracking feature was deployed).
 */
export interface OrphanedOrderDto {
  id: string;
  orderNumber: number;
  folioNumber?: string;
  createdAt: string;
  totalCents: number;
  isPaid: boolean;
  itemCount: number;
  paymentMethods: string[];
}

/**
 * Body for `PATCH /api/orders/{id}/reconcile` — assigns an orphaned order
 * to a cash register session with an optional audit note.
 */
export interface ReconcileOrderRequest {
  cashRegisterSessionId: number;
  note?: string;
}
