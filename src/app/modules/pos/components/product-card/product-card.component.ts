import { Component, EventEmitter, Input, Output } from '@angular/core';

import { PricePipe } from '../../../../shared/pipes/price.pipe';
import { Product } from '../../../../core/models';

/** Visual layout for the catalog tile. */
export type ProductCardViewMode = 'grid' | 'list';

@Component({
  selector: 'app-product-card',
  standalone: true,
  imports: [PricePipe],
  templateUrl: './product-card.component.html',
  styleUrl: './product-card.component.scss',
})
export class ProductCardComponent {

  //#region Inputs & Outputs
  @Input({ required: true }) product!: Product;
  /**
   * Visual layout — `grid` is the default tall card with a 4:3 image,
   * `list` is a dense horizontal row optimized for fast catalog
   * scanning (Gym memberships, services, retail SKUs without imagery).
   */
  @Input() viewMode: ProductCardViewMode = 'grid';
  @Output() selected = new EventEmitter<Product>();
  //#endregion

  /** True when stock is at or below the low-stock threshold */
  get isLowStock(): boolean {
    const stock = this.product.currentStock ?? 0;
    const threshold = this.product.lowStockThreshold ?? 5;
    return stock > 0 && stock <= threshold;
  }

}
