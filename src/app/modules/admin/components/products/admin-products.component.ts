import { Component, OnInit, computed, effect, inject, signal } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import {
  FormArray,
  FormControl,
  FormGroup,
  FormsModule,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { Subscription, firstValueFrom } from 'rxjs';

import { environment } from '../../../../../environments/environment';
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
import { ConfirmationService } from 'primeng/api';

import { Category, DiscountPreset, InventoryItem, InventoryMovement, IVA_RATE_OPTIONS, Product, ProductConsumption, ProductExtra, ProductImage, ProductImportPreview, ProductImportResult, ProductModifierGroup, SAT_UNIT_OPTIONS } from '../../../../core/models';
import { InventoryMovementType, INVENTORY_MOVEMENT_TYPE_LABELS, INVENTORY_MOVEMENT_TYPE_CLASSES } from '../../../../core/enums';
import { DatabaseService } from '../../../../core/services/database.service';
import { ProductService } from '../../../../core/services/product.service';
import { DiscountService } from '../../../../core/services/discount.service';
import { InventoryService } from '../../../../core/services/inventory.service';
import { InventoryConsumptionService } from '../../../../core/services/inventory-consumption.service';
import { ProductImportService } from '../../../../core/services/product-import.service';
import { AuthService } from '../../../../core/services/auth.service';
import { ScannerService } from '../../../../core/services/scanner.service';
import { PrinterDestinationService } from '../../../../core/services/printer-destination.service';
import { PricePipe } from '../../../../shared/pipes/price.pipe';

/** Editable row for a product size inside the form */
interface ProductSizeForm {
  label: string;
  priceDeltaCents: number;
}

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

/** Shape of the product form used in the create/edit dialog */
interface ProductForm {
  name: string;
  barcode: string;
  description: string;
  priceCents: number;
  categoryId: number | null;
  isAvailable: boolean;
  trackStock: boolean;
  currentStock: number;
  lowStockThreshold: number;
  sizes: ProductSizeForm[];
  satProductCode: string;
  satUnitCode: string;
  taxRate: number;
  printingDestinationId: number | null;
}

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
  ],
  templateUrl: './admin-products.component.html',
  styleUrl: './admin-products.component.scss',
  providers: [ConfirmationService],
})
export class AdminProductsComponent implements OnInit {

  //#region Properties

  readonly products = signal<Product[]>([]);
  readonly categories = signal<Category[]>([]);
  readonly isLoading = signal(true);

  // ---- Product dialog ----
  dialogVisible = false;
  editingProduct: Product | null = null;
  form: ProductForm = this.emptyProductForm();
  dialogTabIndex = 0;
  showImageTab = false;

  /**
   * Reactive form wrapper for modifier groups. A trivial root FormGroup
   * with a single `groups` FormArray is needed so the template can bind
   * via `[formGroup]` + `formArrayName`.
   */
  readonly modifierGroupsRoot = new FormGroup<{ groups: FormArray<ModifierGroupForm> }>({
    groups: new FormArray<ModifierGroupForm>([]),
  });

  /** Convenience accessor — every consumer reads the FormArray, not the wrapper */
  get modifierGroupsForm(): FormArray<ModifierGroupForm> {
    return this.modifierGroupsRoot.controls.groups;
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
    private readonly http: HttpClient,
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
    this.form = this.emptyProductForm();
    this.modifierGroupsForm.clear();
    this.productImages.set([]);
    this.dialogTabIndex = 0;
    this.showImageTab = false;
    this.dialogVisible = true;
  }

