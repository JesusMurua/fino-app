import { Component, Input, OnInit, computed, signal } from '@angular/core';
import { Location } from '@angular/common';
import {
  AbstractControl,
  FormArray,
  FormBuilder,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  ValidatorFn,
} from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { RadioButtonModule } from 'primeng/radiobutton';
import { CheckboxModule } from 'primeng/checkbox';
import { InputTextareaModule } from 'primeng/inputtextarea';
import { DividerModule } from 'primeng/divider';

import { PricePipe } from '../../../../shared/pipes/price.pipe';
import {
  Product,
  ProductExtra,
  ProductModifierGroup,
  ProductSize,
  calcUnitPriceCents,
} from '../../../../core/models';
import { CartService } from '../../../../core/services/cart.service';
import { DatabaseService } from '../../../../core/services/database.service';
import { ProductService } from '../../../../core/services/product.service';

/** Reactive form shape for the product detail page */
interface DetailForm {
  sizeId:   FormControl<number | null>;
  /** Map of groupId → boolean FormArray (one control per extra in the group) */
  groups:   FormGroup<Record<string, FormArray<FormControl<boolean>>>>;
  quantity: FormControl<number>;
  notes:    FormControl<string>;
}

/**
 * Cross-group validator that enforces each ProductModifierGroup's
 * min/max/required rules. Emits group-level error keys so the UI can
 * surface them per section (not as a form-level toast).
 */
function modifierGroupsValidator(groups: ProductModifierGroup[]): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const form = control as FormGroup<Record<string, FormArray<FormControl<boolean>>>>;
    const errors: Record<string, { min?: number; max?: number; required?: boolean }> = {};

    for (const group of groups) {
      const arr = form.controls[String(group.id)];
      if (!arr) continue;

      const count = arr.controls.reduce((n, c) => n + (c.value ? 1 : 0), 0);
      const required = group.isRequired && count === 0;
      const belowMin = group.minSelectable > 0 && count < group.minSelectable;
      const aboveMax = group.maxSelectable > 0 && count > group.maxSelectable;

      if (required || belowMin || aboveMax) {
        errors[group.id] = {
          ...(belowMin ? { min: group.minSelectable } : {}),
          ...(aboveMax ? { max: group.maxSelectable } : {}),
          ...(required ? { required: true } : {}),
        };
      }
    }

    return Object.keys(errors).length > 0 ? { modifierGroups: errors } : null;
  };
}

@Component({
  selector: 'app-product-detail',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    ButtonModule,
    RadioButtonModule,
    CheckboxModule,
    InputTextareaModule,
    DividerModule,
    PricePipe,
  ],
  templateUrl: './product-detail.component.html',
  styleUrl: './product-detail.component.scss',
})
export class ProductDetailComponent implements OnInit {

  //#region Inputs
  /** Route param — bound via withComponentInputBinding() in app.config.ts */
  @Input({ required: true }) id!: string;
  //#endregion

  //#region Properties
  readonly product = signal<Product | null>(null);
  form!: FormGroup<DetailForm>;

  /** Live price preview updated as form values change */
  readonly previewPriceCents = signal(0);

  /** Modifier groups sorted by sortOrder — convenience for the template */
  readonly sortedGroups = computed<ProductModifierGroup[]>(() => {
    const groups = this.product()?.modifierGroups ?? [];
    return [...groups].sort((a, b) => a.sortOrder - b.sortOrder);
  });
  //#endregion

  //#region Constructor
  constructor(
    private readonly fb: FormBuilder,
    private readonly productService: ProductService,
    private readonly db: DatabaseService,
    private readonly cartService: CartService,
    public readonly location: Location,
  ) {}
  //#endregion

  //#region Lifecycle
  async ngOnInit(): Promise<void> {
    const productId = Number(this.id);

    // Check signal cache first (already loaded), fallback to IndexedDB
    let product = this.productService.products().find(p => p.id === productId);
    if (!product) {
      product = await this.db.products.get(productId) ?? undefined;
    }

    if (!product) {
      this.location.back();
      return;
    }

    this.product.set(product);
    this.buildForm(product);
    this.updatePreview();
  }
  //#endregion

  //#region Form Methods

  /**
   * Builds the reactive form: one FormArray of booleans per modifier group,
   * plus size/quantity/notes controls. Cross-group validator enforces
   * min/max/isRequired rules declared by the backend.
   * @param product The product being customized
   */
  private buildForm(product: Product): void {
    const groupControls: Record<string, FormArray<FormControl<boolean>>> = {};
    const groups = product.modifierGroups ?? [];
    for (const group of groups) {
      const checkboxes = group.extras.map(() => new FormControl(false, { nonNullable: true }));
      groupControls[String(group.id)] = this.fb.array(checkboxes) as FormArray<FormControl<boolean>>;
    }

    const groupsForm = this.fb.group<Record<string, FormArray<FormControl<boolean>>>>(groupControls, {
      validators: [modifierGroupsValidator(groups)],
    });

    this.form = this.fb.group<DetailForm>({
      sizeId:   new FormControl<number | null>(product.sizes[0]?.id ?? null),
      groups:   groupsForm,
      quantity: new FormControl(1, { nonNullable: true }),
      notes:    new FormControl('', { nonNullable: true }),
    });

    this.form.valueChanges.subscribe(() => this.updatePreview());
  }

