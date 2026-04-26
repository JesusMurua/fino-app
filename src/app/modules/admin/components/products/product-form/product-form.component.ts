import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import {
  AbstractControl,
  FormArray,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  ValidatorFn,
  Validators,
} from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';

import { ButtonModule } from 'primeng/button';
import { DropdownModule } from 'primeng/dropdown';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputSwitchModule } from 'primeng/inputswitch';
import { InputTextModule } from 'primeng/inputtext';
import { InputTextareaModule } from 'primeng/inputtextarea';
import { TabViewModule } from 'primeng/tabview';
import { ToastModule } from 'primeng/toast';
import { TooltipModule } from 'primeng/tooltip';
import { MessageService } from 'primeng/api';

import {
  Category,
  IVA_RATE_OPTIONS,
  Product,
  ProductExtra,
  ProductImage,
  ProductModifierGroup,
  SAT_UNIT_OPTIONS,
} from '../../../../../core/models';
import { SubCategoryType } from '../../../../../core/enums';
import { DatabaseService } from '../../../../../core/services/database.service';
import { ProductService, SaveProductDto } from '../../../../../core/services/product.service';
import { ScannerService } from '../../../../../core/services/scanner.service';
import { PrinterDestinationService } from '../../../../../core/services/printer-destination.service';
import { TenantContextService } from '../../../../../core/services/tenant-context.service';
import { getHttpErrorSummary } from '../../../../../core/utils/http-error.utils';

/**
 * Reactive form for a single product size (Chico/Grande/etc).
 * `priceDeltaPesos` holds the UI-friendly decimal; we convert to cents on save.
 */
type SizeFormGroup = FormGroup<{
  id:              FormControl<number | null>;
  label:           FormControl<string>;
  priceDeltaPesos: FormControl<number>;
}>;

/**
 * Reactive form for a single modifier extra (nested inside a group).
 * `pricePesos` holds the UI-friendly decimal amount; we convert to
 * `priceCents` integer on save.
 */
type ModifierExtraForm = FormGroup<{
  id:         FormControl<number | null>;
  label:      FormControl<string>;
  pricePesos: FormControl<number>;
  sortOrder:  FormControl<number>;
}>;

/** Reactive form for a single modifier group */
type ModifierGroupForm = FormGroup<{
  id:            FormControl<number | null>;
  name:          FormControl<string>;
  sortOrder:     FormControl<number>;
  isRequired:    FormControl<boolean>;
  minSelectable: FormControl<number>;
  maxSelectable: FormControl<number>;
  extras:        FormArray<ModifierExtraForm>;
}>;

/**
 * The full reactive form for the product create/edit page.
 * Single source of truth — every field in the page is bound via
 * formControlName into this tree.
 */
type ProductFormGroup = FormGroup<{
  name:                   FormControl<string>;
  barcode:                FormControl<string>;
  description:            FormControl<string>;
  pricePesos:             FormControl<number>;
  categoryId:             FormControl<number | null>;
  isAvailable:            FormControl<boolean>;
  trackStock:             FormControl<boolean>;
  currentStock:           FormControl<number>;
  lowStockThreshold:      FormControl<number>;
  printingDestinationId:  FormControl<number | null>;
  satProductCode:         FormControl<string>;
  satUnitCode:            FormControl<string>;
  taxRate:                FormControl<number>;
  /** Gym vertical: opt-in flag that surfaces the membership duration field */
  isMembership:           FormControl<boolean>;
  /** Gym vertical: days the customer's membership is extended on each sale */
  membershipDurationDays: FormControl<number>;
  sizes:                  FormArray<SizeFormGroup>;
  modifierGroups:         FormArray<ModifierGroupForm>;
}>;

/**
 * Cross-field validator for a modifier group: errors when
 * minSelectable > maxSelectable (and maxSelectable is set).
 * Emits a form-level `minMax` error consumed by the template.
 */
const modifierGroupMinMaxValidator: ValidatorFn = (
  control: AbstractControl,
): ValidationErrors | null => {
  const min = control.get('minSelectable')?.value ?? 0;
  const max = control.get('maxSelectable')?.value ?? 0;
  if (max > 0 && min > max) return { minMax: true };
  return null;
};

@Component({
  selector: 'app-product-form',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    ButtonModule,
    DropdownModule,
    InputNumberModule,
    InputSwitchModule,
    InputTextModule,
    InputTextareaModule,
    TabViewModule,
    ToastModule,
    TooltipModule,
  ],
  providers: [MessageService],
  templateUrl: './product-form.component.html',
  styleUrl: './product-form.component.scss',
})
export class ProductFormComponent implements OnInit, OnDestroy {

