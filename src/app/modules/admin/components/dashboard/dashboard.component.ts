import { DatePipe } from '@angular/common';
import { Component, OnInit, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { ButtonModule } from 'primeng/button';
import { CalendarModule } from 'primeng/calendar';
import { ChartModule } from 'primeng/chart';
import { MessageModule } from 'primeng/message';
import { SkeletonModule } from 'primeng/skeleton';

import { Customer, DashboardChartsDto, DashboardOrderRow, DashboardSummary } from '../../../../core/models';
import { FeatureKey, KitchenStatusId, SubCategoryType } from '../../../../core/enums';
import { ApiService } from '../../../../core/services/api.service';
import { AuthService } from '../../../../core/services/auth.service';
import { CatalogService } from '../../../../core/services/catalog.service';
import { ConfigService } from '../../../../core/services/config.service';
import { CustomerService } from '../../../../core/services/customer.service';
import { OnboardingChecklistService } from '../../../../core/services/onboarding-checklist.service';
import { ProductService } from '../../../../core/services/product.service';
import { ReportService } from '../../../../core/services/report.service';
import { TenantContextService } from '../../../../core/services/tenant-context.service';
import { PricePipe } from '../../../../shared/pipes/price.pipe';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    DatePipe,
    FormsModule,
    ButtonModule,
    CalendarModule,
    ChartModule,
    MessageModule,
    SkeletonModule,
    PricePipe,
    RouterLink,
  ],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
})
export class DashboardComponent implements OnInit {

  //#region Properties

  private readonly api            = inject(ApiService);
  private readonly authService    = inject(AuthService);
  private readonly reportService  = inject(ReportService);
  readonly catalogService         = inject(CatalogService);
  private readonly configService  = inject(ConfigService);
  private readonly tenantContext   = inject(TenantContextService);
  private readonly productService  = inject(ProductService);
  private readonly customerService = inject(CustomerService);
  readonly checklistService        = inject(OnboardingChecklistService);

  /** True when the tenant's plan includes advanced charts */
  readonly hasAdvancedReports = computed(() =>
    this.tenantContext.hasFeature(FeatureKey.AdvancedReports),
  );

  /** True when the tenant is on the Gym vertical (drives membership widget visibility) */
  readonly isGymTenant = computed(() =>
    this.tenantContext.currentSubCategory() === SubCategoryType.Gym,
  );

  /**
   * Members whose `membershipValidUntil` falls within ±7 days of now,
   * sorted ascending (most-recently expired → most-imminent), capped at
   * 10 rows so the dashboard widget stays scannable.
   *
   * Reactively derived from `customerService.customers()` — the offline
   * membership-extension hook in `SyncService` updates that signal in
   * place, so this list reflects the current Dexie state without a
   * dedicated re-fetch.
   */
  readonly expiringMemberships = computed<Customer[]>(() => {
    if (!this.isGymTenant()) return [];

    const now = Date.now();
    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

    return this.customerService.customers()
      .filter(c => {
        if (!c.membershipValidUntil) return false;
        const t = new Date(c.membershipValidUntil).getTime();
        return Math.abs(t - now) <= SEVEN_DAYS_MS;
      })
      .sort((a, b) =>
        new Date(a.membershipValidUntil!).getTime() -
        new Date(b.membershipValidUntil!).getTime(),
      )
      .slice(0, 10);
  });

  /** True when the customer's membership has already expired */
  isExpired(customer: Customer): boolean {
    if (!customer.membershipValidUntil) return false;
    return new Date(customer.membershipValidUntil).getTime() < Date.now();
  }

  //#region FTUE / theme

  /** First word of the authenticated owner's name — used in the FTUE greeting. */
  readonly greetingName = computed(() => {
    const name = this.authService.currentUser()?.name?.trim() ?? '';
    return name.split(/\s+/)[0] ?? '';
  });

