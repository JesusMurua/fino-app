/** Full report summary for a date range */
export interface ReportSummary {
  from: Date;
  to: Date;
  totalOrders: number;
  cancelledOrders: number;
  completedOrders: number;
  totalCents: number;
  cashCents: number;
  cardCents: number;
  discountCents: number;
  averageTicketCents: number;
  dailySummaries: DailySummary[];
  topProducts: TopProduct[];
  orders: OrderReportRow[];
}

/** Aggregated metrics for a single day */
export interface DailySummary {
  date: Date;
  orderCount: number;
  totalCents: number;
  cancelledCount: number;
}

/** Product ranking entry within a report */
export interface TopProduct {
  name: string;
  quantity: number;
  totalCents: number;
}

/** Flat order row for the report table */
export interface OrderReportRow {
  orderNumber: number;
  createdAt: Date;
  totalCents: number;
  discountCents?: number;
  paymentMethod: string;
  status: string;
  cancellationReason?: string;
  itemCount: number;
}

/** Predefined report period options */
export type ReportPeriod = 'today' | 'week' | 'month' | 'custom';

// ---------------------------------------------------------------------------
// Dashboard summary — returned by GET /api/dashboard/summary?date={ISO}
// ---------------------------------------------------------------------------

/** Sales KPIs for the dashboard */
export interface DashboardSales {
  totalCents: number;
  completedOrders: number;
  averageTicketCents: number;
  cashCents: number;
  cardCents: number;
  transferCents: number;
  otherCents: number;
  topPaymentMethod: string;
}

/** Cancellation KPIs for the dashboard */
export interface DashboardCancellations {
  cancelledCount: number;
  cancelledTotalCents: number;
  cancellationReasons: {
    reason: string;
    count: number;
    totalCents: number;
  }[];
}

/** Top product entry for the dashboard */
export interface DashboardTopProduct {
  name: string;
  quantity: number;
  totalCents: number;
}

/** Single order row in the dashboard recent orders table */
export interface DashboardOrderRow {
  orderNumber: number;
  itemCount: number;
  totalCents: number;
  kitchenStatus: string;
  cancelledAt: string | null;
  cancellationReason: string | null;
  createdAt: string;
  payments: { method: string; amountCents: number }[];
}

/** Full dashboard summary from GET /api/dashboard/summary */
export interface DashboardSummary {
  date: string;
  sales: DashboardSales;
  orders: DashboardCancellations;
  topProducts: DashboardTopProduct[];
  recentOrders: DashboardOrderRow[];
}