  openEdit(product: Product): void {
    this.editingProduct = product;
    this.form = {
      name: product.name,
      barcode: product.barcode ?? '',
      description: product.description ?? '',
      priceCents: product.priceCents,
      categoryId: product.categoryId,
      isAvailable: product.isAvailable,
      trackStock: product.trackStock ?? false,
      currentStock: product.currentStock ?? 0,
      lowStockThreshold: product.lowStockThreshold ?? 0,
      sizes:  product.sizes.map(s => ({ label: s.label, priceDeltaCents: s.priceDeltaCents })),
      satProductCode: product.satProductCode ?? '',
      satUnitCode: product.satUnitCode ?? 'H87',
      taxRate: product.taxRate ?? 16,
      printingDestinationId: product.printingDestinationId ?? null,
    };

    // Rebuild the reactive modifier groups form from the product's
    // full hierarchy — no flattening, no data loss.
    this.modifierGroupsForm.clear();
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

  closeDialog(): void {
    this.scanSubscription?.unsubscribe();
    this.scanSubscription = undefined;
    this.scannerService.stopListening();
    this.dialogVisible = false;
  }

  //#endregion

  //#region Product CRUD

  /** Saves product locally in Dexie and syncs to API (best-effort) */
  async saveProduct(): Promise<void> {
    if (!this.form.name.trim() || !this.form.categoryId) return;
    if (this.modifierGroupsForm.invalid) {
      this.modifierGroupsForm.markAllAsTouched();
      return;
    }

    const sizes = this.form.sizes.filter(s => s.label.trim());

    // Read the reactive modifier groups tree and translate to the
    // ProductModifierGroup shape the backend expects.
    const modifierGroups: ProductModifierGroup[] = this.modifierGroupsForm.controls
      .map((groupCtrl, gi) => {
        const raw = groupCtrl.getRawValue();
        const extras: ProductExtra[] = raw.extras
          .filter(e => e.label.trim().length > 0)
          .map((e, ei) => ({
            id: e.id ?? 0,
            label: e.label.trim(),
            priceCents: Math.round((e.pricePesos || 0) * 100),
          }));
        return {
          id: raw.id ?? 0,
          name: raw.name.trim(),
          sortOrder: raw.sortOrder ?? gi,
          isRequired: raw.isRequired,
          minSelectable: raw.minSelectable ?? 0,
          maxSelectable: raw.maxSelectable ?? 0,
          extras,
        };
      })
      // Drop groups with empty names or no extras — they are meaningless
      // to both the POS UI and the backend.
      .filter(g => g.name.length > 0 && g.extras.length > 0);

    const payload = {
      name: this.form.name.trim(),
      barcode: this.form.barcode.trim() || undefined,
      description: this.form.description.trim() || undefined,
      priceCents: this.form.priceCents,
      categoryId: this.form.categoryId,
      isAvailable: this.form.isAvailable,
      trackStock: this.form.trackStock,
      currentStock: this.form.trackStock ? this.form.currentStock : 0,
      lowStockThreshold: this.form.trackStock ? this.form.lowStockThreshold : 0,
      sizes:  sizes.map((s, i) => ({ id: i + 1, label: s.label.trim(), priceDeltaCents: s.priceDeltaCents })),
      modifierGroups,
      satProductCode: this.form.satProductCode.trim() || undefined,
      satUnitCode: this.form.satUnitCode || undefined,
      taxRate: this.form.taxRate,
      printingDestinationId: this.form.printingDestinationId,
    };

    if (this.editingProduct) {
      const updated: Product = { ...this.editingProduct, ...payload, images: this.productImages() };
      await this.db.products.put(updated);

      // Sync to API (best-effort)
      try {
        await firstValueFrom(
          this.http.put(`${environment.apiUrl}/products/${this.editingProduct.id}`, payload)
        );
      } catch (e) { console.warn('API sync failed for product update:', e); }
    } else {
      const maxId = Math.max(0, ...this.products().map(p => p.id));
      const newProduct: Product = { id: maxId + 1, ...payload };
      await this.db.products.add(newProduct);

      // Sync to API (best-effort) — API may assign a real ID
      try {
        await firstValueFrom(
          this.http.post(`${environment.apiUrl}/products`, { ...payload, branchId: this.authService.branchId })
        );
      } catch (e) { console.warn('API sync failed for product create:', e); }
    }

    this.dialogVisible = false;
    await this.loadData();
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

  async saveCategory(): Promise<void> {
    if (!this.catForm.name.trim()) return;

    if (this.editingCategory) {
      const updated: Category = {
        ...this.editingCategory,
        name: this.catForm.name.trim(),
        icon: this.catForm.icon,
        isActive: this.catForm.isActive,
      };
      await this.db.categories.put(updated);
    } else {
      const maxId   = Math.max(0, ...this.categories().map(c => c.id));
      const maxSort = Math.max(0, ...this.categories().map(c => c.sortOrder));
      const newCategory: Category = {
        id:        maxId + 1,
        name:      this.catForm.name.trim(),
        icon:      this.catForm.icon,
        isActive:  this.catForm.isActive,
        sortOrder: maxSort + 1,
      };
      await this.db.categories.add(newCategory);
    }

    this.catDialogVisible = false;
    await this.loadData();
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
    try {
      const data = await firstValueFrom(
        this.http.get<InventoryMovement[]>(
          `${environment.apiUrl}/products/${product.id}/movements`
        )
      );
      this.productMovements.set(data);
    } catch {
      this.productMovements.set([]);
    } finally {
      this.loadingMovements.set(false);
    }
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
      this.form.barcode = code;
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

  onPriceChange(pesos: number | null): void {
    this.form.priceCents = Math.round((pesos ?? 0) * 100);
  }

  addSize(): void {
    this.form.sizes.push({ label: '', priceDeltaCents: 0 });
  }

  removeSize(index: number): void {
    this.form.sizes.splice(index, 1);
  }

  onSizePriceChange(index: number, pesos: number | null): void {
    this.form.sizes[index].priceDeltaCents = Math.round((pesos ?? 0) * 100);
  }

  //#region Modifier Groups — reactive form helpers

  /** Builds a reactive FormGroup for a single modifier group */
  private buildGroupForm(group?: ProductModifierGroup): ModifierGroupForm {
    const extrasArray = new FormArray<ModifierExtraForm>(
      (group?.extras ?? []).map(e => this.buildExtraForm(e)),
    );
    return new FormGroup({
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
    });
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

  private emptyProductForm(): ProductForm {
    return { name: '', barcode: '', description: '', priceCents: 0, categoryId: null, isAvailable: true, trackStock: false, currentStock: 0, lowStockThreshold: 0, sizes: [], satProductCode: '', satUnitCode: 'H87', taxRate: 16, printingDestinationId: null };
  }

  private emptyCatForm(): CategoryForm {
    return { name: '', icon: 'pi-tag', isActive: true };
  }

  private emptyDiscountForm(): DiscountForm {
    return { name: '', type: 'percent', value: 0, isActive: true };
  }

  //#endregion

}
