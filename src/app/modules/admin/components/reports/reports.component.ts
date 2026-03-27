import { Component, OnInit, computed, effect, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';

import { CalendarModule } from 'primeng/calendar';
import { ChartModule } from 'primeng/chart';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { TableModule } from 'primeng/table';
import { TabViewModule } from 'primeng/tabview';
import { ToastModule } from 'primeng/toast';
import { MessageService } from 'primeng/api';

import { ReportPeriod, ReportSummary } from '../../../../core/models';
import { ReportService } from '../../../../core/services/report.service';
import { AuthService } from '../../../../core/services/auth.service';
import { PricePipe } from '../../../../shared/pipes/price.pipe';

@Component({
  selector: 'app-reports',
  standalone: true,
  imports: [
    FormsModule,
    DatePipe,
    CalendarModule,
    ChartModule,
    ProgressSpinnerModule,
    TableModule,
    TabViewModule,
    ToastModule,
    PricePipe,
  ],
  providers: [MessageService],
  templateUrl: './reports.component.html',
  styleUrl: './reports.component.scss',
})
export class ReportsComponent implements OnInit {

  //#region Properties

  readonly summary = signal<ReportSummary | null>(null);
  readonly loading = signal(false);
  readonly loadingExcel = signal(false);
  readonly loadingPdf = signal(false);
  readonly selectedPeriod = signal<ReportPeriod>('today');
  readonly customFrom = signal<Date | null>(null);
  readonly customTo = signal<Date | null>(null);
  readonly activeTab = signal(0);

  /** Two-way binding targets for p-calendar */
  customFromDate: Date | null = null;
  customToDate: Date | null = null;

  /** Period button options */
  readonly periods: { key: ReportPeriod; label: string }[] = [
    { key: 'today', label: 'Hoy' },
    { key: 'week', label: 'Esta semana' },
    { key: 'month', label: 'Este mes' },
    { key: 'custom', label: 'Personalizado' },
  ];

  //#endregion

  //#region Computeds

  readonly dateRange = computed(() => {
    if (this.selectedPeriod() === 'custom') {
      return {
        from: this.customFrom() ?? new Date(),
        to: this.customTo() ?? new Date(),
      };
    }
    return this.reportService.getDateRange(this.selectedPeriod());
  });

  readonly hasData = computed(() =>
    this.summary() !== null && this.summary()!.totalOrders > 0,
  );

  readonly chartData = computed(() => {
    const s = this.summary();
    if (!s || s.dailySummaries.length <= 1) return null;

    const labels = s.dailySummaries.map(d => {
      const date = new Date(d.date);
      return `${date.getDate().toString().padStart(2, '0')}/${(date.getMonth() + 1).toString().padStart(2, '0')}`;
    });

    return {
      labels,
      datasets: [{
        label: 'Ventas',
        data: s.dailySummaries.map(d => d.totalCents / 100),
        backgroundColor: '#16A34A',
        borderColor: '#15803D',
      }],
    };
  });

  readonly chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: { y: { beginAtZero: true } },
  };

  //#endregion

  //#region Constructor
  constructor(
    private readonly reportService: ReportService,
    private readonly messageService: MessageService,
    private readonly authService: AuthService,
  ) {
    effect(() => {
      const branchId = this.authService.activeBranchId();
      if (branchId) this.loadReport();
    }, { allowSignalWrites: true });
  }
  //#endregion

  //#region Lifecycle

  async ngOnInit(): Promise<void> {
    await this.loadReport();
  }

  //#endregion

  //#region Actions

  /** Handles period button selection */
  selectPeriod(period: ReportPeriod): void {
    this.selectedPeriod.set(period);
    if (period !== 'custom') {
      this.loadReport();
    }
  }

  /** Updates custom date signals from calendar and triggers search */
  onCustomFromChange(date: Date | null): void {
    this.customFrom.set(date);
  }

  onCustomToChange(date: Date | null): void {
    this.customTo.set(date);
  }

  /** Loads report for current date range */
  async loadReport(): Promise<void> {
    if (this.selectedPeriod() === 'custom' && (!this.customFrom() || !this.customTo())) {
      return;
    }

    this.loading.set(true);
    this.summary.set(null);

    try {
      const { from, to } = this.dateRange();
      const result = await this.reportService.getSummary(this.authService.branchId, from, to);
      this.summary.set(result);
    } catch (error) {
      console.error('[ReportsComponent] Failed to load report:', error);
      this.messageService.add({
        severity: 'error',
        summary: 'Error',
        detail: 'No se pudo cargar el reporte',
      });
    } finally {
      this.loading.set(false);
    }
  }

  /** Downloads Excel report */
  async onDownloadExcel(): Promise<void> {
    this.loadingExcel.set(true);
    try {
      const { from, to } = this.dateRange();
      await this.reportService.downloadExcel(this.authService.branchId, from, to);
      this.messageService.add({
        severity: 'success',
        summary: 'Excel descargado',
      });
    } catch (error) {
      console.error('[ReportsComponent] Excel download failed:', error);
      this.messageService.add({
        severity: 'error',
        summary: 'Error',
        detail: 'No se pudo descargar el Excel',
      });
    } finally {
      this.loadingExcel.set(false);
    }
  }

  /** Downloads PDF report */
  async onDownloadPdf(): Promise<void> {
    this.loadingPdf.set(true);
    try {
      const { from, to } = this.dateRange();
      await this.reportService.downloadPdf(this.authService.branchId, from, to);
      this.messageService.add({
        severity: 'success',
        summary: 'PDF descargado',
      });
    } catch (error) {
      console.error('[ReportsComponent] PDF download failed:', error);
      this.messageService.add({
        severity: 'error',
        summary: 'Error',
        detail: 'No se pudo descargar el PDF',
      });
    } finally {
      this.loadingPdf.set(false);
    }
  }

  //#endregion

  //#region Helpers

  /** Formats a Date to HH:MM */
  formatTime(date: Date | string): string {
    return new Date(date).toLocaleTimeString('es-MX', {
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  //#endregion

}
