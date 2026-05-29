/**
 * Top-level form orchestrator. Renders a `DynamicFormSchema` by mapping
 * each section to `<app-form-section>` and emitting validated values via
 * the `(submitted)` Output.
 *
 * Promoted from product-form POC (AUDIT-058 Vector B / FDD-029 §4.2).
 *
 * Ownership rules per FDD-029 §5.1:
 *   - The CONSUMER owns the FormGroup. The orchestrator never creates,
 *     clones, or mutates it — it only reads it.
 *   - The CONSUMER patches edit-mode values via `formGroup.patchValue(...)`.
 *   - The CONSUMER owns FormArrays (for `kind: 'array'` fields).
 *
 * Submit flow per FDD-029 §10:
 *   1. `submit()` is called by the consumer (typically wired to a submit button).
 *   2. `markAllAsTouched()` to surface validation errors.
 *   3. If `formGroup.valid` → emit `(submitted)` with the typed value.
 *   4. If invalid → DO NOT emit. Focus the first invalid control's input
 *      via its known DOM id (no reliance on aria-invalid attribute being
 *      updated, which depends on CD timing). WCAG 3.3.1 compliance.
 *
 * Output is named `submitted` (past tense) to avoid colliding with the
 * native DOM `submit` event when the consumer wraps the orchestrator in
 * a `<form>` element.
 */

import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  Injector,
  Input,
  OnInit,
  Output,
  Signal,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormGroup } from '@angular/forms';

import {
  DynamicFormSchema,
  FormValueSnapshot,
} from '../schemas/dynamic-form.schema';
import { FormSectionComponent } from './form-section.component';

@Component({
  selector: 'app-dynamic-form',
  standalone: true,
  imports: [CommonModule, FormSectionComponent],
  templateUrl: './dynamic-form.component.html',
  styleUrl: './dynamic-form.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DynamicFormComponent<TKey extends string = string> implements OnInit {

  //#region Inputs / Outputs

  @Input({ required: true }) schema!: DynamicFormSchema<TKey>;
  @Input({ required: true }) formGroup!: FormGroup;

  /**
   * Optional explicit form id. When omitted, the orchestrator generates
   * a unique id (UUID v4 if `crypto.randomUUID` is available, otherwise
   * a random base-36 string). The id is forwarded to descendant field
   * renderers so input `id`s don't collide across multiple dynamic forms
   * rendered on the same page.
   */
  @Input() formId?: string;

  /**
   * Optional explicit value snapshot. When omitted, the orchestrator
   * derives a snapshot from `formGroup.valueChanges` via `toSignal()`.
   */
  @Input() valueSnapshot?: Signal<FormValueSnapshot<TKey>>;

  /**
   * Emits the typed form value when the user triggers `submit()` and
   * the FormGroup is valid. NOT emitted when invalid — the focus side
   * effect is the only response in that case.
   */
  @Output() submitted = new EventEmitter<Record<TKey, unknown>>();

  //#endregion

  //#region Lifecycle / state

  private readonly elementRef = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  /** Resolved form id used for child input id namespacing. */
  effectiveFormId = '';

  /** Resolved snapshot signal piped to descendant sections. */
  effectiveSnapshot!: Signal<FormValueSnapshot<TKey>>;

  ngOnInit(): void {
    this.effectiveFormId = this.formId ?? this.generateFormId();

    if (this.valueSnapshot) {
      this.effectiveSnapshot = this.valueSnapshot;
    } else {
      const initialValue = (this.formGroup.value ?? {}) as FormValueSnapshot<TKey>;
      // Pass injector explicitly — toSignal requires an injection context.
      // ngOnInit runs outside the default context, so we forward the
      // injector captured at field-init time.
      this.effectiveSnapshot = toSignal(this.formGroup.valueChanges, {
        initialValue,
        injector: this.injector,
      }) as Signal<FormValueSnapshot<TKey>>;
    }
  }

  //#endregion

  //#region Public API — submit trigger

  /**
   * Consumer-invokable submit trigger. Marks all controls as touched
   * (surfaces errors), then applies the FDD-032 §10.4 focus priority:
   *
   *   Priority 1 — an individual control is invalid → focus the first
   *   invalid input (preserves FDD-029 §10 behavior).
   *
   *   Priority 2 — every control is valid but `formGroup.errors` is
   *   present (cross-field validator failed) → focus the
   *   PrintFormError banner via `document.getElementById`. The banner
   *   is a sibling of this component (consumer-placed), so the lookup
   *   must be global.
   */
  submit(): void {
    this.formGroup.markAllAsTouched();

    if (this.formGroup.valid) {
      this.submitted.emit(this.formGroup.value as Record<TKey, unknown>);
      return;
    }

    const firstInvalidKey = this.findFirstInvalidControlKey();
    if (firstInvalidKey !== null) {
      const inputId = `${this.effectiveFormId}-${firstInvalidKey}`;
      const el = this.elementRef.nativeElement.querySelector(`#${inputId}`);
      if (el instanceof HTMLElement) el.focus();
      return;
    }

    if (this.formGroup.errors) {
      const bannerId = `${this.effectiveFormId}-form-error`;
      const bannerEl = document.getElementById(bannerId);
      if (bannerEl) bannerEl.focus();
    }
  }

  //#endregion

  //#region Internals

  /**
   * Traverses the schema in declaration order and returns the key of the
   * first invalid control. Returns null when every control is valid.
   *
   * Uses schema order (not DOM order) so the focus target is deterministic
   * regardless of CD timing. Pairs with the known input id namespacing
   * to look up the DOM element directly.
   */
  private findFirstInvalidControlKey(): string | null {
    for (const section of this.schema.sections) {
      for (const field of section.fields) {
        const ctrl = this.formGroup.get(field.key as string);
        if (ctrl?.invalid) return field.key as string;
      }
    }
    return null;
  }

  private generateFormId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return `df-${crypto.randomUUID()}`;
    }
    return `df-${Math.random().toString(36).slice(2, 10)}`;
  }

  //#endregion

}