  //#region Properties

  private readonly db = inject(DatabaseService);
  private readonly productService = inject(ProductService);
  private readonly scannerService = inject(ScannerService);
  private readonly messageService = inject(MessageService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly tenantContext = inject(TenantContextService);
  readonly printerDestinationService = inject(PrinterDestinationService);

  /**
   * True when the current tenant is on the Gym vertical. Drives the
   * visibility of the membership configuration block — non-gym tenants
   * never see these fields and the form's defaults result in a
   * `metadata: undefined` payload, so nothing leaks across verticals.
   */
  readonly isGymTenant = computed(() =>
    this.tenantContext.currentSubCategory() === SubCategoryType.Gym,
  );

  /** Maximum number of images allowed per product */
  static readonly MAX_IMAGES = 5;

  /** Categories available for the dropdown — read from Dexie on init */
  readonly categories = signal<Category[]>([]);

  /** Edit mode tracking — null in create mode */
  readonly editingProduct = signal<Product | null>(null);

  /** True while the save POST/PUT is in flight */
  readonly savingProduct = signal(false);

  /** Active tab index in the page-level TabView */
  activeTabIndex = 0;

  /** Images attached to the product (edit mode only) */
  readonly productImages = signal<ProductImage[]>([]);

  /** True while an image upload is in progress */
  readonly uploadingImage = signal(false);

  /** Full reactive form for the page */
  readonly productForm: ProductFormGroup = this.buildProductForm();

  /** Convenience accessor — sizes FormArray */
  get sizesForm(): FormArray<SizeFormGroup> {
    return this.productForm.controls.sizes;
  }

  /** Convenience accessor — modifier groups FormArray */
  get modifierGroupsForm(): FormArray<ModifierGroupForm> {
    return this.productForm.controls.modifierGroups;
  }

  // ---- SAT catalog options for fiscal dropdowns ----
  readonly satUnitOptions = SAT_UNIT_OPTIONS;
  readonly ivaRateOptions = IVA_RATE_OPTIONS;

  // ---- Printing destination options ----
  /** True when at least one active printer destination is configured */
  readonly hasPrinters = computed(() =>
    this.printerDestinationService.activeDestinations().length > 0,
  );
  /** Dropdown options: null entry (no printing) + all active destinations */
  readonly printingDestinationOptions = computed(() => [
    { id: null, name: 'Sin impresión de cocina' },
    ...this.printerDestinationService.activeDestinations(),
  ]);

  /** Subscription to the global HID scanner — only active when armed */
  private scanSubscription?: Subscription;

  //#endregion

  //#region Lifecycle

  async ngOnInit(): Promise<void> {
    // Hydrate categories + printer destinations in parallel
    const [categories] = await Promise.all([
      this.db.categories.orderBy('sortOrder').toArray(),
      this.printerDestinationService.loadFromLocal(),
    ]);
    this.categories.set(categories);

    // Detect mode from route: presence of `:id` → edit, absence → create
    const idParam = this.route.snapshot.paramMap.get('id');
    if (idParam) {
      await this.loadProduct(Number(idParam));
    } else {
      this.resetProductForm();
    }
  }

  ngOnDestroy(): void {
    this.scanSubscription?.unsubscribe();
    this.scannerService.stopListening();
  }

  //#endregion

  //#region Mode Resolution

  /**
   * Loads a product from Dexie into the form for editing.
   * If the product is missing locally (deep-link to a deleted record),
   * shows a toast and redirects back to the list.
   */
  private async loadProduct(id: number): Promise<void> {
    const product = await this.db.products.get(id);
    if (!product) {
      this.messageService.add({
        severity: 'error',
        summary: 'Producto no encontrado',
        detail: 'El producto fue eliminado o no existe en la sucursal activa.',
        life: 4000,
      });
      this.router.navigate(['/admin/products']);
      return;
    }

    this.editingProduct.set(product);
    this.resetProductForm();

    // Derive membership flags from `metadata.membershipDurationDays`. The
    // metadata bag may be a string (legacy emit) or undefined — read
    // defensively. `Number(undefined) === NaN`, so the `|| 0` collapses
    // any non-positive/invalid value into "not a membership".
    const membershipDays = Number(product.metadata?.['membershipDurationDays']) || 0;

    this.productForm.patchValue({
      name:                   product.name,
      barcode:                product.barcode ?? '',
      description:            product.description ?? '',
      pricePesos:             product.priceCents / 100,
      categoryId:             product.categoryId,
      isAvailable:            product.isAvailable,
      trackStock:             product.trackStock ?? false,
      currentStock:           product.currentStock ?? 0,
      lowStockThreshold:      product.lowStockThreshold ?? 0,
      printingDestinationId:  product.printingDestinationId ?? null,
      satProductCode:         product.satProductCode ?? '',
      satUnitCode:            product.satUnitCode ?? 'H87',
      taxRate:                product.taxRate ?? 16,
      isMembership:           membershipDays > 0,
      membershipDurationDays: membershipDays > 0 ? membershipDays : 30,
    });

    // Sizes FormArray — patchValue cannot add rows, so we push manually
    for (const size of product.sizes) {
      this.sizesForm.push(this.buildSizeForm(size));
    }

    // Modifier groups — rebuild the full hierarchy, no flattening, no data loss
    const sortedGroups = [...(product.modifierGroups ?? [])]
      .sort((a, b) => a.sortOrder - b.sortOrder);
    for (const group of sortedGroups) {
      this.modifierGroupsForm.push(this.buildGroupForm(group));
    }

    this.productImages.set(product.images ?? []);
  }

  //#endregion

  //#region Navigation

  /** Cancels the form and returns to the list */
  cancel(): void {
    this.router.navigate(['/admin/products']);
  }

  //#endregion

  //#region Save

  /**
   * Saves the product with strict pessimistic UI: the backend call must
   * succeed before navigating. On failure the page stays open so the
   * user can retry or edit.
   *
   * Routing after success:
   *   - create → navigate to `/admin/products/:newId/edit` so the user
   *     can immediately attach images (the image tab is gated by
   *     `editingProduct`).
   *   - update → navigate back to `/admin/products`.
   */
  save(): void {
    if (this.productForm.invalid) {
      this.productForm.markAllAsTouched();
      return;
    }

    const raw = this.productForm.getRawValue();

    // Sizes — strip empty rows, assign implicit sortOrder from array index,
    // convert priceDeltaPesos → priceDeltaCents.
    const sizes = raw.sizes
      .filter(s => s.label.trim().length > 0)
      .map((s, i) => ({
        id: s.id ?? i + 1,
        label: s.label.trim(),
        priceDeltaCents: Math.round((s.priceDeltaPesos || 0) * 100),
      }));

    // Modifier groups — assign implicit sortOrder from array index,
    // convert pricePesos → priceCents, drop empty groups.
    const modifierGroups: ProductModifierGroup[] = raw.modifierGroups
      .map((g, gi) => {
        const extras: ProductExtra[] = g.extras
          .filter(e => e.label.trim().length > 0)
          .map(e => ({
            id: e.id ?? 0,
            label: e.label.trim(),
            priceCents: Math.round((e.pricePesos || 0) * 100),
          }));
        return {
          id: g.id ?? 0,
          name: g.name.trim(),
          sortOrder: gi,
          isRequired: g.isRequired,
          minSelectable: g.minSelectable ?? 0,
          maxSelectable: g.maxSelectable ?? 0,
          extras,
        };
      })
      .filter(g => g.name.length > 0 && g.extras.length > 0);

    const editing = this.editingProduct();
    const isEdit = !!editing;

    const dto: SaveProductDto = {
      name: raw.name.trim(),
      barcode: raw.barcode.trim() || undefined,
      description: raw.description.trim() || undefined,
      priceCents: Math.round((raw.pricePesos || 0) * 100),
      categoryId: raw.categoryId!,
      isAvailable: raw.isAvailable,
      trackStock: raw.trackStock,
      currentStock: raw.trackStock ? raw.currentStock : 0,
      lowStockThreshold: raw.trackStock ? raw.lowStockThreshold : 0,
      sizes,
      modifierGroups,
      satProductCode: raw.satProductCode.trim() || undefined,
      satUnitCode: raw.satUnitCode || undefined,
      taxRate: raw.taxRate,
      printingDestinationId: raw.printingDestinationId,
      metadata: this.composeMetadata(raw.isMembership, raw.membershipDurationDays, editing?.metadata),
    };
    const save$ = isEdit
      ? this.productService.updateProduct(editing!.id, dto, editing!)
      : this.productService.createProduct(dto);

    this.savingProduct.set(true);
    save$.subscribe({
      next: (saved) => {
        this.savingProduct.set(false);
        this.messageService.add({
          severity: 'success',
          summary: isEdit ? 'Producto actualizado' : 'Producto creado',
          life: 3000,
        });

        if (isEdit) {
          this.router.navigate(['/admin/products']);
        } else {
          // Land on the edit page so the user can add images right away
          this.router.navigate(['/admin/products', saved.id, 'edit']);
        }
      },
      error: (err) => {
        this.savingProduct.set(false);
        this.messageService.add({
          severity: 'error',
          summary: getHttpErrorSummary(err),
          detail: 'No se pudo guardar el producto. Revisa los datos e inténtalo de nuevo.',
          life: 5000,
        });
      },
    });
  }

  /**
   * Composes the `metadata` payload preserving any keys the form does
   * not own (forwards-compatible: a future backend release may add new
   * vertical keys we don't yet render).
   *
   * - When `isMembership` is true and `days > 0`, sets/overrides
   *   `membershipDurationDays`.
   * - When `isMembership` is false, removes only the
   *   `membershipDurationDays` key — sibling keys survive.
   * - Returns `undefined` when the resulting object is empty so the
   *   backend stores NULL rather than `{}`.
   */
  private composeMetadata(
    isMembership: boolean,
    days: number,
    existing: Record<string, unknown> | undefined,
  ): Record<string, unknown> | undefined {
    const next: Record<string, unknown> = { ...(existing ?? {}) };

    if (isMembership && days > 0) {
      next['membershipDurationDays'] = days;
    } else {
      delete next['membershipDurationDays'];
    }

    return Object.keys(next).length > 0 ? next : undefined;
  }

  //#endregion

  //#region Images

  /** Handles image file selection and uploads to the API */
  async onImageSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const editing = this.editingProduct();
    if (!input.files?.length || !editing) return;
    if (this.productImages().length >= ProductFormComponent.MAX_IMAGES) return;

    this.uploadingImage.set(true);
    try {
      const image = await this.productService.uploadProductImage(
        editing.id, input.files[0],
      );
      const updatedImages = [...this.productImages(), image];
      this.productImages.set(updatedImages);
      // Persist images to Dexie so they load on next page open
      await this.db.products.update(editing.id, { images: updatedImages });
    } catch (e) {
      console.warn('Image upload failed:', e);
    } finally {
      this.uploadingImage.set(false);
      input.value = '';
    }
  }