  /** Recalculates the live price preview based on current form values */
  private updatePreview(): void {
    const product = this.product();
    if (!product) return;

    const size = product.sizes.find(s => s.id === this.form.controls.sizeId.value);
    const selectedExtras = this.collectSelectedExtras(product);

    const unit = calcUnitPriceCents(product, size, selectedExtras);
    const quantity = this.form.controls.quantity.value ?? 1;
    this.previewPriceCents.set(unit * quantity);
  }

  /**
   * Walks every modifier group and returns the flat list of extras
   * the user has ticked. Used both by the price preview and the add-to-cart
   * flow so CartItem.extras stays a flat ProductExtra[] as the backend expects.
   */
  private collectSelectedExtras(product: Product): ProductExtra[] {
    const selected: ProductExtra[] = [];
    const groups = product.modifierGroups ?? [];
    for (const group of groups) {
      const arr = this.groupArray(group.id);
      if (!arr) continue;
      group.extras.forEach((extra, i) => {
        if (arr.controls[i]?.value) selected.push(extra);
      });
    }
    return selected;
  }
  //#endregion

  //#region Accessors

  /** Returns the FormArray of booleans bound to a given modifier group */
  groupArray(groupId: number): FormArray<FormControl<boolean>> | undefined {
    return this.form.controls.groups.controls[String(groupId)];
  }

  /** Current number of selected extras within a group — used for UI hints */
  selectedCount(groupId: number): number {
    const arr = this.groupArray(groupId);
    if (!arr) return 0;
    return arr.controls.reduce((n, c) => n + (c.value ? 1 : 0), 0);
  }

  /**
   * True when the group still accepts more selections. When maxSelectable
   * has been reached, unchecked boxes should disable to block the user.
   */
  canSelectMore(group: ProductModifierGroup): boolean {
    if (group.maxSelectable <= 0) return true;
    return this.selectedCount(group.id) < group.maxSelectable;
  }

  /** Per-group error record produced by modifierGroupsValidator */
  groupError(groupId: number): { min?: number; max?: number; required?: boolean } | null {
    const errors = this.form.controls.groups.errors?.['modifierGroups'] as
      | Record<string, { min?: number; max?: number; required?: boolean }>
      | undefined;
    return errors?.[String(groupId)] ?? null;
  }

  /** Short, user-facing rule description for a group header */
  groupRuleLabel(group: ProductModifierGroup): string {
    if (group.maxSelectable === 1 && group.isRequired) return 'Elige 1 (obligatorio)';
    if (group.maxSelectable === 1) return 'Elige 1';
    if (group.isRequired && group.minSelectable > 0 && group.maxSelectable > 0) {
      return `Elige entre ${group.minSelectable} y ${group.maxSelectable} (obligatorio)`;
    }
    if (group.isRequired) return 'Obligatorio';
    if (group.maxSelectable > 0 && group.minSelectable > 0) {
      return `Elige entre ${group.minSelectable} y ${group.maxSelectable}`;
    }
    if (group.maxSelectable > 0) return `Elige hasta ${group.maxSelectable}`;
    if (group.minSelectable > 0) return `Elige al menos ${group.minSelectable}`;
    return 'Opcional';
  }

  /** Human-readable error line shown under the group title when invalid */
  groupErrorLabel(group: ProductModifierGroup): string | null {
    const err = this.groupError(group.id);
    if (!err) return null;
    if (err.required) return 'Selecciona al menos uno';
    if (err.min !== undefined) return `Debes elegir al menos ${err.min}`;
    if (err.max !== undefined) return `Máximo ${err.max} selecciones`;
    return null;
  }
  //#endregion

  //#region Cart Methods

  /** Adds the configured product to the cart and navigates back */
  async onAddToCart(): Promise<void> {
    const product = this.product();
    if (!product || this.form.invalid) return;

    const size: ProductSize | undefined = product.sizes.find(
      s => s.id === this.form.controls.sizeId.value,
    );
    const selectedExtras = this.collectSelectedExtras(product);
    const quantity = this.form.controls.quantity.value ?? 1;
    const notes = this.form.controls.notes.value?.trim() || undefined;

    for (let i = 0; i < quantity; i++) {
      await this.cartService.addItem(product, size, selectedExtras, notes);
    }

    this.location.back();
  }
  //#endregion

}
