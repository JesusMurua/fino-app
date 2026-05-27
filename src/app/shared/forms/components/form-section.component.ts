/**
 * Renders one collapsible section of a dynamic form.
 *
 * Promoted from product-form POC (AUDIT-058 Vector B / FDD-029 §4.3).
 * Emits the prescribed PrimeFlex wrapper (`<div class="p-fluid p-formgrid grid">`)
 * exactly per `.claude/html-standards.md` §"Form Structure". Each field
 * gets its own column wrapper with BOTH `md:col-X` and `lg:col-X`
 * breakpoints applied — dropping `md` breaks responsive on tablets,
 * which is the dominant form factor for back-office POS surfaces.
 *
 * Visibility:
 *   - Section-level: `section.showSection?(snapshot)` — when false, the
 *     section is not rendered at all (no header, no wrapper, no fields).
 *   - Field-level: `field.showWhen?(snapshot)` — filters which fields
 *     render inside the visible section.
 *
 * Uses a native `<details>` / `<summary>` for accordion behavior —
 * accessible by default, no custom interactivity needed in F1.
 */

import {
  ChangeDetectionStrategy,
  Component,
  Input,
  Signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { AbstractControl, FormGroup } from '@angular/forms';

import {
  FieldDescriptor,
  FormValueSnapshot,
  SectionDescriptor,
} from '../schemas/dynamic-form.schema';
import { FormFieldComponent } from './form-field.component';

@Component({
  selector: 'app-form-section',
  standalone: true,
  imports: [CommonModule, FormFieldComponent],
  templateUrl: './form-section.component.html',
  styleUrl: './form-section.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FormSectionComponent<TKey extends string = string> {

  //#region Inputs

  @Input({ required: true }) section!: SectionDescriptor<TKey>;
  @Input({ required: true }) formGroup!: FormGroup;
  @Input({ required: true }) formId!: string;

  /**
   * Optional value snapshot driven by the parent orchestrator. When
   * omitted, `showWhen` / `showSection` predicates evaluate against
   * `formGroup.value` directly.
   */
  @Input() valueSnapshot?: Signal<FormValueSnapshot<TKey>>;

  //#endregion

  //#region Computed view state

  isSectionVisible(): boolean {
    if (!this.section.showSection) return true;
    return this.section.showSection(this.snapshot());
  }

  visibleFields(): readonly FieldDescriptor<TKey>[] {
    const snapshot = this.snapshot();
    return this.section.fields.filter(
      (f) => !f.showWhen || f.showWhen(snapshot),
    );
  }

  getControl(key: TKey): AbstractControl {
    const ctrl = this.formGroup.get(key as string);
    if (!ctrl) {
      throw new Error(
        `FormSectionComponent: FormGroup is missing control "${String(key)}" ` +
          `declared in section "${this.section.id}". Ensure the FormGroup ` +
          `was built from a schema that includes this field.`,
      );
    }
    return ctrl;
  }

  /**
   * PrimeFlex column class string. Emits BOTH `md:col-X` and `lg:col-X`
   * per html-standards §"Form Structure" — dropping one breaks responsive
   * on tablets.
   */
  fieldWrapperClass(field: FieldDescriptor<TKey>): string {
    const md = field.colSpan?.md ?? 12;
    const lg = field.colSpan?.lg ?? 12;
    return `field col-12 md:col-${md} lg:col-${lg} gap-2`;
  }

  //#endregion

  //#region Internals

  private snapshot(): FormValueSnapshot<TKey> {
    if (this.valueSnapshot) return this.valueSnapshot();
    return (this.formGroup.value ?? {}) as FormValueSnapshot<TKey>;
  }

  //#endregion

}