  /** Deletes a product image from the API */
  async deleteImage(imageId: number): Promise<void> {
    const editing = this.editingProduct();
    if (!editing) return;
    try {
      await this.productService.deleteProductImage(editing.id, imageId);
      const updatedImages = this.productImages().filter(i => i.id !== imageId);
      this.productImages.set(updatedImages);
      // Persist to Dexie so removal is reflected on next page open
      await this.db.products.update(editing.id, { images: updatedImages });
    } catch (e) {
      console.warn('Image delete failed:', e);
    }
  }

  //#endregion

  //#region Barcode Scanner

  /**
   * Activates the global HID scanner listener and fills the barcode
   * field with the first scanned code.
   */
  activateBarcodeScanner(): void {
    this.scanSubscription?.unsubscribe();

    this.scannerService.startListening();
    this.scanSubscription = this.scannerService.onScan().subscribe(code => {
      this.productForm.controls.barcode.setValue(code);
      this.scanSubscription?.unsubscribe();
      this.scanSubscription = undefined;
      this.scannerService.stopListening();
    });
  }

  //#endregion

  //#region Form builders

  /** Builds the root reactive form shape with empty defaults */
  private buildProductForm(): ProductFormGroup {
    return new FormGroup({
      name:                   new FormControl('', { nonNullable: true, validators: [Validators.required] }),
      barcode:                new FormControl('', { nonNullable: true }),
      description:            new FormControl('', { nonNullable: true }),
      pricePesos:             new FormControl(0, { nonNullable: true, validators: [Validators.min(0)] }),
      categoryId:             new FormControl<number | null>(null, { validators: [Validators.required] }),
      isAvailable:            new FormControl(true, { nonNullable: true }),
      trackStock:             new FormControl(false, { nonNullable: true }),
      currentStock:           new FormControl(0, { nonNullable: true, validators: [Validators.min(0)] }),
      lowStockThreshold:      new FormControl(0, { nonNullable: true, validators: [Validators.min(0)] }),
      printingDestinationId:  new FormControl<number | null>(null),
      satProductCode:         new FormControl('', { nonNullable: true }),
      satUnitCode:            new FormControl('H87', { nonNullable: true }),
      taxRate:                new FormControl(16, { nonNullable: true }),
      isMembership:           new FormControl(false, { nonNullable: true }),
      membershipDurationDays: new FormControl(30, { nonNullable: true, validators: [Validators.min(1)] }),
      sizes:                  new FormArray<SizeFormGroup>([]),
      modifierGroups:         new FormArray<ModifierGroupForm>([]),
    });
  }

