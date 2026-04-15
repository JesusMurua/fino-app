import { Component, OnInit, computed, effect, inject, signal } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import {
  AbstractControl,
  FormArray,
  FormControl,
  FormGroup,
  FormsModule,
  ReactiveFormsModule,
  ValidationErrors,
  ValidatorFn,
  Validators,
} from '@angular/forms';
import { Subscription } from 'rxjs';

import { DialogModule } from 'primeng/dialog';
import { DropdownModule } from 'primeng/dropdown';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputSwitchModule } from 'primeng/inputswitch';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { TableModule } from 'primeng/table';
import { TabViewModule } from 'primeng/tabview';
import { RadioButtonModule } from 'primeng/radiobutton';
import { TooltipModule } from 'primeng/tooltip';
import { InputTextareaModule } from 'primeng/inputtextarea';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ToastModule } from 'primeng/toast';
import { ConfirmationService, MessageService } from 'primeng/api';

import { Category, DiscountPreset, InventoryItem, InventoryMovement, IVA_RATE_OPTIONS, Product, ProductConsumption, ProductExtra, ProductImage, ProductImportPreview, ProductImportResult, ProductModifierGroup, SAT_UNIT_OPTIONS } from '../../../../core/models';
import { InventoryMovementType, INVENTORY_MOVEMENT_TYPE_LABELS, INVENTORY_MOVEMENT_TYPE_CLASSES } from '../../../../core/enums';
import { DatabaseService } from '../../../../core/services/database.service';
import { ProductService, SaveProductDto } from '../../../../core/services/product.service';
import { ProductCategoryService } from '../../../../core/services/product-category.service';
import { DiscountService } from '../../../../core/services/discount.service';
import { InventoryService } from '../../../../core/services/inventory.service';
import { InventoryConsumptionService } from '../../../../core/services/inventory-consumption.service';
import { ProductImportService } from '../../../../core/services/product-import.service';
import { AuthService } from '../../../../core/services/auth.service';
import { ScannerService } from '../../../../core/services/scanner.service';
import { PrinterDestinationService } from '../../../../core/services/printer-destination.service';
import { PricePipe } from '../../../../shared/pipes/price.pipe';

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
 * The full reactive form for the product create/edit dialog.
 * Single source of truth — every field in the dialog is bound via
 * formControlName into this tree.
 */
