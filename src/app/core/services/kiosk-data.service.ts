import { Injectable, inject } from '@angular/core';
import { firstValueFrom, forkJoin } from 'rxjs';

import { Category, Product } from '../models';
import { ApiService } from './api.service';
import { DatabaseService } from './database.service';
import { ProductService } from './product.service';

/** Shape of the public branch config endpoint response */
interface PublicBranchConfig {
  businessName: string;
  locationName: string;
}

/**
 * Data loader for kiosk mode — uses public API endpoints that do NOT require JWT.
 *
 * The kiosk runs without user authentication, so all data must come from
 * unauthenticated endpoints that accept branchId as a query/path parameter.
 *
 * Public endpoints:
 *   GET /api/products/public?branchId={id}
 *   GET /api/categories/public?branchId={id}
 *   GET /api/branch/public/{id}
 */
@Injectable({ providedIn: 'root' })
export class KioskDataService {

  private readonly api = inject(ApiService);
  private readonly db = inject(DatabaseService);
  private readonly productService = inject(ProductService);

  /**
   * Loads the product catalog from public endpoints and caches in Dexie.
   * Updates ProductService signals so kiosk components can read them.
   * Falls back to Dexie cache if the API is unreachable.
   * @param branchId Branch to load catalog for
   */
  async loadCatalog(branchId: number): Promise<void> {
    this.productService.isLoading.set(true);

    // Step 1 — Serve stale data from Dexie (instant UI)
    try {
      const [localProducts, allCategories] = await Promise.all([
        this.db.products.toArray(),
        this.db.categories.orderBy('sortOrder').toArray(),
      ]);
      if (localProducts.length > 0) {
        this.productService.seedCatalog(localProducts, allCategories);
      }
    } catch {
      // Silent — will try API next
    }

    // Step 2 — Fetch from public API
    try {
      const [products, categories] = await firstValueFrom(
        forkJoin([
          this.api.get<Product[]>(`/products/public?branchId=${branchId}`),
          this.api.get<Category[]>(`/categories/public?branchId=${branchId}`),
        ]),
      );
      await this.productService.seedCatalog(products, categories);
      console.info('[KioskDataService] Catalog loaded from public API');
    } catch {
      console.warn('[KioskDataService] Public API unreachable — using cached catalog');
    }

    this.productService.isLoading.set(false);
  }

  /**
   * Loads the branch config (business name, location) from the public endpoint.
   * @param branchId Branch to load config for
   * @returns Business name and location, or defaults if API fails
   */
  async loadConfig(branchId: number): Promise<PublicBranchConfig> {
    try {
      return await firstValueFrom(
        this.api.get<PublicBranchConfig>(`/branch/public/${branchId}`),
      );
    } catch {
      console.warn('[KioskDataService] Public branch config unreachable — using defaults');
      return { businessName: 'Mi Negocio', locationName: '' };
    }
  }
}
