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
 * Locally-enriched event used by the dashboard live feed. Adds a
 * `receivedAt` timestamp captured at the moment the SignalR handler fires
 * — the broadcast DTO itself does not carry one, and a client-side
 * timestamp is close enough to the server clock for live display.
 */
export type LiveAccessEvent = AccessResultDto & { receivedAt: Date };
