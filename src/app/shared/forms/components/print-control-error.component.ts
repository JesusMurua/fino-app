/**
 * Renders a single user-friendly validation message for a FormControl.
 *
 * Promoted from the prescription in `.claude/html-standards.md` which
 * was documented but never implemented — flagged in AUDIT-059 §2.3 and
 * delivered in FDD-029 F1 sub-phase (a).
 *
 * Resolution priority for a given error key:
 *   1. `messages` Input override (highest).
 *   2. Default catalog (covers the 7 generic validators promoted in
 *      sub-phase b: required, nonBlank, positiveNumber, maxlength,
 *      minlength, min, max).
 *   3. Fallback message "Valor inválido".
 *
 * Renders nothing when the control is valid OR has not yet been touched
 * or modified. Reserves `1.2em` of vertical space at all times to avoid
 * layout shift when an error appears.
 *
 * ARIA: uses `aria-live="polite"` + `aria-atomic="true"`. Deliberately
 * NOT `role="alert"` (which forces assertive announcement) — form-field
 * errors should not interrupt the user mid-typing.
 */

import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  DestroyRef,
  Input,
  OnInit,
  inject,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AbstractControl } from '@angular/forms';

import { resolveErrorMessage } from './error-catalog';

@Component({
  selector: 'app-print-control-error',
  standalone: true,
  templateUrl: './print-control-error.component.html',
  styleUrl: './print-control-error.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PrintControlErrorComponent implements OnInit {

  //#region Inputs

  /** Control whose validation state drives the rendered message. */
  @Input({ required: true }) control!: AbstractControl;

  /**
   * Optional per-key message override. Takes priority over the default
   * catalog. Empty string is a valid override (renders nothing for that
   * specific key while still showing other keys when they fire).
   */
  @Input() messages?: Record<string, string>;

  //#endregion

  //#region Lifecycle

  private readonly destroyRef = inject(DestroyRef);
  private readonly cdr = inject(ChangeDetectorRef);

  ngOnInit(): void {
    // OnPush components don't re-render on internal subject changes
    // automatically — mark for check whenever the control's status
    // shifts so the template re-evaluates getErrorMessage().
    this.control.statusChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.cdr.markForCheck());
  }

  //#endregion

  //#region Public template API

  /**
   * Resolves the message to display for the control's first active error.
   * Returns null when the control is valid OR has not yet been
   * touched / made dirty. Resolution priority (override → catalog →
   * fallback) is delegated to the shared `resolveErrorMessage` helper
   * extracted in FDD-032 Phase 1 (Rule-of-3 with PrintFormError).
   */
  getErrorMessage(): string | null {
    const ctrl = this.control;
    if (!ctrl || ctrl.valid) return null;
    if (!ctrl.dirty && !ctrl.touched) return null;

    const errors = ctrl.errors;
    if (!errors) return null;

    const firstKey = Object.keys(errors)[0];
    if (!firstKey) return null;

    return resolveErrorMessage(firstKey, errors[firstKey], this.messages);
  }

  //#endregion

}
