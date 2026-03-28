import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../../environments/environment';
import { Zone } from '../models';

/**
 * Manages zone data for the current branch.
 * Zones group tables into physical areas (salón, barra, terraza).
 */
@Injectable({ providedIn: 'root' })
export class ZoneService {

  //#region Properties

  private readonly http = inject(HttpClient);
  private readonly baseUrl = environment.apiUrl;

  /** All zones for the current branch */
  readonly zones = signal<Zone[]>([]);

  //#endregion

  //#region Public API

  /**
   * Loads zones from the API for the current branch.
   * Fails silently — if API is unavailable, zones remain empty
   * and tables render without zone grouping.
   */
  async loadZones(): Promise<void> {
    try {
      const data = await firstValueFrom(
        this.http.get<Zone[]>(`${this.baseUrl}/zone`),
      );
      this.zones.set(data);
    } catch {
      console.warn('[ZoneService] API unavailable — zones not loaded');
    }
  }

  /**
   * Returns active zones sorted by sortOrder.
   * Used for zone tabs and grid grouping.
   */
  getActiveZones(): Zone[] {
    return this.zones()
      .filter(z => z.isActive)
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }

  //#endregion

}
