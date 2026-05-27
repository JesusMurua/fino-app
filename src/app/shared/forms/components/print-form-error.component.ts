/**
 * Renders the first form-level (cross-field) validation error of a
 * FormGroup using the shared error catalog.
 *
 * Promoted in FDD-032 Phase 1 — closes FDD-031 OQ1 (cross-field error
 * surfacing). The banner is opt-in: consumers place it in their
 * template above `<app-dynamic-form>`. `DynamicFormComponent.submit()`
 * focuses the banner via `document.getElementById('${formId}-form-error')`
 * when every individual control is valid but a formGroup-level
 * validator failed (FDD-032 §10.4 priority rule).
 *
 * Resolution priority matches PrintControlError (`messages` override →
 * shared catalog → fallback). Rule-of-3 extraction landed alongside
 * this component as `error-catalog.ts`.
 *
 * ARIA: `aria-live="polite"` + `aria-atomic="true"`. Deliberately NOT
 * `role="alert"` — cross-field validation surfaces on submit, not
 * mid-typing, so polite suffices and matches PrintControlError.
 *
 * Layout note: the banner reserves vertical space via `min-height` per
 * FDD §4.1 visual contract. UX polish for the empty state is deferred
 * to FDD-033+ if smoke surfaces it as a concern.
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
import { FormGroup } from '@angular/forms';

import { resolveErrorMessage } from './error-catalog';

@Component({
  selector: 'app-print-form-error',
  standalone: true,
  templateUrl: './print-form-error.component.html',
  styleUrl: './print-form-error.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[id]': 'formId + "-form-error"',
    '[attr.tabindex]': '"-1"',
    '[attr.aria-live]': '"polite"',
    '[attr.aria-atomic]': '"true"',
  },
})
export class PrintFormErrorComponent implements OnInit {

  //#region Inputs

  /** FormGroup whose `errors` (cross-field) drive the rendered message. */
  @Input({ required: true }) formGroup!: FormGroup;

  /**
   * Stable id used to derive the banner's DOM id (`${formId}-form-error`).
   * Consumers pass the same id they pass to `<app-dynamic-form>` so the
   * orchestrator can locate the banner via `document.getElementById`
   * during submit focus management.
   */
  @Input({ required: true }) formId!: string;

  /**
   * Optional per-key message override. Same priority semantics as
   * PrintControlError — empty-string override is honored explicitly.
   */
  @Input() messages?: Record<string, string>;

  //#endregion

  //#region Lifecycle

  private readonly destroyRef = inject(DestroyRef);
  private readonly cdr = inject(ChangeDetectorRef);

  ngOnInit(): void {
    // OnPush + cross-field errors live on the FormGroup itself, not on
    // any child control — subscribe to the group's status changes and
    // markForCheck so getErrorMessage() re-evaluates on each transition.
    this.formGroup.statusChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.cdr.markForCheck());
  }

  //#endregion

  //#region Public template API

  /**
   * Returns the message for the first form-level error, or null when
   * the group is valid OR untouched. Cross-field validators fire on
   * the FormGroup itself (`formGroup.errors`), not on individual
   * controls — individual control errors are rendered by
   * PrintControlError inline below each field.
   */
  getErrorMessage(): string | null {
    const fg = this.formGroup;
    if (!fg || fg.valid) return null;
    if (!fg.touched) return null;

    const errors = fg.errors;
    if (!errors) return null;

    const firstKey = Object.keys(errors)[0];
    if (!firstKey) return null;

    return resolveErrorMessage(firstKey, errors[firstKey], this.messages);
  }

  //#endregion

}
