import { Injectable, computed, signal } from '@angular/core';

import { CartItem, Product, ProductExtra, ProductSize, PromotionEvaluation, calcUnitPriceCents } from '../models';
import { calculateItemTax } from '../utils/tax.utils';
import { DatabaseService } from './database.service';
import { ProductService } from './product.service';
import { PromotionService } from './promotion.service';
import { TenantContextService } from './tenant-context.service';

/**
 * Manages the active order cart.
 *
 * State is held in Angular signals (single source of truth) and persisted
 * to IndexedDB so the cart survives page refreshes.
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

  /**
   * Sentinel product id used for free-form "quick" items added from the
   * keypad/calculator UX (no underlying catalog product). Lines with this
   * id are never merged with one another and never count against
   * `productService` stock.
   */
  static readonly QUICK_ITEM_PRODUCT_ID = 0;

  /** Single source of truth for cart items */
  readonly items = signal<CartItem[]>([]);

  /** Latest promotion evaluation result (null when cart is empty) */
  readonly cartEvaluation = signal<PromotionEvaluation | null>(null);

  /** Total order amount in cents — derived from items + promotions */
  readonly totalCents = computed(() => {
    const evaluation = this.cartEvaluation();
    if (!evaluation) return 0;
    const subtotal = this.items().reduce((sum, i) => sum + i.totalPriceCents, 0);
    return Math.max(0, subtotal - evaluation.totalDiscountCents);
  });

  /**
   * Total tax (IVA) in cents — extracted from effective item prices after
   * discounts. Reads `tenantContext.defaultTaxRatePercent()` for items
   * that didn't pin an explicit rate; falls back to `0` while the tenant
   * config or the tax catalog is still hydrating (preview-only — backend
   * is authoritative on save). See `project_tax_authority.md`.
   */
  readonly totalTaxCents = computed(() => {
    const items = this.items();
    if (items.length === 0) return 0;
    const tenantDefaultPercent = this.tenantContext.defaultTaxRatePercent() ?? 0;
    return items.reduce((sum, item) => {
      const rate = item.taxRate ?? tenantDefaultPercent;
      const isTaxIncluded = item.product.isTaxIncluded !== false;
      return sum + calculateItemTax(item.totalPriceCents, item.discountCents, rate, isTaxIncluded);
    }, 0);
  });

  /** Subtotal (pre-tax) in cents — total minus extracted tax */
  readonly subtotalPreTaxCents = computed(() =>
    Math.max(0, this.totalCents() - this.totalTaxCents()),
  );

  /** Number of individual items in the cart (sum of quantities) */
  readonly itemCount = computed(() =>
    this.items().reduce((sum, i) => sum + i.quantity, 0),
  );

  /**
   * Emitted when an addItem/updateQuantity is rejected due to insufficient stock.
   * Components can read this signal to show a toast. Resets after 3 seconds.
   */
  readonly stockExceeded = signal<{ productName: string; available: number } | null>(null);

  /** Returns a snapshot of current cart items */
  getSnapshot(): CartItem[] {
    return [...this.items()];
  }
  //#endregion

  //#region Constructor & Initialization
  constructor(
    private readonly db: DatabaseService,
    private readonly productService: ProductService,
    private readonly promotionService: PromotionService,
    private readonly tenantContext: TenantContextService,
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
   * Enforces stock limits for trackStock products and applies optimistic deduction.
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
    // Stock guard — check available stock for trackStock products
    if (product.trackStock) {
      const available = this.productService.getAvailableStock(product.id);
      const inCart = this.getQuantityInCart(product.id);
      if (inCart + 1 > available) {
        this.emitStockExceeded(product.name, Math.max(0, available - inCart));
        return;
      }
    }

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
      // Carry the product's explicit override only. When undefined,
      // `totalTaxCents` resolves via `tenantContext.defaultTaxRatePercent()`
      // and the backend reconciles on save. AUDIT-053.
      taxRate: product.taxRate,
      discountCents: 0,
    };

    const updated = [...this.items(), newItem];
    await this.persist(updated);

    // Optimistic local deduction
    this.productService.deductLocalStock(product.id, 1);
  }

  /**
   * Adds a free-form "quick item" to the cart — used by the keypad UX
   * (Services/Gym/Quick verticals) to charge for something that isn't in
   * the catalog. The line carries a virtual product with the sentinel
   * id `QUICK_ITEM_PRODUCT_ID = 0`, so it never merges with prior quick
   * items even when description and price collide.
   *
   * @param description Free-form description shown on the ticket
   * @param priceCents Price in cents (must be > 0)
   */
  async addQuickItem(description: string, priceCents: number): Promise<void> {
    const trimmed = description.trim();
    if (!trimmed || priceCents <= 0) return;

    const virtualProduct: Product = {
      id: CartService.QUICK_ITEM_PRODUCT_ID,
      name: trimmed,
      priceCents,
      categoryId: 0,
      isAvailable: true,
      sizes: [],
      modifierGroups: [],
    };

    // `taxRate` is left undefined so the cart preview and the backend
    // both resolve from `tenantContext.defaultTaxRatePercent()` /
    // `business.defaultTaxId`. The TaxConfigGuard prevents this code
    // path from running without a configured tenant default.
    const newItem: CartItem = {
      id: crypto.randomUUID(),
      product: virtualProduct,
      quantity: 1,
      extras: [],
      unitPriceCents: priceCents,
      totalPriceCents: priceCents,
      discountCents: 0,
    };

    // Always create a new line — quick items must not merge.
    const updated = [...this.items(), newItem];
    await this.persist(updated);
  }

  /**
   * Updates the quantity of a cart item.
   * If quantity reaches 0, the item is removed from the cart.
   * Enforces stock limits and applies optimistic deduction/restoration.
   * @param itemId Cart item UUID
   * @param quantity New quantity (must be >= 0)
   */
  async updateQuantity(itemId: string, quantity: number): Promise<void> {
    if (quantity <= 0) {
      await this.removeItem(itemId);
      return;
    }

    const currentItem = this.items().find(i => i.id === itemId);
    if (!currentItem) return;

    const delta = quantity - currentItem.quantity;

    // Stock guard on increase
    if (delta > 0 && currentItem.product.trackStock) {
      const available = this.productService.getAvailableStock(currentItem.product.id);
      if (delta > available) {
        this.emitStockExceeded(currentItem.product.name, available);
        return;
      }
    }

    const updated = this.items().map(item =>
      item.id === itemId
        ? { ...item, quantity, totalPriceCents: item.unitPriceCents * quantity }
        : item,
    );
    await this.persist(updated);

    // Optimistic stock adjustment
    if (delta > 0) {
      this.productService.deductLocalStock(currentItem.product.id, delta);
    } else if (delta < 0) {
      this.productService.restoreLocalStock(currentItem.product.id, Math.abs(delta));
    }
  }

  /**
   * Removes a single item from the cart entirely.
   * Restores optimistic stock deduction.
   * @param itemId Cart item UUID
   */
  async removeItem(itemId: string): Promise<void> {
    const removedItem = this.items().find(i => i.id === itemId);
    const updated = this.items().filter(item => item.id !== itemId);
    await this.persist(updated);

    // Restore stock for the removed item
    if (removedItem) {
      this.productService.restoreLocalStock(removedItem.product.id, removedItem.quantity);
    }
  }

  /**
   * Empties the cart completely.
   * Only call this after a successful order has been recorded.
   */
  async clearCart(): Promise<void> {
    await this.db.cart.clear();
    this.reevaluatePromotions([]);
  }

  /**
   * Replaces the `metadata` blob on a single cart item. Used by
   * vertical-specific UI hooks (e.g. the Gym beneficiary selector
   * that attaches `{ beneficiaryCustomerId, membershipDurationDays }`
   * to a membership line). Pass `undefined` to clear the metadata.
   *
   * No-ops when the item id is no longer in the cart so a stale
   * dialog click never resurrects a removed line.
   * @param itemId Cart item UUID
   * @param metadata New metadata blob, or undefined to clear
   */
  async setItemMetadata(
    itemId: string,
    metadata: Record<string, unknown> | undefined,
  ): Promise<void> {
    const current = this.items();
    if (!current.some(i => i.id === itemId)) return;
    const updated = current.map(item =>
      item.id === itemId ? { ...item, metadata } : item,
    );
    await this.persist(updated);
  }
  //#endregion

  //#region Private Helpers

  /**
   * Returns the total quantity of a product currently in the cart
   * across all configurations (sizes/extras).
   * @param productId Product ID to sum
   */
  private getQuantityInCart(productId: number): number {
    return this.items()
      .filter(i => i.product.id === productId)
      .reduce((sum, i) => sum + i.quantity, 0);
  }

  /**
   * Emits a stock-exceeded warning and auto-clears it after 3 seconds.
   * @param productName Display name for the toast
   * @param available Remaining stock available
   */
  private emitStockExceeded(productName: string, available: number): void {
    this.stockExceeded.set({ productName, available });
    setTimeout(() => this.stockExceeded.set(null), 3000);
  }

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
    return this.items().find(item => {
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
   * on each CartItem, and sets the items signal with decorated data.
   * Called after every cart mutation and on initial load from Dexie.
   * @param items Raw cart items (without promotion discounts applied)
   */
  private reevaluatePromotions(items: CartItem[]): void {
    if (items.length === 0) {
      this.cartEvaluation.set(null);
      this.items.set([]);
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

    // Single atomic update — totalCents and itemCount derive via computed()
    this.items.set(updatedItems);
  }
  //#endregion

}
