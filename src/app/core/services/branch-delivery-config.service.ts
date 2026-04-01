import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';

import { environment } from '../../../environments/environment';
import { BranchDeliveryConfig, UpsertDeliveryConfigRequest } from '../models';
import { OrderSource } from '../enums';

@Injectable({ providedIn: 'root' })
export class BranchDeliveryConfigService {

  private readonly http = inject(HttpClient);
  private readonly baseUrl = environment.apiUrl;

  //#region State

  private readonly _configs = signal<BranchDeliveryConfig[]>([]);
  private readonly _loading = signal(false);
  private readonly _saving = signal(false);

  readonly configs = this._configs.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly saving = this._saving.asReadonly();

  //#endregion

  //#region API Methods

  /** Loads all delivery configs for a branch */
  loadConfigs(branchId: number): void {
    this._loading.set(true);
    this.http.get<BranchDeliveryConfig[]>(
      `${this.baseUrl}/branch/${branchId}/delivery-config`,
    ).subscribe({
      next: (data) => {
        this._configs.set(data);
        this._loading.set(false);
      },
      error: () => {
        this._configs.set([]);
        this._loading.set(false);
      },
    });
  }

  /** Creates or updates a delivery config for a branch */
  upsert(branchId: number, request: UpsertDeliveryConfigRequest): Observable<BranchDeliveryConfig> {
    this._saving.set(true);
    return this.http.put<BranchDeliveryConfig>(
      `${this.baseUrl}/branch/${branchId}/delivery-config`,
      request,
    ).pipe(
      tap({
        next: (updated) => {
          this._configs.update(configs => {
            const idx = configs.findIndex(c => c.platform === updated.platform);
            if (idx >= 0) {
              const copy = [...configs];
              copy[idx] = updated;
              return copy;
            }
            return [...configs, updated];
          });
          this._saving.set(false);
        },
        error: () => this._saving.set(false),
      }),
    );
  }

  /** Deletes a delivery config for a branch by platform */
  delete(branchId: number, platform: OrderSource): Observable<void> {
    this._saving.set(true);
    return this.http.delete<void>(
      `${this.baseUrl}/branch/${branchId}/delivery-config/${platform}`,
    ).pipe(
      tap({
        next: () => {
          this._configs.update(configs =>
            configs.filter(c => c.platform !== platform),
          );
          this._saving.set(false);
        },
        error: () => this._saving.set(false),
      }),
    );
  }

  //#endregion
}
