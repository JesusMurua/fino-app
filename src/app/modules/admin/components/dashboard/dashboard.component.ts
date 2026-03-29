import { Component, OnInit, computed, effect, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { DashboardSummary, DashboardOrderRow } from '../../../../core/models';
import { ApiService } from '../../../../core/services/api.service';
import { AuthService } from '../../../../core/services/auth.service';
import { CatalogService } from '../../../../core/services/catalog.service';
import { PricePipe } from '../../../../shared/pipes/price.pipe';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [PricePipe],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
})
export class DashboardComponent implements OnInit {

  //#region Properties

  private readonly api = inject(ApiService);
  private readonly authService = inject(AuthService);
  readonly catalogService = inject(CatalogService);

  readonly isLoading = signal(false);
  readonly isOffline = signal(false);
  readonly data = signal<DashboardSummary | null>(null);

  //#endregion

  //#region Computeds

  /** Recent orders filtered to only cancelled */
  readonly cancelledOrders = computed(() =>
    this.data()?.recentOrders.filter(o => o.cancelledAt) ?? [],
  );

  //#endregion

  //#region Constructor

  constructor() {
    effect(() => {
      const branchId = this.authService.activeBranchId();
      if (branchId) this.loadData();
    }, { allowSignalWrites: true });
  }

  //#endregion

  //#region Lifecycle

  async ngOnInit(): Promise<void> {
    await this.loadData();
  }

  //#endregion

  //#region Data Loading

  /** Loads dashboard summary from the API */
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

  //#endregion

  //#region Display Helpers

  /** Returns status badge label for a dashboard order row */
  getStatusLabel(order: DashboardOrderRow): string {
    if (order.cancelledAt) return 'Cancelada';
    if (order.kitchenStatus === 'Delivered') return 'Entregado';
    if (order.kitchenStatus === 'Ready') return 'Listo';
    if (order.kitchenStatus === 'Pending') return 'En cocina';
    return 'Nueva';
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

}
