/**
 * Formats a `Date` as `yyyy-MM-dd` using **local** components.
 *
 * Use this for all query-string serialization of date-only filters that the
 * C# backend binds to `DateOnly`. The backend resolves the user's branch
 * timezone via `Branch.TimeZoneId` (BDD-013), so the frontend MUST send the
 * local calendar day — not the UTC slice of an ISO string.
 *
 * `toISOString().slice(0, 10)` would silently shift to the next day late at
 * night (e.g., `2026-05-01T23:30 local UTC-7` → `2026-05-02T06:30Z` →
 * `"2026-05-02"`), causing "today" filters to query tomorrow.
 *
 * @param d Date to serialize.
 * @returns `yyyy-MM-dd` string built from local year/month/day components.
 */
export function toLocalIsoDate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
