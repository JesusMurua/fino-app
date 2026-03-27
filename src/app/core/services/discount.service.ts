import { Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { DiscountPreset } from '../models';
import { ApiService } from './api.service';
import { DatabaseService } from './database.service';

/**
 * Manages discount presets — CRUD via API with Dexie offline cache.
 *
 * Presets are loaded from the API and cached in IndexedDB.
 * If the API is unreachable, the local cache is used as fallback.
 */
@Injectable({ providedIn: 'root' })
export class DiscountService {

  //#region Constructor
  constructor(
    private readonly api: ApiService,
    private readonly db: DatabaseService,
  ) {}
  //#endregion

  //#region Public Methods

  /**
   * Loads discount presets from API and caches in Dexie.
   * Called on app init or when entering checkout.
   * @param branchId Branch to load presets for
   */
  async loadPresets(branchId: number): Promise<void> {
    try {
      const presets = await firstValueFrom(
        this.api.get<DiscountPreset[]>('/discountpreset'),
      );
      await this.db.transaction('rw', this.db.discountPresets, async () => {
        await this.db.discountPresets.where('branchId').equals(branchId).delete();
        if (presets.length > 0) {
          await this.db.discountPresets.bulkPut(presets);
        }
      });
    } catch (error) {
      console.warn('[DiscountService] API unreachable — using cached presets:', error);
    }
  }

  /**
   * Gets all active presets from local Dexie cache.
   * @param branchId Branch to filter by
   * @returns Active presets sorted by name
   */
  async getPresets(branchId: number): Promise<DiscountPreset[]> {
    const presets = await this.db.discountPresets
      .where('branchId')
      .equals(branchId)
      .filter(p => p.isActive === true)
      .toArray();
    return presets.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Calculates discount amount in cents.
   * @param preset The discount preset to apply
   * @param subtotalCents The order subtotal before discount
   * @returns Discount amount in cents (never negative, never exceeds subtotal)
   */
  calculateDiscount(preset: DiscountPreset, subtotalCents: number): number {
    if (subtotalCents <= 0) return 0;

    if (preset.type === 'percent') {
      return Math.round(subtotalCents * preset.value / 100);
    }

    // Fixed discount — cap at subtotal so total never goes negative
    return Math.min(preset.value, subtotalCents);
  }

  /**
   * Creates a new discount preset via API and caches locally.
   * @param preset Preset data without id or createdAt
   * @returns The created preset with server-assigned id
   */
  async createPreset(preset: Omit<DiscountPreset, 'id' | 'createdAt'>): Promise<DiscountPreset> {
    const created = await firstValueFrom(
      this.api.post<DiscountPreset>('/discountpreset', preset),
    );
    await this.db.discountPresets.put(created);
    return created;
  }

  /**
   * Updates an existing discount preset via API and local cache.
   * @param id Preset ID to update
   * @param preset Partial fields to update
   * @returns The updated preset
   */
  async updatePreset(id: number, preset: Partial<DiscountPreset>): Promise<DiscountPreset> {
    const updated = await firstValueFrom(
      this.api.put<DiscountPreset>(`/discountpreset/${id}`, preset),
    );
    await this.db.discountPresets.put(updated);
    return updated;
  }

  /**
   * Soft deletes a preset via API and removes from local cache.
   * @param id Preset ID to delete
   */
  async deletePreset(id: number): Promise<void> {
    await firstValueFrom(
      this.api.delete(`/discountpreset/${id}`),
    );
    await this.db.discountPresets.delete(id);
  }

  //#endregion

}
