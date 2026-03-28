import { Injectable, signal } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

import { CartItem, Product, ProductExtra, ProductSize, PromotionEvaluation, calcUnitPriceCents } from '../models';
import { DatabaseService } from './database.service';
import { PromotionService } from './promotion.service';

/**
 * Manages the active order cart.
 *
 * State is held in a BehaviorSubject (reactive) and persisted to IndexedDB
 * so the cart survives page refreshes.
 *
 * Pricing rules (CLAUDE.md):
 *   - All monetary values are in cents
 *   - Quantities never go below 1 — remove the item instead
 *   - Total recalculates reactively on every change
 *   - Cart is cleared only after successful order completion
 */
@Injectable({ providedIn: 'root' })
export class CartService {

  //#region Properties
  private readonly _cart$ = new BehaviorSubject<CartItem[]>([]);

  /** Observable cart items — subscribe or use async pipe in templates */
  readonly cart$: Observable<CartItem[]> = this._cart$.asObservable();

  /**
   * Total order amount in cents (reactive signal).
   * Components can read this as a signal for change detection efficiency.
   */
  readonly totalCents = signal(0);

  /** Number of individual items in the cart (sum of quantities) */
  readonly itemCount = signal(0);

  /** Latest promotion evaluation result (null when cart is empty) */
  readonly cartEvaluation = signal<PromotionEvaluation | null>(null);

  /** Returns a snapshot of current cart items */
  getSnapshot(): CartItem[] {
    return [...this._cart$.getValue()];
  }
  //#endregion

  //#region Constructor & Initialization
  constructor(
    private readonly db: DatabaseService,
    private readonly promotionService: PromotionService,
  ) {
    this.loadFromDb();
  }

  /**
   * Loads the persisted cart from IndexedDB on startup.
   * Restores state so the cart survives page refreshes.
   */
  private async loadFromDb(): Promise<void> {
    try {
      const items = await this.db.cart.toArray();
      this.reevaluatePromotions(items);
    } catch (error) {
      console.error('[CartService] Failed to load cart from IndexedDB:', error);
    }
  }
  //#endregion

  //#region Cart Mutation Methods

  /**
   * Adds a product to the cart with the selected size and extras.
   * If an identical configuration already exists, increments its quantity.
   * @param product The product to add
   * @param size Selected size variant (optional)
   * @param extras Selected extras (may be empty)
   * @param notes Optional kitchen notes
   */
  async addItem(
    product: Product,
    size?: ProductSize,
    extras: ProductExtra[] = [],
    notes?: string,
  ): Promise<void> {
    const unitPriceCents = calcUnitPriceCents(product, size, extras);
    const existing = this.findMatchingItem(product.id, size?.id, extras.map(e => e.id));

    if (existing) {
      await this.updateQuantity(existing.id, existing.quantity + 1);
      return;
    }

    const newItem: CartItem = {
      id: crypto.randomUUID(),
      product,
      quantity: 1,
      size,
      extras,
      unitPriceCents,
      totalPriceCents: unitPriceCents,
      notes,
      discountCents: 0,
    };

    const updated = [...this._cart$.getValue(), newItem];
    await this.persist(updated);
  }

  /**
   * Updates the quantity of a cart item.
   * If quantity reaches 0, the item is removed from the cart.
   * @param itemId Cart item UUID
   * @param quantity New quantity (must be >= 0)
   */
  async updateQuantity(itemId: string, quantity: number): Promise<void> {
    if (quantity <= 0) {
      await this.removeItem(itemId);
      return;
    }

    const updated = this._cart$.getValue().map(item =>
      item.id === itemId
        ? { ...item, quantity, totalPriceCents: item.unitPriceCents * quantity }
        : item,
    );
    await this.persist(updated);
  }

  /**
   * Removes a single item from the cart entirely.
   * @param itemId Cart item UUID
   */
  async removeItem(itemId: string): Promise<void> {
    const updated = this._cart$.getValue().filter(item => item.id !== itemId);
    await this.persist(updated);
  }

  /**
   * Empties the cart completely.
   * Only call this after a successful order has been recorded.
   */
  async clearCart(): Promise<void> {
    await this.db.cart.clear();
    this.reevaluatePromotions([]);
  }
  //#endregion

  //#region Private Helpers

  /**
   * Finds a cart item that matches the same product + size + extras combination.
   * Used to merge duplicate configurations instead of creating duplicate rows.
   */
  private findMatchingItem(
    productId: number,
    sizeId: number | undefined,
    extraIds: number[],
  ): CartItem | undefined {
    const sortedExtras = [...extraIds].sort();
    return this._cart$.getValue().find(item => {
      if (item.product.id !== productId) return false;
      if ((item.size?.id ?? undefined) !== sizeId) return false;
      const itemExtras = item.extras.map(e => e.id).sort();
      return JSON.stringify(itemExtras) === JSON.stringify(sortedExtras);
    });
  }

  /**
   * Persists the cart state to IndexedDB and emits the new value.
   * @param items Updated cart items array
   */
  private async persist(items: CartItem[]): Promise<void> {
    try {
      await this.db.transaction('rw', this.db.cart, async () => {
        await this.db.cart.clear();
        if (items.length > 0) {
          await this.db.cart.bulkAdd(items);
        }
      });
      this.reevaluatePromotions(items);
    } catch (error) {
      console.error('[CartService] Failed to persist cart to IndexedDB:', error);
    }
  }

  /**
   * Evaluates promotions against current items, updates discount fields
   * on each CartItem, emits updated items, and recalculates totals.
   * Called after every cart mutation and on initial load from Dexie.
   * @param items Raw cart items (without promotion discounts applied)
   */
  private reevaluatePromotions(items: CartItem[]): void {
    if (items.length === 0) {
      this.cartEvaluation.set(null);
      this._cart$.next([]);
      this.totalCents.set(0);
      this.itemCount.set(0);
      return;
    }

    const subtotalCents = items.reduce((sum, i) => sum + i.totalPriceCents, 0);
    const evaluation = this.promotionService.evaluateCart(items, subtotalCents);
    this.cartEvaluation.set(evaluation);

    // Apply discount info to items (in-memory only — not persisted to Dexie)
    const updatedItems = items.map(item => {
      const itemDiscount = evaluation.itemDiscounts.get(item.id);
      return {
        ...item,
        discountCents: itemDiscount?.discountCents ?? 0,
        promotionId: itemDiscount?.promotionId,
        promotionName: itemDiscount?.promotionName,
      };
    });

    this._cart$.next(updatedItems);

    const count = updatedItems.reduce((sum, i) => sum + i.quantity, 0);
    const total = Math.max(0, subtotalCents - evaluation.totalDiscountCents);
    this.totalCents.set(total);
    this.itemCount.set(count);
  }
  //#endregion

}
