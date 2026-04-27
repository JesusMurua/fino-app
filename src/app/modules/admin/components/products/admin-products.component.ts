import { Component, OnInit, computed, effect, inject, signal } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

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
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ToastModule } from 'primeng/toast';
import { ConfirmationService, MessageService } from 'primeng/api';

import { Category, DiscountPreset, InventoryItem, InventoryMovement, Product, ProductConsumption, ProductImportPreview, ProductImportResult } from '../../../../core/models';
import { InventoryMovementType, INVENTORY_MOVEMENT_TYPE_LABELS, INVENTORY_MOVEMENT_TYPE_CLASSES, MacroCategoryType, SubCategoryType } from '../../../../core/enums';
import { DatabaseService } from '../../../../core/services/database.service';
import { TenantContextService } from '../../../../core/services/tenant-context.service';
import { ProductService } from '../../../../core/services/product.service';
import { ProductCategoryService } from '../../../../core/services/product-category.service';
import { DiscountService } from '../../../../core/services/discount.service';
import { InventoryService } from '../../../../core/services/inventory.service';
import { InventoryConsumptionService } from '../../../../core/services/inventory-consumption.service';
import { ProductImportService } from '../../../../core/services/product-import.service';
import { AuthService } from '../../../../core/services/auth.service';
import { getHttpErrorSummary } from '../../../../core/utils/http-error.utils';
import { PricePipe } from '../../../../shared/pipes/price.pipe';

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

  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly tenantContext = inject(TenantContextService);

  /**
   * Placeholder for the "Nombre" field of the new-category dialog.
   * Routes by vertical so a Gym admin sees "Membresías" instead of the
   * F&B-flavored "Bebidas". Falls back to a neutral hint elsewhere.
   */
  readonly categoryNamePlaceholder = computed(() => {
    if (this.tenantContext.currentSubCategory() === SubCategoryType.Gym) {
      return 'Ej. Membresías';
    }
    switch (this.tenantContext.currentMacro()) {
      case MacroCategoryType.FoodBeverage:
      case MacroCategoryType.QuickService:
        return 'Ej. Bebidas';
      case MacroCategoryType.Retail:
        return 'Ej. Categoría o departamento';
      default:
        return 'Ej. Categoría';
    }
  });

  readonly products = signal<Product[]>([]);
  readonly categories = signal<Category[]>([]);
  readonly isLoading = signal(true);
  readonly savingCategory = signal(false);

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

  //#region Product Navigation

  /** Navigates to the create form */
  goToCreate(): void {
    this.router.navigate(['new'], { relativeTo: this.route });
  }

  /** Navigates to the edit form for the given product */
  goToEdit(product: Product): void {
    this.router.navigate([product.id, 'edit'], { relativeTo: this.route });
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
          summary: getHttpErrorSummary(err),
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

  /** Returns display label for movement type */
  movementTypeLabel(type: number): string {
    return INVENTORY_MOVEMENT_TYPE_LABELS[type as InventoryMovementType] ?? String(type);
  }

  /** Returns CSS class for movement type badge */
  movementTypeSeverity(type: number): string {
    return INVENTORY_MOVEMENT_TYPE_CLASSES[type as InventoryMovementType] ?? '';
  }

  //#endregion

  //#region Helpers

  categoryName(id: number): string {
    return this.categories().find(c => c.id === id)?.name ?? '—';
  }

  private emptyCatForm(): CategoryForm {
    return { name: '', icon: 'pi-tag', isActive: true };
  }

  private emptyDiscountForm(): DiscountForm {
    return { name: '', type: 'percent', value: 0, isActive: true };
  }

  //#endregion

}
