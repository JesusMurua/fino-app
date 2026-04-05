import { Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import {
  AppliedPromotion,
  CartItem,
  ItemDiscount,
  Promotion,
  PromotionEvaluation,
  PromotionScope,
  PromotionType,
  RejectedPromotion,
  RejectionReason,
} from '../models';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';
import { DatabaseService } from './database.service';

/** Day-of-week bitmask: Sun=64, Mon=1, Tue=2, Wed=4, Thu=8, Fri=16, Sat=32 */
const DAY_BITMASK: Record<number, number> = {
  0: 64, // Sunday
  1: 1,  // Monday
  2: 2,  // Tuesday
  3: 4,  // Wednesday
  4: 8,  // Thursday
  5: 16, // Friday
  6: 32, // Saturday
};

/**
 * Manages branch promotions and evaluates them against the cart.
 *
 * Offline-first strategy:
 *   1. Load from Dexie immediately
 *   2. Fetch from API in background
 *   3. evaluateCart() is pure/synchronous — always works offline
 */
@Injectable({ providedIn: 'root' })
export class PromotionService {

  //#region State

  /** Active promotions for the current branch */
  readonly promotions = signal<Promotion[]>([]);

  /** Coupon-based promotion activated by the user */
  readonly activeCoupon = signal<Promotion | null>(null);

  readonly isLoading = signal(false);

  //#endregion

  //#region Constructor

  constructor(
    private readonly db: DatabaseService,
    private readonly api: ApiService,
    private readonly authService: AuthService,
  ) {}

  //#endregion

  //#region Public API

  /**
   * Loads active promotions from API and stores in Dexie.
   * Falls back to Dexie cache if API is unavailable.
   */
  async loadPromotions(): Promise<void> {
    this.isLoading.set(true);

    // Step 1 — Serve stale data from Dexie
    await this.getFromCache();

    // Step 2 — Try API
    try {
      const branchId = this.authService.branchId;
      const promos = await firstValueFrom(
        this.api.get<Promotion[]>(
          `/promotion/public/active?branchId=${branchId}`,
        ),
      );
      await this.db.transaction('rw', this.db.promotions, async () => {
        await this.db.promotions.clear();
        await this.db.promotions.bulkPut(promos);
      });
      this.promotions.set(promos);
      console.info('[PromotionService] Promotions updated from API');
    } catch (error) {
      console.warn('[PromotionService] API unreachable — using cached promotions:', error);
    } finally {
      this.isLoading.set(false);
    }
  }

  /**
   * Gets promotions from Dexie (offline-first).
   */
  async getFromCache(): Promise<Promotion[]> {
    try {
      const cached = await this.db.promotions
        .where('isActive')
        .equals(1)
        .toArray();
      if (cached.length > 0 && this.promotions().length === 0) {
        this.promotions.set(cached);
      }
      return cached;
    } catch {
      return [];
    }
  }

  /**
   * Validates a coupon code against the API.
   * Sets activeCoupon signal on success.
   * @param code The coupon code entered by the user
   * @returns Error message string if invalid, null if valid
   */
  async validateCoupon(code: string): Promise<string | null> {
    try {
      const promo = await firstValueFrom(
        this.api.get<Promotion>(
          `/promotion/validate-coupon?code=${encodeURIComponent(code)}&branchId=${this.authService.branchId}`,
        ),
      );
      this.activeCoupon.set(promo);
      return null;
    } catch (err: any) {
      if (err.status === 404) return 'Cupón no encontrado';
      if (err.status === 410) return 'Cupón expirado';
      if (err.status === 409) return 'Cupón ya utilizado';
      return 'Error al validar cupón';
    }
  }

  /**
   * Clears the active coupon.
   */
  clearCoupon(): void {
    this.activeCoupon.set(null);
  }

  /**
   * Core evaluation — pure and synchronous.
   * Evaluates all promotions against the current cart and returns full feedback.
   * @param items Current cart items
   * @param subtotalCents Sum of all item totalPriceCents (before discounts)
   * @returns Complete evaluation with applied, rejected, and discount breakdown
   */
  evaluateCart(items: CartItem[], subtotalCents: number): PromotionEvaluation {
    const allPromos = [...this.promotions()];
    const coupon = this.activeCoupon();
    if (coupon && !allPromos.find(p => p.id === coupon.id)) {
      allPromos.push(coupon);
    }

    const applied: AppliedPromotion[] = [];
    const rejected: RejectedPromotion[] = [];
    // Temporary: collect all item discounts before stacking resolution
    const rawItemDiscounts = new Map<string, { discount: ItemDiscount; promo: Promotion }[]>();
    let orderDiscountCents = 0;

    for (const promo of allPromos) {
      const eligibility = this.isEligible(promo, items, subtotalCents);
      if (!eligibility.eligible) {
        rejected.push({ promotion: promo, reason: eligibility.reason! });
        continue;
      }

      if (promo.type === PromotionType.OrderDiscount) {
        const discount = Math.floor(subtotalCents * promo.value / 100);
        orderDiscountCents += discount;
        applied.push({ promotion: promo, discountCents: discount });
      } else {
        const itemDiscounts = this.calculateItemDiscount(promo, items);
        for (const [itemId, disc] of itemDiscounts) {
          if (!rawItemDiscounts.has(itemId)) {
            rawItemDiscounts.set(itemId, []);
          }
          rawItemDiscounts.get(itemId)!.push({ discount: disc, promo });
          applied.push({
            promotion: promo,
            discountCents: disc.discountCents,
            appliedToItemId: itemId,
          });
        }
      }
    }

    // Resolve stacking conflicts per item
    const finalItemDiscounts = this.resolveStacking(rawItemDiscounts);

    const totalItemDiscountCents = Array.from(finalItemDiscounts.values())
      .reduce((sum, d) => sum + d.discountCents, 0);
    const totalDiscountCents = totalItemDiscountCents + orderDiscountCents;

    return {
      applied,
      rejected,
      itemDiscounts: finalItemDiscounts,
      orderDiscountCents,
      totalDiscountCents,
      totalSavedCents: totalDiscountCents,
    };
  }

  //#endregion

  //#region Private Evaluation Logic

  /**
   * Checks whether a promotion is eligible given the current cart state.
   * @param promo Promotion to check
   * @param items Current cart items
   * @param subtotalCents Order subtotal in cents
   */
  private isEligible(
    promo: Promotion,
    items: CartItem[],
    subtotalCents: number,
  ): { eligible: boolean; reason?: RejectionReason } {
    // Active check
    if (!promo.isActive) {
      return { eligible: false, reason: RejectionReason.Expired };
    }

    // Date range check
    const now = new Date();
    if (promo.startsAt && now < new Date(promo.startsAt)) {
      return { eligible: false, reason: RejectionReason.OutsideDateRange };
    }
    if (promo.endsAt && now > new Date(promo.endsAt)) {
      return { eligible: false, reason: RejectionReason.OutsideDateRange };
    }

    // Day-of-week bitmask check
    if (promo.daysOfWeek != null && promo.daysOfWeek > 0) {
      const todayBit = DAY_BITMASK[now.getDay()];
      if ((promo.daysOfWeek & todayBit) === 0) {
        return { eligible: false, reason: RejectionReason.WrongDay };
      }
    }

    // Minimum order amount
    if (promo.minOrderCents != null && subtotalCents < promo.minOrderCents) {
      return { eligible: false, reason: RejectionReason.MinOrderNotMet };
    }

    // Coupon requirement
    if (promo.couponCode && promo.id !== this.activeCoupon()?.id) {
      return { eligible: false, reason: RejectionReason.CouponRequired };
    }

    // Scope: product match
    if (promo.appliesTo === PromotionScope.Product) {
      const hasProduct = items.some(i => i.product.id === promo.productId);
      if (!hasProduct) {
        return { eligible: false, reason: RejectionReason.ProductNotMatch };
      }
    }

    // Scope: category match
    if (promo.appliesTo === PromotionScope.Category) {
      const hasCategory = items.some(i => i.product.categoryId === promo.categoryId);
      if (!hasCategory) {
        return { eligible: false, reason: RejectionReason.ProductNotMatch };
      }
    }

    return { eligible: true };
  }

  /**
   * Calculates item-level discounts for a single promotion.
   * @param promo The eligible promotion
   * @param items Current cart items
   * @returns Map of cartItemId → ItemDiscount
   */
  private calculateItemDiscount(
    promo: Promotion,
    items: CartItem[],
  ): Map<string, ItemDiscount> {
    const result = new Map<string, ItemDiscount>();
    const matching = this.getMatchingItems(promo, items);

    switch (promo.type) {
      case PromotionType.Percentage:
        for (const item of matching) {
          const disc = Math.floor(item.totalPriceCents * promo.value / 100);
          if (disc > 0) {
            result.set(item.id, {
              discountCents: disc,
              promotionId: promo.id,
              promotionName: promo.name,
            });
          }
        }
        break;

      case PromotionType.Fixed:
        for (const item of matching) {
          const disc = Math.min(promo.value, item.totalPriceCents);
          if (disc > 0) {
            result.set(item.id, {
              discountCents: disc,
              promotionId: promo.id,
              promotionName: promo.name,
            });
          }
        }
        break;

      case PromotionType.Bogo:
        for (const item of matching) {
          if (item.quantity >= 2) {
            const freeUnits = Math.floor(item.quantity / 2);
            result.set(item.id, {
              discountCents: freeUnits * item.unitPriceCents,
              promotionId: promo.id,
              promotionName: promo.name,
            });
          }
        }
        break;

      case PromotionType.Bundle: {
        const minQty = promo.minQuantity ?? 2;
        const paidQty = promo.paidQuantity ?? 1;
        for (const item of matching) {
          if (item.quantity >= minQty) {
            const sets = Math.floor(item.quantity / minQty);
            const freePerSet = minQty - paidQty;
            result.set(item.id, {
              discountCents: sets * freePerSet * item.unitPriceCents,
              promotionId: promo.id,
              promotionName: promo.name,
            });
          }
        }
        break;
      }

      case PromotionType.FreeProduct: {
        if (promo.freeProductId == null) break;
        const freeItem = items.find(i => i.product.id === promo.freeProductId);
        if (freeItem) {
          result.set(freeItem.id, {
            discountCents: freeItem.unitPriceCents,
            promotionId: promo.id,
            promotionName: promo.name,
          });
        }
        break;
      }
    }

    return result;
  }

  /**
   * Returns cart items that match a promotion's scope.
   * @param promo Promotion with appliesTo scope
   * @param items All cart items
   */
  private getMatchingItems(promo: Promotion, items: CartItem[]): CartItem[] {
    switch (promo.appliesTo) {
      case PromotionScope.All:
        return items;
      case PromotionScope.Category:
        return items.filter(i => i.product.categoryId === promo.categoryId);
      case PromotionScope.Product:
        return items.filter(i => i.product.id === promo.productId);
      default:
        return [];
    }
  }

  /**
   * Resolves stacking conflicts when multiple promotions target the same item.
   * - All stackable → sum discounts
   * - Any non-stackable → keep the single best discount
   */
  private resolveStacking(
    raw: Map<string, { discount: ItemDiscount; promo: Promotion }[]>,
  ): Map<string, ItemDiscount> {
    const result = new Map<string, ItemDiscount>();

    for (const [itemId, entries] of raw) {
      if (entries.length === 1) {
        result.set(itemId, entries[0].discount);
        continue;
      }

      const allStackable = entries.every(e => e.promo.isStackable);

      if (allStackable) {
        // Sum all stackable discounts
        const totalDisc = entries.reduce((sum, e) => sum + e.discount.discountCents, 0);
        result.set(itemId, {
          discountCents: totalDisc,
          promotionId: entries[0].discount.promotionId,
          promotionName: entries.map(e => e.discount.promotionName).join(' + '),
        });
      } else {
        // Keep the single best discount (best-for-customer)
        const best = entries.reduce((a, b) =>
          b.discount.discountCents > a.discount.discountCents ? b : a,
        );
        result.set(itemId, best.discount);
      }
    }

    return result;
  }

  //#endregion

}
