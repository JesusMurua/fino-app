/**
 * Single-select chip-group FormWidget (FDD-032 Phase 3).
 *
 * Renders `descriptor.options` reshaped as `readonly ChipGroup[]` (consumer
 * provides this via a computed signal — e.g., reservation-form's
 * `tableChipGroups`).
 *
 * Host bindings:
 *   - `[id]` on host = `${formId}-${descriptor.key}` so the consumer's
 *     `focusFirstInvalid()` can locate the widget via `document.getElementById`.
 *   - `tabindex="-1"` so the host can receive programmatic focus
 *     (consumer triggers via `.focus()` on the host element). Native Tab
 *     order still leaves the host alone since tabindex is -1.
 *
 * Type cast notes:
 *   - `FieldDescriptor.options` is typed for built-in dropdown
 *     `{ label, value }[]` shape. Custom widgets reinterpret options at
 *     runtime per FDD-031 §4.1 widget-registry contract. The cast inside
 *     `resolvedGroups` preserves the Signal-vs-array detection by typing
 *     opts as `readonly ChipGroup[] | (() => readonly ChipGroup[]) | undefined`
 *     — `typeof opts === 'function'` correctly identifies the Signal case
 *     (Signals are invoked as functions in Angular).
 *   - Platform-side widening of FieldDescriptor.options is out of scope
 *     for FDD-032 Phase 3 (no platform modifications per task scope).
 */

import {
  ChangeDetectionStrategy,
  Component,
  Input,
} from '@angular/core';
import { AbstractControl } from '@angular/forms';

import {
  FieldDescriptor,
  FormWidget,
  PrintControlErrorComponent,
} from 'src/app/shared/forms';

/** A group of chips rendered together under a shared label. */
export interface ChipGroup {
  groupLabel: string;
  chips: readonly { label: string; value: unknown; subLabel?: string }[];
}

@Component({
  selector: 'app-chip-select',
  standalone: true,
  imports: [PrintControlErrorComponent],
  templateUrl: './chip-select.widget.html',
  styleUrl: './chip-select.widget.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[id]': 'formId + "-" + descriptor.key',
    '[attr.tabindex]': '"-1"',
  },
})
export class ChipSelectComponent implements FormWidget {

  @Input({ required: true }) descriptor!: FieldDescriptor;
  @Input({ required: true }) control!: AbstractControl;
  @Input({ required: true }) formId!: string;

  /**
   * Resolves `descriptor.options` to `readonly ChipGroup[]`. Cast preserves
   * the Signal-vs-array discriminator — see file docblock.
   */
  get resolvedGroups(): readonly ChipGroup[] {
    const opts = this.descriptor.options as unknown as
      | readonly ChipGroup[]
      | (() => readonly ChipGroup[])
      | undefined;
    if (!opts) return [];
    return typeof opts === 'function' ? opts() : opts;
  }

  select(value: unknown): void {
    this.control.setValue(value);
    this.control.markAsTouched();
  }

  onKeydown(event: KeyboardEvent, value: unknown): void {
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      this.select(value);
    }
    // Arrow-key cycling deferred — native Tab order suffices for v1.
    // Smoke surfaces UX gaps; future extension can wire an
    // active-descendant pattern.
  }
}
