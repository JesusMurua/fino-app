import { KitchenStatusId } from '../enums';

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
// BI Dashboard chart DTOs — returned by GET /api/report/charts
// ---------------------------------------------------------------------------

/** Single data point for the sales-over-time line chart */
export interface SalesPointDto {
  date: string;        // YYYY-MM-DD
  totalCents: number;
  orderCount: number;
}

/** Product entry for the top-products bar chart */
export interface TopProductDto {
  productId: number;
  productName: string;
  quantity: number;
  revenueCents: number;
}

/** Single slice for the payment-methods doughnut chart */
export interface PaymentMethodSalesDto {
  method: string;      // Internal code (e.g. 'cash', 'card')
  label: string;       // Display label (e.g. 'Efectivo')
  orderCount: number;
  totalCents: number;
}

/** Aggregate BI chart response — all three datasets in one request */
export interface DashboardChartsDto {
  salesOverTime: SalesPointDto[];
  topProducts: TopProductDto[];       // Max 10
  paymentMethods: PaymentMethodSalesDto[];
}

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
  kitchenStatusId: KitchenStatusId;
  cancelledAt: string | null;
  cancellationReason: string | null;
  createdAt: string;
  payments: { method: string; amountCents: number }[];
}

/** Table occupancy snapshot for restaurant/counter experiences */
export interface DashboardTableStatus {
  occupancyPercent: number;
  activeOrders: number;
}

/** Low-stock product alert for retail experience */
export interface DashboardLowStockItem {
  name: string;
  currentStock: number;
}

/** Full dashboard summary from GET /api/dashboard/summary */
export interface DashboardSummary {
  date: string;
  sales: DashboardSales;
  orders: DashboardCancellations;
  topProducts: DashboardTopProduct[];
  recentOrders: DashboardOrderRow[];
  tables?: DashboardTableStatus;
  lowStockItems?: DashboardLowStockItem[];
}
