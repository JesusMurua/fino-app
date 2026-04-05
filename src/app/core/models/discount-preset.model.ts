/** A reusable discount configuration created by the owner */
export interface DiscountPreset {
  id: number;
  branchId: number;
  name: string;
  /** 'percent' applies a percentage, 'fixed' subtracts a fixed amount in cents */
  type: 'percent' | 'fixed';
  /** For percent: 0–100. For fixed: amount in cents */
  value: number;
  isActive: boolean;
  createdAt: Date;
}
