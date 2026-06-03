import { ChangeDetectionStrategy, Component, effect, inject, signal } from '@angular/core';

import { CashRegisterService } from '../../../core/services/cash-register.service';
import { PricePipe } from '../../pipes/price.pipe';

/**
 * Pill-style status chip that surfaces the active cash shift across
 * every POS surface (header of the Fast-Lane UnifiedPos, header of the
 * F&B RestaurantHub, future home-screen tiles, etc.). Owns the green/
 * amber color treatment, the live amount, the dot pulse on open
 * shifts, and the one-shot amount pulse on sale events. Clicking the
 * chip toggles the global shift sidebar through
 * `CashRegisterService.togglePanel()`.
 *
 * Lives here in `shared/` so consumers do not have to duplicate the
 * markup, the SCSS, the pulse effect, or the `togglePanel` wiring. Any
 * new POS surface that should show shift state simply imports the
 * component and drops `<app-shift-chip />` into its header.
 */
@Component({
  selector: 'app-shift-chip',
  standalone: true,
  imports: [PricePipe],
  templateUrl: './shift-chip.component.html',
  styleUrl: './shift-chip.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ShiftChipComponent {

  readonly cashRegisterService = inject(CashRegisterService);

  /**
   * Monotonic counter bumped whenever `expectedAmount` changes.
   * Bound to `attr.data-pulse` in the template; toggling the attribute
   * re-triggers the keyframe animation on the amount span.
   */
  readonly amountPulseKey = signal(0);

  constructor() {
    let lastAmount = this.cashRegisterService.expectedAmount();
    effect(() => {
      const next = this.cashRegisterService.expectedAmount();
      if (next === lastAmount) return;
      lastAmount = next;
      this.amountPulseKey.update(v => v + 1);
    }, { allowSignalWrites: true });
  }
}
