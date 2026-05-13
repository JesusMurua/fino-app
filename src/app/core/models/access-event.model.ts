/**
 * Catalog entry from `GET /catalog/access-reasons`.
 *
 * Seeded by the backend `DbInitializer` with one row per `AccessReasonIds`
 * constant (1..7+). The `id` is what the SignalR broadcast carries in
 * `AccessResultDto.accessReasonId`; `code` is the stable string identifier
 * (e.g., `'membership_active'`, `'membership_frozen'`); `name` is the
 * human-readable Spanish label rendered in the live feed.
 */
export interface AccessReasonCatalog {
  id: number;
  code: string;
  name: string;
  sortOrder: number;
}

/**
 * SignalR payload broadcasted on the `AccessAttempted` event from
 * `BridgeHub` to clients in the `bridge-branch-{branchId}` group.
 *
 * `accessLogId` is null for "unknown QR" scans (no `AccessLog` row is
 * persisted in that path); non-null for granted / denied paths where the
 * backend persists a log entry post-SaveChanges and propagates the Id.
 */
export interface AccessResultDto {
  isGranted: boolean;
  accessReasonId: number;
  customerId: number | null;
  customerName: string | null;
  customerMembershipId: number | null;
  accessLogId: number | null;
}

/**
 * Locally-enriched event used by the dashboard live feed.
 *
 * - `receivedAt`: client-side timestamp captured when the SignalR handler
 *   fires. The broadcast DTO itself does not carry one; close enough to
 *   the server clock for live display.
 * - `localId`: frontend-generated UUID used as the stable `@for` track key.
 *   Required because `accessLogId` is `null` for unknown-QR scans (no log
 *   row persisted), and Angular 18's template compiler crashes (`tmp_X_Y
 *   is not defined`) when `??` appears inside a `track` expression.
 */
export type LiveAccessEvent = AccessResultDto & { receivedAt: Date; localId: string };