  /**
   * Clears the productForm back to empty defaults.
   * `reset()` alone does not clear FormArrays, so we also wipe sizes
   * and modifierGroups explicitly.
   */
  private resetProductForm(): void {
    this.productForm.reset({
      name: '',
      barcode: '',
      description: '',
      pricePesos: 0,
      categoryId: null,
      isAvailable: true,
      trackStock: false,
      currentStock: 0,
      lowStockThreshold: 0,
      printingDestinationId: null,
      satProductCode: '',
      satUnitCode: 'H87',
      taxRate: 16,
      isMembership: false,
      membershipDurationDays: 30,
    });
    this.sizesForm.clear();
    this.modifierGroupsForm.clear();
  }

  /** Builds a reactive FormGroup for a single product size */
  private buildSizeForm(size?: { id?: number; label: string; priceDeltaCents: number }): SizeFormGroup {
    return new FormGroup({
      id:              new FormControl<number | null>(size?.id ?? null),
      label:           new FormControl(size?.label ?? '', {
        nonNullable: true,
        validators: [Validators.required],
      }),
      priceDeltaPesos: new FormControl((size?.priceDeltaCents ?? 0) / 100, { nonNullable: true }),
    });
  }

  addSize(): void {
    this.sizesForm.push(this.buildSizeForm());
  }

