import { Component, OnInit, signal } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
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
import { ConfirmationService } from 'primeng/api';

import { Category, DiscountPreset, Product, ProductImportPreview, ProductImportResult } from '../../../../core/models';
import { DatabaseService } from '../../../../core/services/database.service';
import { ProductService } from '../../../../core/services/product.service';
import { DiscountService } from '../../../../core/services/discount.service';
import { ProductImportService } from '../../../../core/services/product-import.service';
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
  priceCents: number;
  categoryId: number | null;
  isAvailable: boolean;
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

/** Branch ID — hardcoded until multi-branch support */
const BRANCH_ID = 1;

@Component({
  selector: 'app-admin-products',
  standalone: true,
  imports: [
    ButtonModule,
    CurrencyPipe,
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
  ) {}
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
    this.dialogVisible = true;
  }

  openEdit(product: Product): void {
    this.editingProduct = product;
    this.form = {
      name: product.name,
      priceCents: product.priceCents,
      categoryId: product.categoryId,
      isAvailable: product.isAvailable,
      sizes:  product.sizes.map(s => ({ label: s.label, priceDeltaCents: s.priceDeltaCents })),
      extras: product.extras.map(e => ({ label: e.label, priceCents: e.priceCents })),
    };
    this.dialogVisible = true;
  }

  closeDialog(): void {
    this.dialogVisible = false;
  }

  //#endregion

  //#region Product CRUD

  async saveProduct(): Promise<void> {
    if (!this.form.name.trim() || !this.form.categoryId) return;

    const sizes  = this.form.sizes.filter(s => s.label.trim());
    const extras = this.form.extras.filter(e => e.label.trim());

    if (this.editingProduct) {
      const updated: Product = {
        ...this.editingProduct,
        name: this.form.name.trim(),
        priceCents: this.form.priceCents,
        categoryId: this.form.categoryId,
        isAvailable: this.form.isAvailable,
        sizes:  sizes.map((s, i) => ({ id: i + 1, label: s.label.trim(), priceDeltaCents: s.priceDeltaCents })),
        extras: extras.map((e, i) => ({ id: i + 1, label: e.label.trim(), priceCents: e.priceCents })),
      };
      await this.db.products.put(updated);
    } else {
      const maxId = Math.max(0, ...this.products().map(p => p.id));
      const newProduct: Product = {
        id: maxId + 1,
        name: this.form.name.trim(),
        priceCents: this.form.priceCents,
        categoryId: this.form.categoryId,
        isAvailable: this.form.isAvailable,
        sizes:  sizes.map((s, i) => ({ id: i + 1, label: s.label.trim(), priceDeltaCents: s.priceDeltaCents })),
        extras: extras.map((e, i) => ({ id: i + 1, label: e.label.trim(), priceCents: e.priceCents })),
      };
      await this.db.products.add(newProduct);
    }

    this.dialogVisible = false;
    await this.loadData();
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
    await this.discountService.loadPresets(BRANCH_ID);
    const presets = await this.discountService.getPresets(BRANCH_ID);
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
        branchId: BRANCH_ID,
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
        this.selectedFile()!, BRANCH_ID
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
        this.importPreview()!.validRows, BRANCH_ID
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
    return { name: '', priceCents: 0, categoryId: null, isAvailable: true, sizes: [], extras: [] };
  }

  private emptyCatForm(): CategoryForm {
    return { name: '', icon: 'pi-tag', isActive: true };
  }

  private emptyDiscountForm(): DiscountForm {
    return { name: '', type: 'percent', value: 0, isActive: true };
  }

  //#endregion

}
