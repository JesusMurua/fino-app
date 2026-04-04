import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../../environments/environment';
import { ProductConsumption } from '../models';

@Injectable({ providedIn: 'root' })
export class InventoryConsumptionService {

  private readonly http = inject(HttpClient);
  private readonly baseUrl = environment.apiUrl;

  //#region Public Methods

  /**
   * Gets all consumption rules for a product
   * @param productId The product to look up
   */
  async getByProduct(productId: number): Promise<ProductConsumption[]> {
    return firstValueFrom(
      this.http.get<ProductConsumption[]>(
        `${this.baseUrl}/inventory/consumption/${productId}`
      )
    );
  }

  /**
   * Creates a new consumption rule linking a product to an inventory item
   * @param productId The product that consumes the item
   * @param inventoryItemId The inventory item consumed
   * @param quantityPerSale Amount consumed per unit sold
   */
  async create(
    productId: number,
    inventoryItemId: number,
    quantityPerSale: number,
  ): Promise<ProductConsumption> {
    return firstValueFrom(
      this.http.post<ProductConsumption>(
        `${this.baseUrl}/inventory/consumption`,
        { productId, inventoryItemId, quantityPerSale },
      )
    );
  }

  /**
   * Updates the quantity per sale for an existing consumption rule
   * @param id The consumption rule ID
   * @param quantityPerSale New amount consumed per unit sold
   */
  async update(id: number, quantityPerSale: number): Promise<ProductConsumption> {
    return firstValueFrom(
      this.http.put<ProductConsumption>(
        `${this.baseUrl}/inventory/consumption/${id}`,
        { quantityPerSale },
      )
    );
  }

  /**
   * Deletes a consumption rule
   * @param id The consumption rule ID
   */
  async delete(id: number): Promise<void> {
    await firstValueFrom(
      this.http.delete(`${this.baseUrl}/inventory/consumption/${id}`)
    );
  }

  //#endregion
}
