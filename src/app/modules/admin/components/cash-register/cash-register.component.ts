import { Component } from '@angular/core';

import { ShiftManagementComponent } from '../../../../shared/components/shift-management/shift-management.component';

/**
 * Admin "Caja" route — thin wrapper that hosts the shared
 * `<app-shift-management>` in admin mode (full-width page layout,
 * History button visible). All shift logic — open / close / movements
 * / blind count / drawer-pop / error mapping / remote-close detection —
 * lives in the shared component, ensuring perfect parity with the POS
 * sidebar consumer.
 */
@Component({
  selector: 'app-cash-register',
  standalone: true,
  imports: [ShiftManagementComponent],
  templateUrl: './cash-register.component.html',
  styleUrl: './cash-register.component.scss',
})
export class CashRegisterComponent {}
