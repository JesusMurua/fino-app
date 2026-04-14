import { Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe, NgClass } from '@angular/common';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { MessageService } from 'primeng/api';
import { ToastModule } from 'primeng/toast';

import { OrphanedOrderDto } from '../../../../core/models';
import { AuthService } from '../../../../core/services/auth.service';
import { OrdersService } from '../../../../core/services/orders.service';
import { PricePipe } from '../../../../shared/pipes/price.pipe';

/**
 * Lists orders without a cash register session for the active branch and
 * exposes a per-row action that will (in a later phase) open the
 * reconciliation modal. For now the action only logs the row.
 */
@Component({
  selector: 'app-orphaned-orders',
  standalone: true,
  imports: [DatePipe, NgClass, TableModule, ButtonModule, ToastModule, PricePipe],
  providers: [MessageService],
  templateUrl: './orphaned-orders.component.html',
  styleUrl: './orphaned-orders.component.scss',
})
export class OrphanedOrdersComponent implements OnInit {

  //#region Injections

  private readonly authService = inject(AuthService);
  private readonly ordersService = inject(OrdersService);
  private readonly messageService = inject(MessageService);

  //#endregion

  //#region Properties

  readonly orders = signal<OrphanedOrderDto[]>([]);
  readonly isLoading = signal(false);

  //#endregion

  //#region Lifecycle

  async ngOnInit(): Promise<void> {
    await this.loadOrphanedOrders();
  }

  //#endregion

  //#region Methods

  /** Loads the orphaned-orders list for the currently active branch. */
  async loadOrphanedOrders(): Promise<void> {
    const branchId = this.authService.activeBranchId();
    if (branchId == null) return;

    this.isLoading.set(true);
    this.ordersService.getOrphanedOrders(branchId).subscribe({
      next: (data) => {
        this.orders.set(data);
        this.isLoading.set(false);
      },
      error: (err) => {
        console.error('[OrphanedOrders] Failed to load:', err);
        this.isLoading.set(false);
        this.messageService.add({
          severity: 'error',
          summary: 'Error',
          detail: 'No se pudieron cargar las órdenes huérfanas',
          life: 4000,
        });
      },
    });
  }

  /** Stub — opens the reconciliation modal in a later phase. */
  onReconcileClick(order: OrphanedOrderDto): void {
    console.log(order);
  }

  //#endregion

}
