import { Component, effect, inject, input, model, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputNumberModule } from 'primeng/inputnumber';

import { Product } from '../../../../core/models';
import { ScaleService } from '../../../../core/services/scale.service';
import { formatMeasureUnit } from '../../../../core/utils/product.utils';

/**
 * Measure capture dialog for `TrackedByMeasure` products (weight,
 * volume, length, area — driven by the product's `satUnitCode`).
 *
 * Manual-input fallback — surfaces a status badge bound to
 * `ScaleService.scaleType()` so the cashier sees whether a hardware
 * sensor is configured (live-read integration arrives in a later
 * phase). The emitted payload uses raw decimal quantity to match the
 * backend canonical representation (`OrderItem.Quantity` decimal(18,4)).
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

  /** Template helper for the dynamic unit suffix (kg, L, m, m2, etc.). */
  readonly formatMeasureUnit = formatMeasureUnit;

  /** Two-way binding for dialog visibility */
  readonly visible = model<boolean>(false);

  /** Product being weighed — drives the dialog header */
  readonly product = input<Product | null>(null);

  /** Emits the captured quantity as a raw decimal on confirm */
  readonly measureCaptured = output<{ quantity: number }>();

  /**
   * Manual measure value in the product's native unit (kg / L / m / m²
   * per `satUnitCode`). Plain property (not signal) so PrimeNG's
   * `[(ngModel)]` two-way binding works without unwrapping the signal.
   */
  manualMeasureValue: number = 0;

  //#endregion

  //#region Lifecycle

  constructor() {
    // Reset the input every time the dialog reopens so a previous capture
    // does not leak into the next product. Side-effect on a plain prop, no
    // `allowSignalWrites` flag needed.
    effect(() => {
      if (this.visible()) {
        this.manualMeasureValue = 0;
      }
    });
  }

  //#endregion

  //#region Actions

  /**
   * Emits the captured decimal quantity and closes the dialog. Guards
   * against accidental zero/negative emissions even though the template
   * disables the confirm button below the minimum.
   */
  confirm(): void {
    if (this.manualMeasureValue <= 0) return;
    this.measureCaptured.emit({ quantity: this.manualMeasureValue });
    this.visible.set(false);
  }

  //#endregion

}
