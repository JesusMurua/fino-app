import { Component, OnInit, effect, signal } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';

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

import { Category, DiscountPreset, InventoryItem, InventoryMovement, Product, ProductConsumption, ProductImage, ProductImportPreview, ProductImportResult } from '../../../../core/models';
import { DatabaseService } from '../../../../core/services/database.service';
import { ProductService } from '../../../../core/services/product.service';
import { DiscountService } from '../../../../core/services/discount.service';
import { InventoryService } from '../../../../core/services/inventory.service';
import { InventoryConsumptionService } from '../../../../core/services/inventory-consumption.service';
import { ProductImportService } from '../../../../core/services/product-import.service';
import { AuthService } from '../../../../core/services/auth.service';
import { PricePipe } from '../../../../shared/pipes/price.pipe';

/** Editable row for a product size inside the form */
interface ProductSizeForm {
  label: string;
  priceDeltaCents: number;
}

/** Editable row for a product extra inside the form */
interface ProductExtraForm {
  label: string;
  priceCents: number;
}

/** Shape of the product form used in the create/edit dialog */
interface ProductForm {
  name: string;
  description: string;
  priceCents: number;
  categoryId: number | null;
  isAvailable: boolean;
  trackStock: boolean;
  currentStock: number;
  lowStockThreshold: number;
  sizes: ProductSizeForm[];
  extras: ProductExtraForm[];
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
    this.productImages.set([]);
    this.dialogTabIndex = 0;
    this.dialogVisible = true;
  }

  openEdit(product: Product): void {
    this.editingProduct = product;
    this.form = {
      name: product.name,
      description: product.description ?? '',
      priceCents: product.priceCents,
      categoryId: product.categoryId,
      isAvailable: product.isAvailable,
      trackStock: product.trackStock ?? false,
      currentStock: product.currentStock ?? 0,
      lowStockThreshold: product.lowStockThreshold ?? 0,
      sizes:  product.sizes.map(s => ({ label: s.label, priceDeltaCents: s.priceDeltaCents })),
      extras: product.extras.map(e => ({ label: e.label, priceCents: e.priceCents })),
    };
    this.productImages.set(product.images ?? []);
    this.dialogTabIndex = 0;
    this.dialogVisible = true;
  }

  closeDialog(): void {
    this.dialogVisible = false;
  }

  //#endregion

  //#region Product CRUD

  /** Saves product locally in Dexie and syncs to API (best-effort) */
  async saveProduct(): Promise<void> {
    if (!this.form.name.trim() || !this.form.categoryId) return;

    const sizes  = this.form.sizes.filter(s => s.label.trim());
    const extras = this.form.extras.filter(e => e.label.trim());

    const payload = {
      name: this.form.name.trim(),
      description: this.form.description.trim() || undefined,
      priceCents: this.form.priceCents,
      categoryId: this.form.categoryId,
      isAvailable: this.form.isAvailable,
      trackStock: this.form.trackStock,
      currentStock: this.form.trackStock ? this.form.currentStock : 0,
      lowStockThreshold: this.form.trackStock ? this.form.lowStockThreshold : 0,
      sizes:  sizes.map((s, i) => ({ id: i + 1, label: s.label.trim(), priceDeltaCents: s.priceDeltaCents })),
      extras: extras.map((e, i) => ({ id: i + 1, label: e.label.trim(), priceCents: e.priceCents })),
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
  movementTypeLabel(type: string): string {
    switch (type) {
      case 'in':         return 'Entrada';
      case 'out':        return 'Salida';
      case 'adjustment': return 'Ajuste';
      default:           return type;
    }
  }

  /** Returns CSS class for movement type badge */
  movementTypeSeverity(type: string): string {
    switch (type) {
      case 'in':         return 'movement-badge--in';
      case 'out':        return 'movement-badge--out';
      case 'adjustment': return 'movement-badge--adj';
      default:           return '';
    }
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

  addExtra(): void {
    this.form.extras.push({ label: '', priceCents: 0 });
  }

  removeExtra(index: number): void {
    this.form.extras.splice(index, 1);
  }

  onExtraPriceChange(index: number, pesos: number | null): void {
    this.form.extras[index].priceCents = Math.round((pesos ?? 0) * 100);
  }

  private emptyProductForm(): ProductForm {
    return { name: '', description: '', priceCents: 0, categoryId: null, isAvailable: true, trackStock: false, currentStock: 0, lowStockThreshold: 0, sizes: [], extras: [] };
  }

  private emptyCatForm(): CategoryForm {
    return { name: '', icon: 'pi-tag', isActive: true };
  }

  private emptyDiscountForm(): DiscountForm {
    return { name: '', type: 'percent', value: 0, isActive: true };
  }

  //#endregion

}
