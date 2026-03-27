import { Injectable, computed, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom, forkJoin } from 'rxjs';

import { environment } from '../../../environments/environment';
import { Category, Product, ProductImage } from '../models';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';
import { DatabaseService } from './database.service';
import { InventoryService } from './inventory.service';

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
   * catalog remains after a revalidation or branch switch.
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

  /**
   * Marks products as unavailable (in-memory only) if their inventory
   * items are depleted. Does not persist — re-applied on every load.
   */
  private async applyOutOfStock(): Promise<void> {
    try {
      const outOfStockIds = await this.inventoryService.getOutOfStockProductIds();
      if (outOfStockIds.length === 0) return;

      const idsSet = new Set(outOfStockIds);
      this._products.update(products =>
        products.map(p => idsSet.has(p.id) ? { ...p, isAvailable: false } : p)
      );
    } catch {
      // Silent — auto-86 is best-effort
    }
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
