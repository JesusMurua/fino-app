import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';

import { FieldDescriptor, SectionDescriptor } from '../schemas/product-form.schema';
import { FormFieldComponent } from './form-field.component';

/**
 * Section-level renderer.
 *
 * Renders a collapsible `<details>` block with a styled header (icon +
 * title + optional badge) and iterates the section's `fields`, filtering
 * by each field's `showWhen` predicate against the current FormGroup
 * value.
 *
 * Whole-section visibility (e.g. "only render Membership for Services
 * tenants") is the caller's responsibility — pass `[hidden]` or guard
 * with `@if (supportsMemberships())` at the call site. Keeping section-
 * level capability gating outside this component preserves the schema's
 * independence from `TenantContextService`.
 *
 * Usage:
 *   <app-form-section [descriptor]="section" [parentForm]="form" />
 */
@Component({
  selector: 'app-form-section',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    FormFieldComponent,
  ],
  template: `
    <details class="form-section" [attr.open]="descriptor.defaultOpen ? '' : null">
      <summary class="form-section__summary">
        <i class="form-section__icon" [ngClass]="descriptor.icon"></i>
        <span class="form-section__title">{{ descriptor.title }}</span>
        @if (descriptor.badge; as badge) {
          <span class="form-section__badge" [ngClass]="badgeClass(badge.variant)">
            {{ badge.label }}
          </span>
        }
        <i class="pi pi-chevron-down form-section__chevron"></i>
      </summary>

      <div class="form-section__body">
        @for (field of visibleFields(); track field.key) {
          <app-form-field [descriptor]="field" [parentForm]="parentForm" />
        }
      </div>
    </details>
  `,
})
export class FormSectionComponent {

  /** Section metadata: title, icon, badge, list of fields. */
  @Input({ required: true }) descriptor!: SectionDescriptor;

  /** Parent FormGroup containing all atomic controls for this section. */
  @Input({ required: true }) parentForm!: FormGroup;

  /**
   * Returns fields whose `showWhen` predicate currently resolves to
   * true (or has no predicate). Re-evaluated on every change-detection
   * cycle — Angular's OnPush triggers naturally when the form value
   * changes via reactive bindings.
   */
  visibleFields(): readonly FieldDescriptor[] {
    const currentValue = this.parentForm.value as Record<string, unknown>;
    return this.descriptor.fields.filter(
      field => !field.showWhen || field.showWhen(currentValue),
    );
  }

  /** Maps a badge variant to its CSS class. */
  badgeClass(variant: 'blue' | 'purple' | 'green'): string {
    return `form-section__badge--${variant}`;
  }

}