  /**
   * True once the three state sources that drive the checklist have
   * finished their first hydration pass. Guards the FTUE block so it
   * never flashes "pending → done" on mount:
   *
   *   - `authService.currentUser()`   : session restored from storage
   *   - `tenantContext.currentMacro()`: giro hydrated from JWT
   *   - `productService.isLoading()`  : catalog fetch in flight
   *
   * The product check is `!isLoading` (not `products().length > 0`)
   * because a legitimate fresh account has zero products — we can't
   * distinguish "not loaded" from "truly empty" without waiting for
   * the loader to flip.
   */
  readonly isDataReady = computed(() => {
    if (this.authService.currentUser() === null) return false;
    if (this.tenantContext.currentMacro() === null) return false;
    if (this.productService.isLoading()) return false;
    return true;
  });

  dismissGuide(): void {
    this.checklistService.dismissChecklist();
  }

  /**
   * Re-exposes the FTUE block for a tenant who dismissed it but did not
   * actually finish the required steps. Bound to the "Ver guía de inicio"
   * button rendered on the legacy dashboard branch.
   */
  showGuideAgain(): void {
    this.checklistService.resetDismiss();
  }

  //#endregion

  /** Current POS experience — determines which dashboard sections are shown */
  readonly posExperience = this.configService.posExperience;

  /** Upper bound for the date range picker — prevents future selections */
  readonly today = new Date();

  //#endregion

  //#region Summary Signals

  readonly isLoading  = signal(false);
  readonly isOffline  = signal(false);
  readonly data       = signal<DashboardSummary | null>(null);

  //#endregion

  //#region Date Range Signals

  /**
   * Raw Date[] from p-calendar (selectionMode="range").
   * [0] = from date, [1] = to date.
   * Default: first day of current month → today.
   */
  readonly selectedDateRange = signal<Date[]>(this.getDefaultDateRange());

  /** Resolved from-date, always at midnight */
  readonly dateFrom = computed<Date>(() => {
    const d = new Date(this.selectedDateRange()[0] ?? this.getDefaultDateRange()[0]);
    d.setHours(0, 0, 0, 0);
    return d;
  });

  /** Resolved to-date, always at end of day */
  readonly dateTo = computed<Date>(() => {
    const raw = this.selectedDateRange()[1] ?? this.selectedDateRange()[0];
    const d = new Date(raw ?? new Date());
    d.setHours(23, 59, 59, 999);
    return d;
  });

  //#endregion

  //#region Chart Data Signals

  readonly isLoadingCharts  = signal(false);
  readonly chartError       = signal<string | null>(null);
  readonly isExportingCsv   = signal(false);

  /** Raw API response — single source of truth for all chart computeds */
  readonly chartData = signal<DashboardChartsDto | null>(null);

  //#endregion

  //#region Chart.js Dataset Computeds

  /** Dataset for the Line chart (sales over time). Cents → MXN in computed. */
  readonly salesLineData = computed<object>(() => {
    const points = this.chartData()?.salesOverTime ?? [];
    return {
      labels: points.map(p => this.formatChartLabel(p.date)),
      datasets: [{
        label: 'Ventas (MXN)',
        data: points.map(p => p.totalCents / 100),
        borderColor: '#16A34A',
        backgroundColor: 'rgba(22, 163, 74, 0.08)',
        fill: true,
        tension: 0.4,
        borderWidth: 2.5,
        pointRadius: 4,
        pointHoverRadius: 6,
        pointBackgroundColor: '#16A34A',
        pointBorderColor: '#ffffff',
        pointBorderWidth: 2,
      }],
    };
  });

  /** Dataset for the horizontal Bar chart (top products by revenue). */
  readonly topProductsData = computed<object>(() => {
    const items = this.chartData()?.topProducts ?? [];
    return {
      labels: items.map(p => p.productName),
      datasets: [{
        label: 'Ingresos (MXN)',
        data: items.map(p => p.revenueCents / 100),
        backgroundColor: '#16A34A',
        borderRadius: 6,
        borderSkipped: false,
      }],
    };
  });

