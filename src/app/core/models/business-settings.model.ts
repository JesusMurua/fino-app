/**
 * Read shape of the business settings — what the backend returns from
 * `GET /api/business/settings`. `defaultTaxId` is nullable here because
 * a freshly onboarded tenant may not yet have selected one.
 */
export interface BusinessSettings {
  defaultTaxId: number | null;
}

/**
 * Write shape — request payload for `PUT /api/business/settings`.
 * `defaultTaxId` is mandatory here: the UI must validate that the admin
 * selected a value before allowing submit. The backend rejects null.
 */
export interface UpdateBusinessSettingsRequest {
  defaultTaxId: number;
}
