/**
 * Persistent client-side cache record for a catalog endpoint response.
 *
 * Stored in the Dexie `catalogCache` table (one row per canonical route).
 * Mirrors the `(payload, etag)` envelope the backend service layer
 * computes internally (BDD-021 §4.1) — but the wire transports payload
 * and ETag separately (body + `ETag` header). The frontend reconstructs
 * the envelope from `response.body + response.headers.get('ETag')`.
 *
 * Per FDD-028 D2 / D4:
 *   - `route` is the canonical lowercase route string (PK).
 *   - `payload` is the raw DTO array as returned by the backend.
 *   - `etag` is verbatim (including surrounding double quotes).
 *   - `fetchedAt` is `Date.now()` at the moment of the last successful
 *     200 or 304 response. Used for the 24h hard eviction cap.
 */
export interface CatalogCacheRow {
  route:     string;
  payload:   unknown[];
  etag:      string;
  fetchedAt: number;
}

/**
 * Hard eviction cap on cache freshness (24h). Defends against the edge
 * case where the backend stops emitting fresh ETags for whatever reason
 * — the client never serves data older than 24h without an attempted
 * revalidation. See FDD-028 D2 / §7.3.
 */
export const CATALOG_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
