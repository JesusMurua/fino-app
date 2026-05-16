import { Component, effect, inject, input, model, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputNumberModule } from 'primeng/inputnumber';

import { Product } from '../../../../core/models';
import { ScaleService } from '../../../../core/services/scale.service';

/**
 * Weight capture dialog for products sold by weight.
 *
 * Manual-input fallback for Phase 4.2 — surfaces a status badge bound to
 * `ScaleService.scaleType()` so the cashier sees whether a hardware scale
 * is configured (live-read integration arrives in a later phase). The
 * emitted payload uses `weightGrams` (integer) to match the backend
 * `OrderItemMetadata.weightGrams` slot directly.
 *
 * Mirrors `TableSelectorDialogComponent`: declarative `<p-dialog>`,
 * standalone, `model<boolean>` for visibility, typed `output<>` for the
 * confirmation event. The parent component opens it via two-way binding;
 * `DialogService` is intentionally NOT used (POS module convention).
 */
@Component({
  selector: 'app-weight-capture-dialog',
  standalone: true,
  imports: [DialogModule, ButtonModule, InputNumberModule, FormsModule],
  templateUrl: './weight-capture-dialog.component.html',
  styleUrl: './weight-capture-dialog.component.scss',
})
export class WeightCaptureDialogComponent {

  //#region Properties

  /** Scale config service — read by the template for the status badge. */
  readonly scaleService = inject(ScaleService);

  /** Two-way binding for dialog visibility */
  readonly visible = model<boolean>(false);

  /** Product being weighed — drives the dialog header */
  readonly product = input<Product | null>(null);

  /** Emits the captured weight in integer grams on confirm */
  readonly weightCaptured = output<{ weightGrams: number }>();

  /**
   * Manual weight in kilograms. Plain property (not signal) so PrimeNG's
   * `[(ngModel)]` two-way binding works without unwrapping the signal.
   */
  manualWeightKg: number = 0;

  //#endregion

  //#region Lifecycle

  constructor() {
    // Reset the input every time the dialog reopens so a previous capture
    // does not leak into the next product. Side-effect on a plain prop, no
    // `allowSignalWrites` flag needed.
    effect(() => {
      if (this.visible()) {
        this.manualWeightKg = 0;
      }
    });
  }

  //#endregion

  //#region Actions

  /**
   * Emits the captured weight in grams and closes the dialog. Guards
   * against accidental zero/negative emissions even though the template
   * disables the confirm button below the minimum.
   */
  confirm(): void {
    if (this.manualWeightKg <= 0) return;
    this.weightCaptured.emit({
      weightGrams: Math.round(this.manualWeightKg * 1000),
    });
    this.visible.set(false);
  }

  //#endregion

}