  /** Dataset for the Doughnut chart (payment methods breakdown). */
  readonly paymentDoughnutData = computed<object>(() => {
    const slices = this.chartData()?.paymentMethods ?? [];
    return {
      labels: slices.map(s => s.label),
      datasets: [{
        data: slices.map(s => s.totalCents / 100),
        backgroundColor: ['#16A34A', '#D97706', '#2563EB', '#7C3AED', '#DC2626'],
        borderWidth: 3,
        borderColor: '#ffffff',
        hoverOffset: 8,
      }],
    };
  });

  //#endregion

  //#region Chart.js Options (static — do not need to be signals)

  readonly salesLineOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: '#111827',
        titleColor: '#F9FAFB',
        bodyColor: '#D1FAE5',
        padding: 12,
        cornerRadius: 8,
        callbacks: {
          label: (ctx: any) =>
            ` ${(ctx.parsed.y as number).toLocaleString('es-MX', {
              style: 'currency',
              currency: 'MXN',
            })}`,
        },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        border: { display: false },
        ticks: { color: '#9CA3AF', font: { size: 12 } },
      },
      y: {
        grid: { color: '#F1F5F9', lineWidth: 1 },
        border: { display: false },
        ticks: {
          color: '#9CA3AF',
          font: { size: 12 },
          callback: (v: any) =>
            `$${(v as number).toLocaleString('es-MX', { maximumFractionDigits: 0 })}`,
        },
        beginAtZero: true,
      },
    },
  };

  readonly topProductsOptions = {
    responsive: true,
    maintainAspectRatio: false,
    indexAxis: 'y' as const,
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: '#111827',
        titleColor: '#F9FAFB',
        bodyColor: '#D1FAE5',
        padding: 12,
        cornerRadius: 8,
        callbacks: {
          label: (ctx: any) =>
            ` ${(ctx.parsed.x as number).toLocaleString('es-MX', {
              style: 'currency',
              currency: 'MXN',
            })}`,
        },
      },
    },
    scales: {
      x: {
        grid: { color: '#F1F5F9', lineWidth: 1 },
        border: { display: false },
        ticks: {
          color: '#9CA3AF',
          font: { size: 12 },
          callback: (v: any) =>
            `$${(v as number).toLocaleString('es-MX', { maximumFractionDigits: 0 })}`,
        },
        beginAtZero: true,
      },
      y: {
        grid: { display: false },
        border: { display: false },
        ticks: { color: '#374151', font: { size: 13 } },
      },
    },
  };

  readonly paymentDoughnutOptions = {
    responsive: true,
    maintainAspectRatio: false,
    cutout: '72%',
    plugins: {
      legend: {
        position: 'bottom' as const,
        labels: {
          color: '#374151',
          font: { size: 13 },
          padding: 20,
          usePointStyle: true,
          pointStyleWidth: 10,
        },
      },
      tooltip: {
        backgroundColor: '#111827',
        titleColor: '#F9FAFB',
        bodyColor: '#D1FAE5',
        padding: 12,
        cornerRadius: 8,
        callbacks: {
          label: (ctx: any) => {
            const val = ctx.parsed as number;
            const total = (ctx.dataset.data as number[]).reduce((a: number, b: number) => a + b, 0);
            const pct = total > 0 ? ((val / total) * 100).toFixed(1) : '0';
            return ` ${val.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })} · ${pct}%`;
          },
        },
      },
    },
  };

  //#endregion

  //#region Computeds

  /** Recent orders filtered to only cancelled */
  readonly cancelledOrders = computed(() =>
    this.data()?.recentOrders.filter(o => o.cancelledAt) ?? [],
  );

  //#endregion

  //#region Constructor

  constructor() {
    // Reloads daily summary when active branch changes
    effect(() => {
      const branchId = this.authService.activeBranchId();
      if (branchId) this.loadData();
    }, { allowSignalWrites: true });

    // Reloads chart data when date range is fully selected or branch changes
    effect(() => {
      const range  = this.selectedDateRange();
      const branchId = this.authService.activeBranchId();
      if (branchId && range[0] && range[1]) this.loadChartData();
    }, { allowSignalWrites: true });
  }

  //#endregion

  //#region Lifecycle

  async ngOnInit(): Promise<void> {
    await this.loadData();

    // Gym vertical: hydrate the customer cache so the membership widget
    // has data on first paint. `loadCustomers` is stale-while-revalidate
    // and idempotent — safe to call even if Dexie is already populated.
    if (this.isGymTenant()) {
      await this.customerService.loadCustomers();
    }
  }

  //#endregion

  //#region Data Loading

  /** Loads today's dashboard summary from the API */
  async loadData(): Promise<void> {
    this.isLoading.set(true);
    this.isOffline.set(false);

    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const result = await firstValueFrom(
        this.api.get<DashboardSummary>(
          `/dashboard/summary?date=${today.toISOString()}`,
        ),
      );
      this.data.set(result);
    } catch {
      this.isOffline.set(true);
      this.data.set(null);
    } finally {
      this.isLoading.set(false);
    }
  }

  /** Loads BI chart datasets for the selected date range */
  async loadChartData(): Promise<void> {
    if (!this.hasAdvancedReports()) {
      this.chartData.set(null);
      return;
    }

    this.isLoadingCharts.set(true);
    this.chartError.set(null);

    try {
      const result = await this.reportService.getDashboardCharts(
        this.dateFrom(),
        this.dateTo(),
      );
      this.chartData.set(result);
    } catch {
      this.chartError.set('No se pudieron cargar las gráficas. Verifica tu conexión.');
      this.chartData.set(null);
    } finally {
      this.isLoadingCharts.set(false);
    }
  }

  //#endregion

  //#region Event Handlers

  /** Called by p-calendar (ngModelChange) — updates signal; effect triggers reload */
  onDateRangeChange(range: Date[] | null): void {
    this.selectedDateRange.set(range ?? []);
  }

  /** Exports simple sales detail CSV for the selected date range */
  async onExportDetailedCsv(): Promise<void> {
    this.isExportingCsv.set(true);
    try {
      await this.reportService.downloadDetailedCsv(this.dateFrom(), this.dateTo());
    } finally {
      this.isExportingCsv.set(false);
    }
  }

  //#endregion

  //#region Display Helpers

  /** Returns status badge label for a dashboard order row */
  getStatusLabel(order: DashboardOrderRow): string {
    if (order.cancelledAt) return 'Cancelada';
    switch (order.kitchenStatusId) {
      case KitchenStatusId.Delivered: return 'Entregado';
      case KitchenStatusId.Ready:    return 'Listo';
      case KitchenStatusId.Pending:  return 'En cocina';
      default:                       return 'Nueva';
    }
  }

  /** Returns payment method label for a dashboard order row */
  getPaymentLabel(order: DashboardOrderRow): string {
    if (!order.payments || order.payments.length === 0) return 'Sin cobrar';
    return order.payments
      .map(p => this.catalogService.getPaymentMethodName(p.method))
      .join(' + ');
  }

  /** Formats an ISO date string to HH:MM */
  formatTime(dateStr: string): string {
    return new Date(dateStr).toLocaleTimeString('es-MX', {
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  //#endregion

  //#region Private Helpers

  /** Returns [firstOfMonth, today] as the default date range */
  private getDefaultDateRange(): Date[] {
    const from = new Date();
    from.setDate(1);
    from.setHours(0, 0, 0, 0);
    const to = new Date();
    to.setHours(23, 59, 59, 999);
    return [from, to];
  }

  /** Formats an ISO date string to short locale label for chart X-axis */
  private formatChartLabel(dateStr: string): string {
    return new Date(dateStr).toLocaleDateString('es-MX', {
      month: 'short',
      day: 'numeric',
    });
  }

  //#endregion

}
