import { Injectable, inject } from '@angular/core';
import { Observable, from, of, switchMap } from 'rxjs';
import { tap } from 'rxjs/operators';

import { Category } from '../models';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';
import { DatabaseService } from './database.service';
import { ProductService } from './product.service';

/** Payload for creating a new product category */
export interface CreateCategoryDto {
  name: string;
  icon?: string;
  sortOrder: number;
  isActive: boolean;
}

/** Payload for updating an existing product category */
export interface UpdateCategoryDto {
  name: string;
  icon?: string;
  sortOrder?: number;
  isActive: boolean;
}

/**
 * Handles CRUD for product categories.
 *
 * Pessimistic UI strategy:
 *   1. Send request to the backend.
 *   2. Only on 2xx response, persist the server-confirmed record in Dexie.
 *   3. Refresh the ProductService signals so the POS view updates.
 */
@Injectable({ providedIn: 'root' })
export class ProductCategoryService {

  //#region Properties
  private readonly api = inject(ApiService);
  private readonly db = inject(DatabaseService);
  private readonly authService = inject(AuthService);
  private readonly productService = inject(ProductService);
  //#endregion

  //#region Public Methods

  /**
   * Creates a category on the backend and, on success, persists it locally
   * using the server-assigned ID.
   * @param dto Category fields submitted by the user
   */
  create(dto: CreateCategoryDto): Observable<Category> {
    const payload = { ...dto, branchId: this.authService.branchId };
    return this.api.post<Category>('/categories', payload).pipe(
      switchMap(created => from(this.persistAndRefresh({ ...dto, ...created }))),
    );
  }

  /**
   * Updates a category on the backend and mirrors the change in Dexie.
   * @param id Server-assigned category ID
   * @param dto Updated category fields
   */
  update(id: number, dto: UpdateCategoryDto): Observable<Category> {
    return this.api.put<Category>(`/categories/${id}`, dto).pipe(
      switchMap(updated => from(this.persistAndRefresh({ id, ...dto, ...updated } as Category))),
    );
  }

  /**
   * Deletes a category on the backend and removes it from Dexie on success.
   * @param id Server-assigned category ID
   */
  delete(id: number): Observable<void> {
    return this.api.delete<void>(`/categories/${id}`).pipe(
      tap(async () => {
        await this.db.categories.delete(id);
        await this.productService.refreshSignalsFromDexie();
      }),
    );
  }

  //#endregion

  //#region Private Helpers

  /** Persists a server-confirmed category to Dexie and refreshes signals */
  private async persistAndRefresh(category: Category): Promise<Category> {
    await this.db.categories.put(category);
    await this.productService.refreshSignalsFromDexie();
    return category;
  }

  //#endregion

}
