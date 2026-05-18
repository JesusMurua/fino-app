import { Injectable, computed, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, firstValueFrom, forkJoin, from, of, switchMap, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';

import { environment } from '../../../environments/environment';
import { Category, InventoryMovement, Product, ProductExtra, ProductImage, ProductMetadata, ProductModifierGroup, ProductSize, ProductType } from '../models';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';
import { DatabaseService } from './database.service';
import { InventoryService } from './inventory.service';

/** Payload for creating or updating a product (shared shape) */
export interface SaveProductDto {
  name: string;
  /** Strong classification (NON-NULLABLE). Backend default is `'Standard'`. */
  type: ProductType;
  barcode?: string;
  description?: string;
  priceCents: number;
  categoryId: number;
  isAvailable: boolean;
  trackStock: boolean;
  currentStock: number;
  lowStockThreshold: number;
  sizes: ProductSize[];
  modifierGroups: ProductModifierGroup[];
  satProductCode?: string;
  satUnitCode?: string;
  /**
   * Per-product tax rate override (integer percentage, e.g. 16). Leave
   * `undefined` to inherit the business default — the backend resolves
   * via `business.defaultTaxId` at sale time. AUDIT-053.
   */
  taxRate?: number;
  /**
   * Whether the displayed price already includes tax. Mexican standard
   * is `true`; B2B / wholesale flips it to `false` so the cart adds the
   * tax on top. Always persisted explicitly (never `undefined`).
   */
  isTaxIncluded?: boolean;
  printingDestinationId: number | null;
  /**
   * Strongly-typed vertical metadata. The backend persists this as a
   * `jsonb` column via EF Core 9 owned-type mapping (BDD-020); the
   * frontend always sends an object literal that matches the
   * `ProductMetadata` shape.
   */
  metadata?: ProductMetadata;
}

/**
 * Manages the product catalog state using Angular signals.
 *
 * Hybrid "stale-while-revalidate" strategy:
 *   1. Load immediately from IndexedDB (instant UI)
 *   2. Fetch from API in background
 *   3. If API succeeds → update Dexie + signals (UI refreshes)
 *   4. If API fails → keep Dexie data (offline mode)
 */
@Injectable({ providedIn: 'root' })
export class ProductService {

  //#region Properties
  private readonly _products = signal<Product[]>([]);
  private readonly _categories = signal<Category[]>([]);
  private readonly _selectedCategoryId = signal<number | null>(null);

  readonly isLoading = signal(false);

  /** All products from the catalog (read-only) */
  readonly products = this._products.asReadonly();

  /** All active categories ordered by sortOrder (read-only) */
  readonly categories = this._categories.asReadonly();

  /** Currently selected category filter (null = show all) */
  readonly selectedCategoryId = this._selectedCategoryId.asReadonly();

  /**
   * Products filtered by the selected category.
   * Always excludes unavailable products.
   */
  readonly filteredProducts = computed(() => {
    const categoryId = this._selectedCategoryId();
    const all = this._products();
    // Show all products (including unavailable for "Agotado" overlay).
    // Sort: available first, then unavailable at the end.
    const filtered = categoryId === null
      ? all
      : all.filter(p => p.categoryId === categoryId);
    return [...filtered].sort((a, b) => (b.isAvailable ? 1 : 0) - (a.isAvailable ? 1 : 0));
  });
  //#endregion

  //#region Constructor
  constructor(
    private readonly db: DatabaseService,
    private readonly api: ApiService,
    private readonly http: HttpClient,
    private readonly inventoryService: InventoryService,
    private readonly authService: AuthService,
  ) {}
  //#endregion

  //#region Catalog Methods

  /**
   * Stale-while-revalidate catalog load:
   *   1. Serve cached data from IndexedDB immediately
   *   2. Fetch fresh data from API in background
   *   3. Update Dexie + signals if API succeeds
   */
  async loadCatalog(): Promise<void> {
    this.isLoading.set(true);

    // Step 1 — Serve stale data from Dexie (instant UI)
    try {
      const [localProducts, allCategories] = await Promise.all([
        this.db.products.toArray(),
        this.db.categories.orderBy('sortOrder').toArray(),
      ]);
      this._products.set(localProducts);
      this._categories.set(allCategories.filter(c => c.isActive));
    } catch (error) {
      console.error('[ProductService] Failed to load catalog from IndexedDB:', error);
    }

    // Step 2 — Try API (awaited so callers know when done)
    await this.revalidateFromApi();

    // Step 3 — Auto-86: mark products as unavailable if inventory depleted
    await this.applyOutOfStock();

    this.isLoading.set(false);
  }

  /**
   * Replaces the local product and category cache with fresh data.
   * Clears existing Dexie tables first so only the active branch's
   * catalog remains after a revalidation or branch switch. Safe now
   * that all writes go through the pessimistic-UI flow — Dexie never
   * holds unsynced records that a server refetch could wipe.
   * @param products Products fetched from API
   * @param categories Categories fetched from API
   */
  async seedCatalog(products: Product[], categories: Category[]): Promise<void> {
    await this.db.transaction('rw', [this.db.products, this.db.categories], async () => {
      await this.db.products.clear();
      await this.db.categories.clear();
      await this.db.products.bulkPut(products);
      await this.db.categories.bulkPut(categories);
    });
    this._products.set(products);
    this._categories.set(categories.filter(c => c.isActive));
  }
  //#endregion

  //#region Stock Methods

  /**
   * Returns available stock for a product.
   * For trackStock products: currentStock (from signal), clamped to 0.
   * For non-trackStock products: Infinity (no limit — backend controls availability).
   * @param productId Product ID to check
   */
  getAvailableStock(productId: number): number {
    const product = this._products().find(p => p.id === productId);
    if (!product || !product.trackStock) return Infinity;
    return Math.max(0, product.currentStock ?? 0);
  }

  /**
   * Optimistic local stock deduction — decrements currentStock in the signal.
   * Automatically marks product as unavailable if stock reaches 0.
   * Called by CartService when adding items to the cart.
   * @param productId Product to deduct from
   * @param quantity Amount to deduct (positive)
   */
  deductLocalStock(productId: number, quantity: number): void {
    this._products.update(products =>
      products.map(p => {
        if (p.id !== productId || !p.trackStock) return p;
        const newStock = (p.currentStock ?? 0) - quantity;
        return {
          ...p,
          currentStock: newStock,
          isAvailable: newStock > 0 ? p.isAvailable : false,
        };
      }),
    );
  }

  /**
   * Restores local stock — increments currentStock in the signal.
   * Called by CartService when removing items from the cart.
   * Re-marks product as available if stock becomes positive.
   * @param productId Product to restore
   * @param quantity Amount to restore (positive)
   */
  restoreLocalStock(productId: number, quantity: number): void {
    this._products.update(products =>
      products.map(p => {
        if (p.id !== productId || !p.trackStock) return p;
        const newStock = (p.currentStock ?? 0) + quantity;
        return {
          ...p,
          currentStock: newStock,
          isAvailable: newStock > 0 ? true : p.isAvailable,
        };
      }),
    );
  }

  //#endregion

  //#region Filter Methods

  /**
   * Sets the active category filter.
   * Pass null to show all available products.
   * @param categoryId Category to filter by, or null for all
   */
  selectCategory(categoryId: number | null): void {
    this._selectedCategoryId.set(categoryId);
  }
  //#endregion

  //#region Product CRUD Methods

  /**
   * Creates a product on the backend and, on success, persists it locally
   * using the server-assigned ID. Signals are refreshed for the POS view.
   * @param dto Product fields submitted by the user
   */
  createProduct(dto: SaveProductDto): Observable<Product> {
    const payload = { ...dto, branchId: this.authService.branchId };
    return this.api.post<Product>('/products', payload).pipe(
      switchMap(created => from(this.persistProduct({ ...dto, ...created } as Product))),
    );
  }

  /**
   * Updates a product on the backend and mirrors the change in Dexie.
   * @param id Server-assigned product ID
   * @param dto Updated product fields
   * @param existing Current product (used to preserve fields not in the DTO, e.g. images)
   */
  updateProduct(id: number, dto: SaveProductDto, existing: Product): Observable<Product> {
    return this.api.put<Product>(`/products/${id}`, dto).pipe(
      switchMap(updated => from(this.persistProduct({ ...existing, ...dto, ...updated, id: updated?.id ?? id } as Product))),
    );
  }

  /**
   * Deletes a product on the backend and removes it from Dexie on success.
   * @param id Server-assigned product ID
   */
  deleteProduct(id: number): Observable<void> {
    return this.api.delete<void>(`/products/${id}`).pipe(
      switchMap(() => from(this.removeProductLocal(id))),
    );
  }

  /**
   * Loads the stock movement history for a product.
   * @param productId Product to query
   */
  getProductMovements(productId: number): Observable<InventoryMovement[]> {
    return this.api.get<InventoryMovement[]>(`/products/${productId}/movements`);
  }

  /**
   * Re-reads the catalog from Dexie and refreshes the reactive signals.
   * Called by write operations after they sync to IndexedDB so that any
   * consumer (POS grid, admin table) sees the change immediately.
   */
  async refreshSignalsFromDexie(): Promise<void> {
    const [products, categories] = await Promise.all([
      this.db.products.toArray(),
      this.db.categories.orderBy('sortOrder').toArray(),
    ]);
    this._products.set(products);
    this._categories.set(categories.filter(c => c.isActive));
  }

  //#endregion

  //#region Barcode Methods

  /**
   * Finds a product by barcode within the authenticated branch.
   * BranchId is resolved server-side from JWT.
   * @param barcode The barcode string to search
   * @returns Observable with the product or null if not found
   */
  findByBarcode(barcode: string): Observable<Product | null> {
    return this.api.get<Product>(
      `/products/by-barcode/${encodeURIComponent(barcode)}`
    ).pipe(
      catchError(err => {
        if (err.status === 404) return of(null);
        return throwError(() => err);
      })
    );
  }

  //#endregion

  //#region Product Image Methods

  /**
   * Uploads an image file for a product.
   * Uses HttpClient directly because FormData requires multipart encoding.
   * @param productId Product to attach the image to
   * @param file Image file selected by the user
   * @returns The created ProductImage from the API
   */
  async uploadProductImage(productId: number, file: File): Promise<ProductImage> {
    const formData = new FormData();
    formData.append('file', file);
    return firstValueFrom(
      this.http.post<ProductImage>(
        `${environment.apiUrl}/products/${productId}/images`,
        formData,
      ),
    );
  }

  /**
   * Deletes a product image from the backend.
   * @param productId Product the image belongs to
   * @param imageId Image to delete
   */
  async deleteProductImage(productId: number, imageId: number): Promise<void> {
    await firstValueFrom(
      this.api.delete(`/products/${productId}/images/${imageId}`),
    );
  }

  //#endregion

  //#region Private Helpers

  /** Writes a server-confirmed product to Dexie and refreshes signals */
  private async persistProduct(product: Product): Promise<Product> {
    await this.db.products.put(product);
    await this.refreshSignalsFromDexie();
    return product;
  }

  /** Removes a product from Dexie and refreshes signals */
  private async removeProductLocal(productId: number): Promise<void> {
    await this.db.products.delete(productId);
    await this.refreshSignalsFromDexie();
  }

  /**
   * Marks products as unavailable (in-memory only) if their inventory
   * items are depleted. Does not persist — re-applied on every load.
   *
   * Two-layer strategy:
   *   1. API: GET /inventory/out-of-stock-products (covers recipe-based stock)
   *   2. Local fallback: products with trackStock && currentStock <= 0
   */
  private async applyOutOfStock(): Promise<void> {
    const idsToDisable = new Set<number>();

    // Layer 1: API-based out-of-stock (recipe-aware) — best-effort
    try {
      const apiIds = await this.inventoryService.getOutOfStockProductIds();
      for (const id of apiIds) idsToDisable.add(id);
    } catch {
      // Offline — API unavailable, rely on local data only
    }

    // Layer 2: Local trackStock products with depleted stock (always runs)
    for (const p of this._products()) {
      if (p.trackStock && (p.currentStock ?? 0) <= 0) {
        idsToDisable.add(p.id);
      }
    }

    if (idsToDisable.size === 0) return;

    this._products.update(products =>
      products.map(p => idsToDisable.has(p.id) ? { ...p, isAvailable: false } : p)
    );
  }

  /**
   * Fetches products and categories from the API and updates local cache.
   * The API filters by the branch in the JWT automatically.
   * Errors are logged but never thrown — callers can fire-and-forget.
   */
  async revalidateFromApi(): Promise<void> {
    try {
      const [products, categories] = await firstValueFrom(
        forkJoin([
          this.api.get<Product[]>('/products'),
          this.api.get<Category[]>('/categories'),
        ]),
      );
      await this.seedCatalog(products, categories);
      console.info('[ProductService] Catalog updated from API');
    } catch (error) {
      console.warn('[ProductService] API unreachable — using cached catalog:', error);
    }
  }
  //#endregion

}
