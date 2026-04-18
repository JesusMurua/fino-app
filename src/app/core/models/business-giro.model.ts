import { BusinessTypeId, MacroCategoryType } from '../enums';

/**
 * Payload for `PUT /api/business/giro` — idempotent write of the
 * tenant's giro selection produced by the onboarding wizard.
 *
 *   - `primaryMacroCategoryId` is required; the backend enforces it.
 *   - `businessTypeIds` carries the selected sub-giros (may be empty
 *     when the user only picked "Otra" or opted out of narrowing).
 *   - `customGiroDescription` is the free-text fallback emitted when
 *     "Otra" is checked. The backend stores it alongside the macro
 *     without materializing a synthetic `BusinessTypeId`.
 */
export interface UpdateBusinessGiroRequest {
  primaryMacroCategoryId: MacroCategoryType;
  businessTypeIds: BusinessTypeId[];
  customGiroDescription?: string;
}

/**
 * Payload returned by `GET /api/business/giro` — the current server-side
 * snapshot used to hydrate the onboarding wizard on re-entry.
 *
 * `primaryMacroCategoryId` is null when the tenant has not yet submitted
 * Step 1 (the JWT's macro is authoritative in that case). Empty
 * `businessTypeIds` + empty `customGiroDescription` means the user picked
 * a macro but skipped sub-giro refinement.
 */
export interface BusinessGiroResponse {
  primaryMacroCategoryId: MacroCategoryType | null;
  businessTypeIds: BusinessTypeId[];
  customGiroDescription: string | null;
}
