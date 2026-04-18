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
