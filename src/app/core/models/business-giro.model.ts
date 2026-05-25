import { BusinessTypeId, MacroCategoryType } from '../enums';

/**
 * Payload for `PUT /api/business/giro` — idempotent write of the
 * tenant's giro selection produced by the onboarding wizard.
 *
 *   - `primaryMacroCategoryId` is required; the backend enforces it.
 *   - `subGiroIds` carries the selected sub-giros (may be empty when the
 *     user only picked "Otra" or opted out of narrowing). The field name
 *     matches the backend BDD-015 contract — do NOT alias back to the
 *     legacy `businessTypeIds`.
 *   - `customGiroDescription` is the free-text fallback emitted when
 *     "Otra" is checked. The backend stores it alongside the macro
 *     without materializing a synthetic `BusinessTypeId`.
 */
export interface UpdateBusinessGiroRequest {
  /**
   * Wire-shape numeric macro id (FDD-028 F5 / wire reality). Typed as
   * the deprecated {@link MacroCategoryType} enum so the value lines
   * up with backend seed identifiers on the PUT payload.
   */
  primaryMacroCategoryId: MacroCategoryType;
  subGiroIds: BusinessTypeId[];
  customGiroDescription?: string;
}

/**
 * Payload returned by `GET /api/business/giro` — the current server-side
 * snapshot used to hydrate the onboarding wizard on re-entry.
 *
 * `primaryMacroCategoryId` is null when the tenant has not yet submitted
 * Step 1 (the JWT's macro is authoritative in that case). Empty
 * `subGiroIds` + empty `customGiroDescription` means the user picked
 * a macro but skipped sub-giro refinement.
 */
export interface BusinessGiroResponse {
  primaryMacroCategoryId: MacroCategoryType | null;
  subGiroIds: BusinessTypeId[];
  customGiroDescription: string | null;
}