  removeSize(index: number): void {
    this.sizesForm.removeAt(index);
  }

  //#endregion

  //#region Modifier Groups — reactive form helpers

  /** Builds a reactive FormGroup for a single modifier group */
  private buildGroupForm(group?: ProductModifierGroup): ModifierGroupForm {
    const extrasArray = new FormArray<ModifierExtraForm>(
      (group?.extras ?? []).map(e => this.buildExtraForm(e)),
    );
    return new FormGroup(
      {
        id:            new FormControl<number | null>(group?.id ?? null),
        name:          new FormControl(group?.name ?? '', {
          nonNullable: true,
          validators: [Validators.required],
        }),
        sortOrder:     new FormControl(group?.sortOrder ?? 0, { nonNullable: true }),
        isRequired:    new FormControl(group?.isRequired ?? false, { nonNullable: true }),
        minSelectable: new FormControl(group?.minSelectable ?? 0, { nonNullable: true }),
        maxSelectable: new FormControl(group?.maxSelectable ?? 0, { nonNullable: true }),
        extras:        extrasArray,
      },
      { validators: [modifierGroupMinMaxValidator] },
    );
  }

  /** Builds a reactive FormGroup for a single extra inside a group */
  private buildExtraForm(extra?: ProductExtra): ModifierExtraForm {
    return new FormGroup({
      id:         new FormControl<number | null>(extra?.id ?? null),
      label:      new FormControl(extra?.label ?? '', {
        nonNullable: true,
        validators: [Validators.required],
      }),
      pricePesos: new FormControl((extra?.priceCents ?? 0) / 100, { nonNullable: true }),
      sortOrder:  new FormControl(0, { nonNullable: true }),
    });
  }

  /** Appends a new empty group to the end of the list */
  addGroup(): void {
    this.modifierGroupsForm.push(this.buildGroupForm({
      id: 0,
      name: '',
      sortOrder: this.modifierGroupsForm.length,
      isRequired: false,
      minSelectable: 0,
      maxSelectable: 0,
      extras: [],
    }));
  }

  /** Removes the group at the given index */
  removeGroup(groupIndex: number): void {
    this.modifierGroupsForm.removeAt(groupIndex);
  }

  /** Returns the FormArray of extras for a given group — used by the template */
  extrasArrayForGroup(groupIndex: number): FormArray<ModifierExtraForm> {
    return this.modifierGroupsForm.at(groupIndex).controls.extras;
  }

  /** Appends a new empty extra to the specified group */
  addExtraToGroup(groupIndex: number): void {
    this.extrasArrayForGroup(groupIndex).push(this.buildExtraForm());
  }

  /** Removes an extra by (group, extra) index tuple */
  removeExtraFromGroup(groupIndex: number, extraIndex: number): void {
    this.extrasArrayForGroup(groupIndex).removeAt(extraIndex);
  }

  /** Total number of extras across all groups — used for the tab badge */
  totalExtrasCount(): number {
    return this.modifierGroupsForm.controls
      .reduce((sum, g) => sum + g.controls.extras.length, 0);
  }

  //#endregion

}
