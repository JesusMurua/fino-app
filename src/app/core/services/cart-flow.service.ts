import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';

import { Product } from '../models';
import { CartService } from './cart.service';

/**
 * Discrete outcome of a product click — drives the caller's feedback
 * (e.g. toast on `'added'` only; weight capture and detail navigation
 * provide their own UI feedback downstream).
 */
export type ProductClickOutcome = 'added' | 'navigated' | 'weight_capture';

/**
 * Single source of truth for POS catalog click flow.
 *
 * Centralises the branch that used to live duplicated across 4+ entry
 * points (`product-grid-inner`, `unified-pos` barcode handler,
 * `keypad-stage` barcode + catalog, legacy `product-grid`):
 *
 *   - `TrackedByMeasure` products → publish a request signal that
 *     `cart-panel` observes and opens the weight-capture dialog.
 *   - Products with sizes / modifier groups → navigate to the detail
 *     page for customization.
 *   - Plain products → straight to the cart.
 *
 * Entry points await the returned outcome and toast on `'added'` only.
 */
@Injectable({ providedIn: 'root' })
export class CartFlowService {

  //#region Injections
  private readonly cartService = inject(CartService);
  private readonly router = inject(Router);
  //#endregion

  //#region State

  /**
   * Product awaiting weight capture. `cart-panel` mounts the dialog and
   * binds `[visible]="weightCaptureRequest() !== null"` so the dialog
   * opens declaratively whenever this signal carries a product.
   */
  readonly weightCaptureRequest = signal<Product | null>(null);

  //#endregion

  //#region Public API

  /**
   * Decides what to do with a product click and returns the outcome so
   * the caller can fire a success toast only for the immediate-add path.
   */
  async handleProductClick(product: Product): Promise<ProductClickOutcome> {
    if (product.type === 'TrackedByMeasure') {
      this.weightCaptureRequest.set(product);
      return 'weight_capture';
    }
    if (this.productRequiresDetailPage(product)) {
      await this.router.navigate(['/pos/add-meal', product.id]);
      return 'navigated';
    }
    await this.cartService.addItem(product);
    return 'added';
  }

  /** Resets the weight-capture request, typically after the dialog closes. */
  clearWeightCaptureRequest(): void {
    this.weightCaptureRequest.set(null);
  }

  //#endregion

  //#region Helpers

  /**
   * Mirrors `product-grid-inner.productRequiresDetailPage` — a product
   * needs the detail page when it has size variants OR at least one
   * non-empty modifier group.
   */
  private productRequiresDetailPage(product: Product): boolean {
    return (product.sizes?.length ?? 0) > 0
      || (product.modifierGroups?.some(g => (g.extras?.length ?? 0) > 0) ?? false);
  }

  //#endregion

}
