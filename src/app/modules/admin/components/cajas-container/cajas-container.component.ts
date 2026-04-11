import { Component, computed, inject, signal } from '@angular/core';
import { TabViewModule } from 'primeng/tabview';
import { TooltipModule } from 'primeng/tooltip';

import { FeatureKey } from '../../../../core/enums';
import { TenantContextService } from '../../../../core/services/tenant-context.service';
import { CashRegisterComponent } from '../cash-register/cash-register.component';
import { AdminRegistersComponent } from '../admin-registers/admin-registers.component';

/**
 * Unified container for cash register management.
 * Tab 1: Turnos y Sesiones (financial — open/close shifts, movements)
 * Tab 2: Equipos y Hardware (physical registers + device linking)
 */
@Component({
  selector: 'app-cajas-container',
  standalone: true,
  imports: [
    TabViewModule,
    TooltipModule,
    CashRegisterComponent,
    AdminRegistersComponent,
  ],
  templateUrl: './cajas-container.component.html',
  styleUrl: './cajas-container.component.scss',
})
export class CajasContainerComponent {

  //#region Injections

  private readonly tenantContext = inject(TenantContextService);

  //#endregion

  //#region Properties

  /** Active tab index — 0: Turnos, 1: Equipos */
  readonly activeIndex = signal(0);

  /**
   * True when the current plan locks the multi-device hardware tab.
   * The first device link is always allowed; the lock is a visual hint that
   * managing multiple devices/roles requires a plan tier with `MultiTill`.
   */
  readonly isHardwareLocked = computed(() =>
    !this.tenantContext.hasFeature(FeatureKey.MultiTill)
  );

  //#endregion

}
