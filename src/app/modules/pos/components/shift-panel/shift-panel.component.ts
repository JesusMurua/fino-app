import { Component, inject } from '@angular/core';
import { SidebarModule } from 'primeng/sidebar';
import { MessageService } from 'primeng/api';

import { CashRegisterService } from '../../../../core/services/cash-register.service';
import { ShiftManagementComponent } from '../../../../shared/components/shift-management/shift-management.component';

/**
 * POS-side wrapper around the shared `<app-shift-management>`.
 *
 * Renders the shift management UI inside a right-aligned PrimeNG sidebar
 * so the cashier can open / close shifts and register cash movements
 * without leaving the POS. Visibility is driven by `cashRegisterService.isPanelOpen`,
 * mirroring the `delivery-panel` pattern (`deliveryService.isOpen`) so
 * the toggle handler in `pos-header` can flip a single signal.
 */
@Component({
  selector: 'app-shift-panel',
  standalone: true,
  imports: [SidebarModule, ShiftManagementComponent],
  providers: [MessageService],
  templateUrl: './shift-panel.component.html',
  styleUrl: './shift-panel.component.scss',
})
export class ShiftPanelComponent {

  readonly cashRegisterService = inject(CashRegisterService);

}
