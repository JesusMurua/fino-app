/**
 * Tax catalog entry — exact wire shape from `GET /api/taxes`.
 *
 * The backend stores `rate` as a decimal (e.g. `0.16` = 16%, `0.08` = 8%,
 * `0` = exempt). The TaxService applies the adapter pattern and decorates
 * the entry with `ratePercent` (an integer, e.g. `16`) so the rest of the
 * frontend stays in percentage units — keeping `tax.utils.ts` and the
 * existing cart math untouched.
 */
export interface Tax {
  /** Primary key from backend */
  id: number;
  /** Stable code (e.g. "IVA16", "IVA8", "IVA0", "EXEMPT") */
  code: string;
  /** ISO 3166-1 alpha-2 country code (e.g. "MX") */
  countryCode: string;
  /** Whether this is the global default for the country */
  isDefault: boolean;
  /** Display name shown to users (e.g. "IVA 16%", "Sin impuesto (Exento)") */
  name: string;
  /**
   * Raw decimal rate from the backend (e.g. 0.16). Authoritative for
   * server-side calculations; never mutate.
   */
  rate: number;
  /**
   * Integer percentage derived by `TaxService` via the adapter.
   * Optional in the wire shape — populated client-side after fetch.
   */
  ratePercent?: number;
}
