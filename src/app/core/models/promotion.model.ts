/** Types of promotions supported by the system */
export enum PromotionType {
  /** Percentage discount on item price */
  Percentage = 'Percentage',
  /** Fixed amount discount on item price (in cents) */
  Fixed = 'Fixed',
  /** Buy one get one free */
  Bogo = 'Bogo',
  /** Buy X pay Y (bundle pricing) */
  Bundle = 'Bundle',
  /** Percentage discount on the entire order */
  OrderDiscount = 'OrderDiscount',
  /** One unit of a specific product for free */
  FreeProduct = 'FreeProduct',
}

/** Scope of products a promotion applies to */
export enum PromotionScope {
  /** Applies to all products */
  All = 'All',
  /** Applies to products in a specific category */
  Category = 'Category',
  /** Applies to a specific product */
  Product = 'Product',
}

/** Reasons a promotion was rejected during evaluation */
export enum RejectionReason {
  WrongDay = 'WrongDay',
  MinOrderNotMet = 'MinOrderNotMet',
  MaxUsesReached = 'MaxUsesReached',
  Expired = 'Expired',
  CouponRequired = 'CouponRequired',
  ProductNotMatch = 'ProductNotMatch',
  OutsideDateRange = 'OutsideDateRange',
}

/** A promotion configured for a branch */
export interface Promotion {
  id: number;
  branchId: number;
  name: string;
  description?: string;
  type: PromotionType;
  appliesTo: PromotionScope;
  /** Discount value — meaning depends on type (percentage points or cents) */
  value: number;
  /** Minimum quantity required (for Bundle type) */
  minQuantity?: number;
  /** Number of items paid in a bundle (rest are free) */
  paidQuantity?: number;
  /** Product that becomes free (for FreeProduct type) */
  freeProductId?: number;
  /** Target category (when appliesTo = Category) */
  categoryId?: number;
  /** Target product (when appliesTo = Product) */
  productId?: number;
  /** Bitmask: Sun=64, Mon=1, Tue=2, Wed=4, Thu=8, Fri=16, Sat=32 */
  daysOfWeek?: number;
  /** ISO date string — promotion starts at this date */
  startsAt?: string;
  /** ISO date string — promotion ends at this date */
  endsAt?: string;
  /** Minimum order amount in cents to qualify */
  minOrderCents?: number;
  /** Maximum total uses across all orders */
  maxUsesTotal?: number;
  /** Maximum uses per day */
  maxUsesPerDay?: number;
  /** If set, promotion requires this coupon code to activate */
  couponCode?: string;
  /** Whether this promotion can stack with others on the same item */
  isStackable: boolean;
  isActive: boolean;
  createdAt: string;
}

/** A promotion that was successfully applied to the cart */
export interface AppliedPromotion {
  promotion: Promotion;
  /** Total discount amount in cents from this promotion */
  discountCents: number;
  /** Cart item this discount applies to (undefined for order-level) */
  appliedToItemId?: string;
}

/** A promotion that was evaluated but did not qualify */
export interface RejectedPromotion {
  promotion: Promotion;
  reason: RejectionReason;
}

/** Discount applied to a specific cart item */
export interface ItemDiscount {
  discountCents: number;
  promotionId: number;
  promotionName: string;
}

/** Full result of evaluating all promotions against the current cart */
export interface PromotionEvaluation {
  /** Promotions that qualified and were applied */
  applied: AppliedPromotion[];
  /** Promotions that did not qualify, with reasons */
  rejected: RejectedPromotion[];
  /** Per-item discount breakdown, keyed by CartItem.id */
  itemDiscounts: Map<string, ItemDiscount>;
  /** Order-level discount in cents */
  orderDiscountCents: number;
  /** Total of all discounts (item + order) in cents */
  totalDiscountCents: number;
  /** Customer-facing "you saved" amount in cents */
  totalSavedCents: number;
}
