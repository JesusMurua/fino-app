import { Component, signal } from '@angular/core';
import { TabViewModule } from 'primeng/tabview';

import { CashRegisterComponent } from '../cash-register/cash-register.component';
import { AdminRegistersComponent } from '../admin-registers/admin-registers.component';
import { OrphanedOrdersComponent } from '../orphaned-orders/orphaned-orders.component';

/**
 * Unified container for cash register management.
 * Tab 1: Turnos y Sesiones (financial — open/close shifts, movements)
 * Tab 2: Cajas Físicas (CashRegister CRUD + device linking)
 * Tab 3: Ventas Huérfanas
 */
@Component({
  selector: 'app-cajas-container',
  standalone: true,
  imports: [
    TabViewModule,
    CashRegisterComponent,
    AdminRegistersComponent,
    OrphanedOrdersComponent,
  ],
  templateUrl: './cajas-container.component.html',
  styleUrl: './cajas-container.component.scss',
})
export class CajasContainerComponent {

  //#region Properties

  /** Active tab index — 0: Turnos, 1: Cajas Físicas, 2: Huérfanas */
  readonly activeIndex = signal(0);

  //#endregion

}
