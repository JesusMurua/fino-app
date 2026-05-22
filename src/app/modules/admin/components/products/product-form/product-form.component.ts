import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
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
import { ToastModule } from 'primeng/toast';
import { TooltipModule } from 'primeng/tooltip';
import { MessageService } from 'primeng/api';

import {
  Category,
  Product,
  ProductExtra,
  ProductImage,
  ProductMetadata,
  ProductModifierGroup,
  ProductType,
  SAT_UNIT_OPTIONS,
} from '../../../../../core/models';
import { FeatureKey, MacroCategoryType } from '../../../../../core/enums';
import { DatabaseService } from '../../../../../core/services/database.service';
import { ProductService, SaveProductDto } from '../../../../../core/services/product.service';
import { ScannerService } from '../../../../../core/services/scanner.service';
import { PrinterDestinationService } from '../../../../../core/services/printer-destination.service';
import { TaxService } from '../../../../../core/services/tax.service';
import { TenantContextService } from '../../../../../core/services/tenant-context.service';
import { getHttpErrorSummary } from '../../../../../core/utils/http-error.utils';
import { placeholdersFor } from './product-form.placeholders';

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
  /** Strong classification — drives POS branching (weight, recipe, etc.) */
  type:                   FormControl<ProductType>;
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
  taxRate:                FormControl<number | null>;
  isTaxIncluded:          FormControl<boolean>;
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
    CommonModule,
    ReactiveFormsModule,
    ButtonModule,
    DropdownModule,
    InputNumberModule,
    InputSwitchModule,
    InputTextModule,
    InputTextareaModule,
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
  readonly tenantContext = inject(TenantContextService);
  readonly printerDestinationService = inject(PrinterDestinationService);

  /** Exposed to the template so structural directives can compare against macros */
  readonly MacroCategoryType = MacroCategoryType;

  /**
   * True when the current tenant sells subscription / membership products
   * (gym mensualidades, spa packages, etc.). Delegated to
   * `TenantContextService.supportsMemberships` so the capability is
   * defined in a single declarative place rather than re-derived from
   * the macro per component (AUDIT-058 Vector A).
   */
  readonly showsMembership = this.tenantContext.supportsMemberships;

  /**
   * Vertical-aware placeholder copy. Keyed off the tenant's `posExperience`
   * (resolved from the business type) via the `POS_EXPERIENCE_PLACEHOLDERS`
   * catalog — adding a new vertical now means adding ONE catalog entry,
   * not chasing three twin-switches across this file.
   *
   * `placeholdersFor()` applies a Restaurant fallback while
   * `posExperience()` is still undefined during cold-boot hydration.
   */
  readonly namePlaceholder = computed(
    () => placeholdersFor(this.tenantContext.posExperience()).name,
  );

  readonly modifierGroupPlaceholder = computed(
    () => placeholdersFor(this.tenantContext.posExperience()).modifierGroup,
  );

  readonly modifierExtraPlaceholder = computed(
    () => placeholdersFor(this.tenantContext.posExperience()).modifierExtra,
  );

  /** Maximum number of images allowed per product */
  static readonly MAX_IMAGES = 5;

  /** Categories available for the dropdown — read from Dexie on init */
  readonly categories = signal<Category[]>([]);

  /** Edit mode tracking — null in create mode */
  readonly editingProduct = signal<Product | null>(null);

  /** True while the save POST/PUT is in flight */
  readonly savingProduct = signal(false);

  /** Images attached to the product (edit mode only) */
  readonly productImages = signal<ProductImage[]>([]);

  /** True while an image upload is in progress */
  readonly uploadingImage = signal(false);

  /**
   * Files staged in create mode. Uploaded sequentially after the
   * `createProduct` POST returns the new product `id`. In edit mode
   * uploads happen inline and this signal stays empty.
   */
  readonly pendingImageFiles = signal<File[]>([]);

  /**
   * Object URL for the first pending file — used to render an inline
   * preview before the product is saved. Managed manually in the
   * add/remove handlers and revoked in `ngOnDestroy` to avoid leaks.
   */
  readonly pendingPreviewUrl = signal<string | null>(null);

  /** True while iterating `pendingImageFiles` post-save */
  readonly uploadingPendingImages = signal(false);

  /**
   * Which collapsible sections are open. Drives `[attr.open]` on the
   * `<details>` elements; the `(toggle)` event syncs back so user clicks
   * stay reflected in the signal.
   */
  readonly expandedSections = signal<Set<string>>(
    new Set(['identity', 'price']),
  );

  /**
   * Whether the Modificadores section is shown for this tenant. Visible
   * for tenants whose vertical preps food (F&B / QuickService) or whose
   * branch flag has a kitchen — the same gate the original tab used.
   */
  readonly hasModifiersSection = computed(() => {
    if (this.tenantContext.hasKitchen()) return true;
    const macro = this.tenantContext.currentMacro();
    return macro === MacroCategoryType.FoodBeverage
      || macro === MacroCategoryType.QuickService;
  });

  /** Whether the Datos fiscales section is shown — gated by CFDI feature. */
  readonly hasFiscalSection = computed(() =>
    this.tenantContext.hasFeature(FeatureKey.CfdiInvoicing),
  );

  /** Full reactive form for the page */
  readonly productForm: ProductFormGroup = this.buildProductForm();

  /** Dropdown options for the product type picker. */
  readonly productTypes: ReadonlyArray<{ label: string; value: ProductType }> = [
    { label: 'Estándar',                       value: 'Standard' },
    { label: 'Inventario por Pieza',           value: 'TrackedByUnit' },
    { label: 'Inventario Medible (Peso/Vol./Long.)',  value: 'TrackedByMeasure' },
    { label: 'Receta',                         value: 'Recipe' },
    { label: 'Servicio',                       value: 'Service' },
    { label: 'Membresía',                      value: 'Membership' },
  ];

  /**
   * Reactive snapshot of the form's value. Wraps `productForm.valueChanges`
   * so `previewProduct` re-runs on every keystroke. Declared AFTER
   * `productForm` so the property initializer runs in the right order.
   */
  private readonly formValue = toSignal(this.productForm.valueChanges, {
    initialValue: this.productForm.getRawValue(),
  });

  /**
   * Image source for the preview card. Uses the first uploaded image in
   * edit mode and the staged pending blob URL in create mode.
   */
  readonly previewImageUrl = computed<string | null>(() => {
    const uploaded = this.productImages();
    if (uploaded.length > 0) return uploaded[0].url;
    return this.pendingPreviewUrl();
  });

  /**
   * Live preview model — reads from the form snapshot + image signals so
   * the preview column updates in real time as the user types.
   */
  readonly previewProduct = computed(() => {
    const v = this.formValue();
    const categoryName = this.categories().find(c => c.id === v.categoryId)?.name ?? '';
    return {
      name: (v.name ?? '').trim(),
      category: categoryName,
      barcode: (v.barcode ?? '').trim(),
      pricePesos: v.pricePesos ?? 0,
      isAvailable: v.isAvailable ?? true,
      currentStock: v.currentStock ?? 0,
      isMembership: v.isMembership ?? false,
      membershipDays: v.membershipDurationDays ?? 0,
      image: this.previewImageUrl(),
    };
  });

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

  /** Inject the tax catalog so the dropdown reflects live backend data */
  readonly taxService = inject(TaxService);

  /**
   * Dropdown label for the "Usar el del negocio" first option. Degraded
   * microcopy rule:
   *   - catalog still loading → "Usar el del negocio"
   *   - business has no defaultTaxId → "(sin configurar — ve a Configuración → Fiscal)"
   *   - default resolved → "(X%)"
   * See AUDIT-053.
   */
  readonly defaultBusinessOptionLabel = computed<string>(() => {
    if (this.taxService.isLoading()) return 'Usar el del negocio';
    const settings = this.tenantContext.business();
    const id = settings?.defaultTaxId ?? null;
    if (id === null) {
      return 'Usar el del negocio (sin configurar — ve a Configuración → Fiscal)';
    }
    const tax = this.taxService.findById(id);
    if (!tax || tax.ratePercent === undefined) return 'Usar el del negocio';
    return `Usar el del negocio (${tax.ratePercent}%)`;
  });

  /**
   * Dropdown options bound to the `taxRate` form control. The first
   * entry has `value: null` so picking it persists `taxRate: undefined`
   * on the product (= "use whatever the business default is at sale
   * time"). Subsequent entries come from the live tax catalog and
   * carry the integer `ratePercent` so the existing `cart.service`
   * math keeps working untouched.
   */
  readonly taxRateOptions = computed(() => [
    { value: null as number | null, label: this.defaultBusinessOptionLabel() },
    ...this.taxService.catalog().map(t => ({
      value: t.ratePercent ?? null,
      label: t.name,
    })),
  ]);

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
    // Hydrate categories + printer destinations + tax catalog in parallel.
    // `ensureHydrated()` is idempotent (cached promise) so it's free if
    // login already kicked it off.
    const [categories] = await Promise.all([
      this.db.categories.orderBy('sortOrder').toArray(),
      this.printerDestinationService.loadFromLocal(),
      this.tenantContext.ensureHydrated(),
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

    // Revoke any blob URL we created for the pending image preview so
    // we do not leak memory on long-lived sessions.
    const pendingUrl = this.pendingPreviewUrl();
    if (pendingUrl) URL.revokeObjectURL(pendingUrl);
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

    // Derive membership flags from typed `ProductMetadata`. A falsy or
    // missing value collapses to 0 → "not a membership".
    const membershipDays = product.metadata?.membershipDurationDays ?? 0;

    this.productForm.patchValue({
      name:                   product.name,
      type:                   product.type,
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
      // null → "Usar el del negocio" (backend resolves with tenant default)
      taxRate:                product.taxRate ?? null,
      // Mexican standard: prices include tax. Force `true` if the
      // legacy product has `undefined` so the toggle has a deterministic
      // state and the field gets persisted explicitly on save.
      isTaxIncluded:          product.isTaxIncluded ?? true,
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
      type: raw.type,
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
      // null → "Usar el del negocio" (backend default applies on sale)
      taxRate: raw.taxRate ?? undefined,
      isTaxIncluded: raw.isTaxIncluded,
      printingDestinationId: raw.printingDestinationId,
      metadata: this.composeMetadata(raw.isMembership, raw.membershipDurationDays, editing?.metadata),
    };
    const save$ = isEdit
      ? this.productService.updateProduct(editing!.id, dto, editing!)
      : this.productService.createProduct(dto);

    this.savingProduct.set(true);
    save$.subscribe({
      next: async (saved) => {
        // Upload any pending images BEFORE navigating away. The progress
        // signal drives a thin progress bar in the form so the user sees
        // the upload happening; the create-success toast already fired
        // for the product itself, so we add a second toast only on
        // upload failure.
        if (!isEdit && this.pendingImageFiles().length > 0) {
          await this.uploadPendingImages(saved.id);
        }

        this.savingProduct.set(false);
        this.messageService.add({
          severity: 'success',
          summary: isEdit ? 'Producto actualizado' : 'Producto creado',
          life: 3000,
        });

        if (isEdit) {
          this.router.navigate(['/admin/products']);
        } else {
          // Land on the edit page so the user can add more images right away
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
   * Sequentially uploads every staged file to the freshly-created
   * product. Failures are logged but don't block navigation — the
   * product itself was created successfully and the user can re-attach
   * images from the edit page.
   */
  private async uploadPendingImages(productId: number): Promise<void> {
    const files = this.pendingImageFiles();
    if (files.length === 0) return;

    this.uploadingPendingImages.set(true);
    try {
      const uploaded: ProductImage[] = [];
      for (const file of files) {
        try {
          const image = await this.productService.uploadProductImage(productId, file);
          uploaded.push(image);
        } catch (e) {
          console.warn('Pending image upload failed:', e);
        }
      }

      if (uploaded.length > 0) {
        // Persist + reflect in the local signal so the edit-mode landing
        // page renders the freshly-uploaded gallery without a refetch.
        this.productImages.set(uploaded);
        await this.db.products.update(productId, { images: uploaded });
      }
    } finally {
      // Always clear the staging buffer + revoke blob URL, even if
      // some uploads failed.
      const blobUrl = this.pendingPreviewUrl();
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      this.pendingPreviewUrl.set(null);
      this.pendingImageFiles.set([]);
      this.uploadingPendingImages.set(false);
    }
  }

  /**
   * Composes the typed `ProductMetadata` payload preserving any keys
   * the form does not own (forwards-compatible: a future release may
   * add new vertical keys this form does not yet render).
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
    existing: ProductMetadata | undefined,
  ): ProductMetadata | undefined {
    const next: ProductMetadata = { ...(existing ?? {}) };

    if (isMembership && days > 0) {
      next.membershipDurationDays = days;
    } else {
      delete next.membershipDurationDays;
    }

    return Object.keys(next).length > 0 ? next : undefined;
  }

  //#endregion

  //#region Images

  /**
   * Total image slots used — uploaded + pending. Drives the "max 5"
   * gate that hides the add button when capacity is reached.
   */
  imageSlotCount(): number {
    return this.productImages().length + this.pendingImageFiles().length;
  }

  /**
   * Handles image file selection. Splits behavior by mode:
   *   - Edit: upload immediately to the existing product, persist to Dexie.
   *   - Create: stage in `pendingImageFiles` and refresh the blob preview;
   *             actual upload runs after `createProduct` returns the new id.
   */
  async onImageSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length) return;

    const file = input.files[0];
    if (this.imageSlotCount() >= ProductFormComponent.MAX_IMAGES) {
      input.value = '';
      return;
    }

    const editing = this.editingProduct();

    if (editing) {
      // Edit mode — upload right away
      this.uploadingImage.set(true);
      try {
        const image = await this.productService.uploadProductImage(editing.id, file);
        const updatedImages = [...this.productImages(), image];
        this.productImages.set(updatedImages);
        await this.db.products.update(editing.id, { images: updatedImages });
      } catch (e) {
        console.warn('Image upload failed:', e);
      } finally {
        this.uploadingImage.set(false);
        input.value = '';
      }
      return;
    }

    // Create mode — stage and refresh preview blob URL
    this.addPendingImage(file);
    input.value = '';
  }

  /** Stages a file for upload after the product is created. */
  private addPendingImage(file: File): void {
    this.pendingImageFiles.update(arr => [...arr, file]);
    // Show the just-staged file in the preview if we don't already
    // have one. Revoke the previous URL when we replace it.
    if (this.pendingPreviewUrl() === null && this.productImages().length === 0) {
      this.pendingPreviewUrl.set(URL.createObjectURL(file));
    }
  }

  /** Removes a staged file (create mode only). */
  removePendingImage(index: number): void {
    const before = this.pendingImageFiles();
    if (index < 0 || index >= before.length) return;

    this.pendingImageFiles.set(before.filter((_, i) => i !== index));

    // If the removed file was the one driving the preview blob, rebuild.
    if (index === 0) {
      const prev = this.pendingPreviewUrl();
      if (prev) URL.revokeObjectURL(prev);
      const remaining = this.pendingImageFiles();
      this.pendingPreviewUrl.set(
        remaining.length > 0 ? URL.createObjectURL(remaining[0]) : null,
      );
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

  //#region Section Collapsibles

  /** True when a section's `<details>` is currently open. */
  isSectionOpen(id: string): boolean {
    return this.expandedSections().has(id);
  }

  /**
   * Sync handler for the native `(toggle)` event of `<details>`. Reads
   * the current open state from the element and mirrors it into the
   * signal so programmatic checks (and persistence, if added later)
   * stay in sync with the user's clicks.
   */
  onSectionToggle(id: string, event: Event): void {
    const el = event.target as HTMLDetailsElement;
    this.expandedSections.update(set => {
      const next = new Set(set);
      if (el.open) next.add(id);
      else next.delete(id);
      return next;
    });
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
      type:                   new FormControl<ProductType>('Standard', { nonNullable: true, validators: [Validators.required] }),
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
      // Default: null → "Usar el del negocio" (tenant default applies)
      taxRate:                new FormControl<number | null>(null),
      // Mexican standard: prices include tax. The toggle in the form
      // lets B2B / non-tax-inclusive sellers flip it off.
      isTaxIncluded:          new FormControl(true, { nonNullable: true }),
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
      type: 'Standard',
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
      taxRate: null,
      isTaxIncluded: true,
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