type ProductFormGroup = FormGroup<{
  name:                  FormControl<string>;
  barcode:               FormControl<string>;
  description:           FormControl<string>;
  pricePesos:            FormControl<number>;
  categoryId:            FormControl<number | null>;
  isAvailable:           FormControl<boolean>;
  trackStock:            FormControl<boolean>;
  currentStock:          FormControl<number>;
  lowStockThreshold:     FormControl<number>;
  printingDestinationId: FormControl<number | null>;
  satProductCode:        FormControl<string>;
  satUnitCode:           FormControl<string>;
  taxRate:               FormControl<number>;
  sizes:                 FormArray<SizeFormGroup>;
  modifierGroups:        FormArray<ModifierGroupForm>;
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

/** Shape of the category form used in the create/edit dialog */
interface CategoryForm {
  name: string;
  icon: string;
  isActive: boolean;
}

/** Shape of the discount form used in the create/edit dialog */
interface DiscountForm {
  name: string;
  type: 'percent' | 'fixed';
  value: number;
  isActive: boolean;
}

@Component({
  selector: 'app-admin-products',
  standalone: true,
  imports: [
    ButtonModule,
    CurrencyPipe,
    DatePipe,
    FormsModule,
    ReactiveFormsModule,
    DialogModule,
    DropdownModule,
    InputNumberModule,
    InputSwitchModule,
    InputTextModule,
    TableModule,
    TabViewModule,
    TooltipModule,
    InputTextareaModule,
    PricePipe,
    RadioButtonModule,
    ConfirmDialogModule,
    ToastModule,
  ],
  templateUrl: './admin-products.component.html',
  styleUrl: './admin-products.component.scss',
  providers: [ConfirmationService, MessageService],
})
export class AdminProductsComponent implements OnInit {

  //#region Properties

  readonly products = signal<Product[]>([]);
  readonly categories = signal<Category[]>([]);
  readonly isLoading = signal(true);
  readonly savingProduct = signal(false);
  readonly savingCategory = signal(false);

  // ---- Product dialog ----
  dialogVisible = false;
  editingProduct: Product | null = null;
  dialogTabIndex = 0;
  showImageTab = false;

  /** Full reactive form for the product create/edit dialog */
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

  // ---- Category dialog ----
  catDialogVisible = false;
  editingCategory: Category | null = null;
  catForm: CategoryForm = this.emptyCatForm();
  readonly catError = signal('');

  // ---- Discount dialog ----
  readonly discountPresets = signal<DiscountPreset[]>([]);
  readonly loadingDiscounts = signal(false);
  discountDialogVisible = false;
  editingDiscount: DiscountPreset | null = null;
  discountForm: DiscountForm = this.emptyDiscountForm();

  // ---- Import dialog ----
  readonly showImportDialog = signal(false);
  readonly importStep = signal<'upload' | 'preview' | 'success'>('upload');
  readonly importPreview = signal<ProductImportPreview | null>(null);
  readonly importResult = signal<ProductImportResult | null>(null);
  readonly loadingImport = signal(false);
  readonly selectedFile = signal<File | null>(null);

  // ---- Consumption dialog ----
  readonly showConsumptionDialog = signal(false);
  readonly consumptionProduct = signal<Product | null>(null);
  readonly consumptions = signal<ProductConsumption[]>([]);
  readonly inventoryItems = signal<InventoryItem[]>([]);
  readonly loadingConsumptions = signal(false);
  selectedInventoryItemId: number | null = null;
  consumptionQuantity = 1;

  // ---- Product movement history dialog ----
  readonly showMovementDialog = signal(false);
  readonly movementProduct = signal<Product | null>(null);
  readonly productMovements = signal<InventoryMovement[]>([]);
  readonly loadingMovements = signal(false);

  // ---- Product images (edit mode only) ----
  readonly productImages = signal<ProductImage[]>([]);
  readonly uploadingImage = signal(false);
  static readonly MAX_IMAGES = 5;

  // ---- Barcode scanner ----
  private scanSubscription?: Subscription;

  /** Available PrimeIcons for category selection */
  readonly iconOptions: { label: string; value: string }[] = [
    { label: 'Caja',     value: 'pi-box' },
    { label: 'Estrella', value: 'pi-star' },
    { label: 'Corazón',  value: 'pi-heart' },
    { label: 'Filtro',   value: 'pi-filter' },
    { label: 'Etiqueta', value: 'pi-tag' },
    { label: 'Bolsa',    value: 'pi-shopping-bag' },
    { label: 'Café',     value: 'pi-coffee' },
    { label: 'Casa',     value: 'pi-home' },
    { label: 'Marcador', value: 'pi-bookmark' },
    { label: 'Regalo',   value: 'pi-gift' },
    { label: 'Manzana',  value: 'pi-apple' },
    { label: 'Imagen',   value: 'pi-image' },
  ];

  //#endregion

  //#region Constructor
  constructor(
    private readonly db: DatabaseService,
    private readonly productService: ProductService,
    private readonly discountService: DiscountService,
    private readonly confirmationService: ConfirmationService,
    private readonly productImportService: ProductImportService,
    private readonly inventoryService: InventoryService,
    private readonly consumptionService: InventoryConsumptionService,
    private readonly categoryService: ProductCategoryService,
    private readonly messageService: MessageService,
    private readonly authService: AuthService,
    private readonly scannerService: ScannerService,
    readonly printerDestinationService: PrinterDestinationService,
  ) {
    effect(() => {
      const branchId = this.authService.activeBranchId();
      if (branchId) { this.loadData(); this.loadDiscounts(); }
    }, { allowSignalWrites: true });
  }
  //#endregion

  //#region Lifecycle

  async ngOnInit(): Promise<void> {
    await Promise.all([
      this.loadData(),
      this.loadDiscounts(),
      this.printerDestinationService.loadFromLocal(),
    ]);
  }

  //#endregion

  //#region Data Loading

  private async loadData(): Promise<void> {
    this.isLoading.set(true);
    const [products, categories] = await Promise.all([
      this.db.products.toArray(),
      this.db.categories.orderBy('sortOrder').toArray(),
    ]);
    this.products.set(products);
    this.categories.set(categories);
    this.isLoading.set(false);
  }

  //#endregion

  //#region Product Dialog

  openCreate(): void {
    this.editingProduct = null;
    this.resetProductForm();
    this.productImages.set([]);
    this.dialogTabIndex = 0;
    this.showImageTab = false;
    this.dialogVisible = true;
  }

  openEdit(product: Product): void {
    this.editingProduct = product;
    this.resetProductForm();

    this.productForm.patchValue({
      name:                  product.name,
      barcode:               product.barcode ?? '',
      description:           product.description ?? '',
      pricePesos:            product.priceCents / 100,
      categoryId:            product.categoryId,
      isAvailable:           product.isAvailable,
      trackStock:            product.trackStock ?? false,
      currentStock:          product.currentStock ?? 0,
      lowStockThreshold:     product.lowStockThreshold ?? 0,
      printingDestinationId: product.printingDestinationId ?? null,
      satProductCode:        product.satProductCode ?? '',
      satUnitCode:           product.satUnitCode ?? 'H87',
      taxRate:               product.taxRate ?? 16,
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
    this.dialogTabIndex = 0;
    this.showImageTab = false;
    setTimeout(() => this.showImageTab = true, 0);
    this.dialogVisible = true;
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
    });
    this.sizesForm.clear();
    this.modifierGroupsForm.clear();
  }

  closeDialog(): void {
    this.scanSubscription?.unsubscribe();
    this.scanSubscription = undefined;
    this.scannerService.stopListening();
    this.dialogVisible = false;
  }

  //#endregion

  //#region Product CRUD

  /**
   * Saves the product with strict pessimistic UI: the backend call must
   * succeed before the local cache is updated. On failure the dialog
   * stays open so the user can retry or edit.
   */
  saveProduct(): void {
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
          .map((e, ei) => ({
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
    };

    const isEdit = !!this.editingProduct;
    const save$ = isEdit
      ? this.productService.updateProduct(this.editingProduct!.id, dto, this.editingProduct!)
      : this.productService.createProduct(dto);

    this.savingProduct.set(true);
    save$.subscribe({
      next: async () => {
        this.savingProduct.set(false);
        this.messageService.add({
          severity: 'success',
          summary: isEdit ? 'Producto actualizado' : 'Producto creado',
          life: 3000,
        });
        this.dialogVisible = false;
        await this.loadData();
      },
      error: (err) => {
        this.savingProduct.set(false);
        this.messageService.add({
          severity: 'error',
          summary: this.errorSummary(err),
          detail: 'No se pudo guardar el producto. Revisa los datos e inténtalo de nuevo.',
          life: 5000,
        });
      },
    });
  }

  /** Handles image file selection and uploads to the API */
  async onImageSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length || !this.editingProduct) return;
    if (this.productImages().length >= AdminProductsComponent.MAX_IMAGES) return;

    this.uploadingImage.set(true);
    try {
      const image = await this.productService.uploadProductImage(
        this.editingProduct.id, input.files[0],
      );
      const updatedImages = [...this.productImages(), image];
      this.productImages.set(updatedImages);
      // Persist images to Dexie so they load on next dialog open
      await this.db.products.update(this.editingProduct.id, { images: updatedImages });
    } catch (e) {
      console.warn('Image upload failed:', e);
    } finally {
      this.uploadingImage.set(false);
      input.value = '';
    }
  }

  /** Deletes a product image from the API */
  async deleteImage(imageId: number): Promise<void> {
    if (!this.editingProduct) return;
    try {
      await this.productService.deleteProductImage(this.editingProduct.id, imageId);
      const updatedImages = this.productImages().filter(i => i.id !== imageId);
      this.productImages.set(updatedImages);
      // Persist to Dexie so removal is reflected on next dialog open
      await this.db.products.update(this.editingProduct.id, { images: updatedImages });
    } catch (e) {
      console.warn('Image delete failed:', e);
    }
  }

  async toggleActive(product: Product): Promise<void> {
    await this.db.products.update(product.id, { isAvailable: !product.isAvailable });
    await this.loadData();
  }

  //#endregion

  //#region Category Dialog

  openCreateCategory(): void {
    this.editingCategory = null;
    this.catForm = this.emptyCatForm();
    this.catError.set('');
    this.catDialogVisible = true;
  }

  openEditCategory(cat: Category): void {
    this.editingCategory = cat;
    this.catForm = {
      name: cat.name,
      icon: cat.icon ?? 'pi-tag',
      isActive: cat.isActive,
    };
    this.catError.set('');
    this.catDialogVisible = true;
  }

  closeCatDialog(): void {
    this.catDialogVisible = false;
  }

  //#endregion

  //#region Category CRUD

  /**
   * Saves the category with strict pessimistic UI: the backend must confirm
   * before the local cache is updated. Dialog stays open on failure.
   */
  saveCategory(): void {
    if (!this.catForm.name.trim()) return;

    const isEdit = !!this.editingCategory;
    const save$ = isEdit
      ? this.categoryService.update(this.editingCategory!.id, {
          name: this.catForm.name.trim(),
          icon: this.catForm.icon,
          sortOrder: this.editingCategory!.sortOrder,
          isActive: this.catForm.isActive,
        })
      : this.categoryService.create({
          name: this.catForm.name.trim(),
          icon: this.catForm.icon,
          sortOrder: Math.max(0, ...this.categories().map(c => c.sortOrder)) + 1,
          isActive: this.catForm.isActive,
        });

    this.savingCategory.set(true);
    save$.subscribe({
      next: async () => {
        this.savingCategory.set(false);
        this.messageService.add({
          severity: 'success',
          summary: isEdit ? 'Categoría actualizada' : 'Categoría creada',
          life: 3000,
        });
        this.catDialogVisible = false;
        await this.loadData();
      },
      error: (err) => {
        this.savingCategory.set(false);
        this.catError.set('No se pudo guardar la categoría.');
        this.messageService.add({
          severity: 'error',
          summary: this.errorSummary(err),
          detail: 'No se pudo guardar la categoría. Revisa los datos e inténtalo de nuevo.',
          life: 5000,
        });
      },
    });
  }

  async toggleCategoryActive(cat: Category): Promise<void> {
    await this.db.categories.update(cat.id, { isActive: !cat.isActive });
    await this.loadData();
  }

  /** Deletes a category only if it has no active products */
  async deleteCategory(cat: Category): Promise<void> {
    this.catError.set('');

    const activeCount = await this.db.products
      .where('categoryId').equals(cat.id)
      .and(p => p.isAvailable)
      .count();

    if (activeCount > 0) {
      this.catError.set(
        `No se puede eliminar "${cat.name}": tiene ${activeCount} producto(s) activo(s).`
      );
      return;
    }

    await this.db.categories.delete(cat.id);
    await this.loadData();
  }

  //#endregion

  //#region Discount Methods

  /** Loads discount presets for current branch */
  async loadDiscounts(): Promise<void> {
    this.loadingDiscounts.set(true);
    await this.discountService.loadPresets(this.authService.branchId);
    const presets = await this.discountService.getPresets(this.authService.branchId);
    this.discountPresets.set(presets);
    this.loadingDiscounts.set(false);
  }

  /** Opens dialog to create new discount */
  openNewDiscountDialog(): void {
    this.editingDiscount = null;
    this.discountForm = this.emptyDiscountForm();
    this.discountDialogVisible = true;
  }

  /** Opens dialog to edit existing discount */
  openEditDiscountDialog(preset: DiscountPreset): void {
    this.editingDiscount = preset;
    this.discountForm = {
      name: preset.name,
      type: preset.type,
      value: preset.type === 'fixed' ? preset.value / 100 : preset.value,
      isActive: preset.isActive,
    };
    this.discountDialogVisible = true;
  }

  /** Saves discount (create or update) */
  async saveDiscount(): Promise<void> {
    if (!this.discountForm.name.trim()) return;

    const value = this.discountForm.type === 'fixed'
      ? Math.round(this.discountForm.value * 100)
      : this.discountForm.value;

    if (this.editingDiscount) {
      await this.discountService.updatePreset(this.editingDiscount.id, {
        name: this.discountForm.name.trim(),
        type: this.discountForm.type,
        value,
        isActive: this.discountForm.isActive,
      });
    } else {
      await this.discountService.createPreset({
        branchId: this.authService.branchId,
        name: this.discountForm.name.trim(),
        type: this.discountForm.type,
        value,
        isActive: this.discountForm.isActive,
      });
    }

    this.discountDialogVisible = false;
    await this.loadDiscounts();
  }

  /** Deletes a discount preset with confirmation */
  deleteDiscount(preset: DiscountPreset): void {
    this.confirmationService.confirm({
      message: `¿Eliminar el descuento "${preset.name}"?`,
      header: 'Confirmar eliminación',
      icon: 'pi pi-trash',
      acceptLabel: 'Eliminar',
      rejectLabel: 'Cancelar',
      accept: async () => {
        await this.discountService.deletePreset(preset.id);
        await this.loadDiscounts();
      },
    });
  }

  /** Toggles discount active state */
  async toggleDiscountActive(preset: DiscountPreset): Promise<void> {
    await this.discountService.updatePreset(preset.id, { isActive: !preset.isActive });
    await this.loadDiscounts();
  }

  /** Handles value change for discount form (pesos → stored value) */
  onDiscountValueChange(value: number | null): void {
    this.discountForm.value = value ?? 0;
  }

  //#endregion

  //#region Import Methods

  /** Downloads Excel template for product import */
  async onDownloadTemplate(): Promise<void> {
    try {
      await this.productImportService.downloadTemplate();
    } catch {
      console.error('Error downloading template');
    }
  }

  /** Handles file selection from input */
  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files?.length) {
      this.selectedFile.set(input.files[0]);
    }
  }

  /** Sends file to API for preview validation */
  async onPreviewImport(): Promise<void> {
    if (!this.selectedFile()) return;
    this.loadingImport.set(true);
    try {
      const result = await this.productImportService.previewImport(
        this.selectedFile()!, this.authService.branchId
      );
      this.importPreview.set(result);
      this.importStep.set('preview');
    } catch {
      console.error('Error previewing import');
    } finally {
      this.loadingImport.set(false);
    }
  }

  /** Executes import with previewed rows */
  async onExecuteImport(): Promise<void> {
    if (!this.importPreview()?.validRows.length) return;
    this.loadingImport.set(true);
    try {
      const result = await this.productImportService.executeImport(
        this.importPreview()!.validRows, this.authService.branchId
      );
      this.importResult.set(result);
      await this.db.products.clear();
      await this.db.categories.clear();
      await this.productService.loadCatalog();
      await this.loadData();
      this.importStep.set('success');
    } catch {
      console.error('Error executing import');
    } finally {
      this.loadingImport.set(false);
    }
  }

  /** Resets import dialog to initial state */
  resetImport(): void {
    this.importStep.set('upload');
    this.importPreview.set(null);
    this.importResult.set(null);
    this.selectedFile.set(null);
    this.showImportDialog.set(false);
  }

  //#endregion

  //#region Consumption Methods

  /** Opens consumption dialog for a product */
  async openConsumptionDialog(product: Product): Promise<void> {
    this.consumptionProduct.set(product);
    this.selectedInventoryItemId = null;
    this.consumptionQuantity = 1;
    this.showConsumptionDialog.set(true);
    await this.loadConsumptions(product.id);
    this.inventoryItems.set(this.inventoryService.items());
  }

  /** Loads consumption rules for a product */
  async loadConsumptions(productId: number): Promise<void> {
    this.loadingConsumptions.set(true);
    try {
      const list = await this.consumptionService.getByProduct(productId);
      this.consumptions.set(list);
    } catch {
      this.consumptions.set([]);
    } finally {
      this.loadingConsumptions.set(false);
    }
  }

  /** Adds a new consumption rule */
  async addConsumption(): Promise<void> {
    const product = this.consumptionProduct();
    if (!product || !this.selectedInventoryItemId || this.consumptionQuantity <= 0) return;

    await this.consumptionService.create(
      product.id,
      this.selectedInventoryItemId,
      this.consumptionQuantity,
    );
    this.selectedInventoryItemId = null;
    this.consumptionQuantity = 1;
    await this.loadConsumptions(product.id);
  }

  /** Deletes a consumption rule */
  async deleteConsumption(id: number): Promise<void> {
    const product = this.consumptionProduct();
    if (!product) return;

    await this.consumptionService.delete(id);
    await this.loadConsumptions(product.id);
  }

  /** Returns inventory item name by ID */
  inventoryItemName(id: number): string {
    return this.inventoryItems().find(i => i.id === id)?.name ?? '—';
  }

  /** Returns inventory item unit by ID */
  inventoryItemUnit(id: number): string {
    return this.inventoryItems().find(i => i.id === id)?.unit ?? '';
  }

  //#endregion

  //#region Product Movement History

  /** Opens movement history dialog for a product with trackStock */
  async openMovementDialog(product: Product): Promise<void> {
    this.movementProduct.set(product);
    this.productMovements.set([]);
    this.showMovementDialog.set(true);
    this.loadingMovements.set(true);
    this.productService.getProductMovements(product.id).subscribe({
      next: (data) => {
        this.productMovements.set(data);
        this.loadingMovements.set(false);
      },
      error: () => {
        this.productMovements.set([]);
        this.loadingMovements.set(false);
      },
    });
  }

  /** Maps an HTTP error status code to a user-friendly summary */
  private errorSummary(err: unknown): string {
    const status = (err as { status?: number })?.status;
    if (status === 401 || status === 403) return 'Error de permisos';
    if (status === 409) return 'Conflicto: el registro ya existe';
    if (status === 422 || status === 400) return 'Datos inválidos';
    if (!status) return 'Sin conexión con el servidor';
    return 'Error al guardar';
  }

  /** Returns display label for movement type */
  movementTypeLabel(type: number): string {
    return INVENTORY_MOVEMENT_TYPE_LABELS[type as InventoryMovementType] ?? String(type);
  }

  /** Returns CSS class for movement type badge */
  movementTypeSeverity(type: number): string {
    return INVENTORY_MOVEMENT_TYPE_CLASSES[type as InventoryMovementType] ?? '';
  }

  //#endregion

  //#region Barcode Scanner

  /**
   * Activates the scanner listener and fills the barcode field
   * with the first scanned code.
   */
  activateBarcodeScanner(): void {
    // Clean up any previous subscription
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

  //#region Helpers

  categoryName(id: number): string {
    return this.categories().find(c => c.id === id)?.name ?? '—';
  }

  //#region Product form — reactive builders

  /** Builds the root reactive form shape with empty defaults */
  private buildProductForm(): ProductFormGroup {
    return new FormGroup({
      name:                  new FormControl('', { nonNullable: true, validators: [Validators.required] }),
      barcode:               new FormControl('', { nonNullable: true }),
      description:           new FormControl('', { nonNullable: true }),
      pricePesos:            new FormControl(0, { nonNullable: true, validators: [Validators.min(0)] }),
      categoryId:            new FormControl<number | null>(null, { validators: [Validators.required] }),
      isAvailable:           new FormControl(true, { nonNullable: true }),
      trackStock:            new FormControl(false, { nonNullable: true }),
      currentStock:          new FormControl(0, { nonNullable: true, validators: [Validators.min(0)] }),
      lowStockThreshold:     new FormControl(0, { nonNullable: true, validators: [Validators.min(0)] }),
      printingDestinationId: new FormControl<number | null>(null),
      satProductCode:        new FormControl('', { nonNullable: true }),
      satUnitCode:           new FormControl('H87', { nonNullable: true }),
      taxRate:               new FormControl(16, { nonNullable: true }),
      sizes:                 new FormArray<SizeFormGroup>([]),
      modifierGroups:        new FormArray<ModifierGroupForm>([]),
    });
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

  private emptyCatForm(): CategoryForm {
    return { name: '', icon: 'pi-tag', isActive: true };
  }

  private emptyDiscountForm(): DiscountForm {
    return { name: '', type: 'percent', value: 0, isActive: true };
  }

  //#endregion

}
