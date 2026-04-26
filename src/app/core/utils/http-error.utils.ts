/**
 * HTTP error helpers shared across components that surface API errors
 * via PrimeNG's MessageService.
 *
 * Centralized so toast copy stays consistent (and translatable) without
 * each component duplicating the status-code → label mapping.
 */

/**
 * Maps an HTTP error to a short, user-friendly Spanish summary suitable
 * for a toast `summary` field. Accepts `unknown` so callers don't need
 * to coerce errors caught from RxJS streams or async/await blocks.
 *
 * Mapping:
 *   - 401, 403          → "Error de permisos"
 *   - 409               → "Conflicto: el registro ya existe"
 *   - 400, 422          → "Datos inválidos"
 *   - missing status    → "Sin conexión con el servidor" (network failure)
 *   - any other status  → "Error al guardar"
 *
 * @param err Error object or thrown value (typically `HttpErrorResponse`)
 * @returns Short user-facing label
 */
export function getHttpErrorSummary(err: unknown): string {
  const status = (err as { status?: number })?.status;
  if (status === 401 || status === 403) return 'Error de permisos';
  if (status === 409) return 'Conflicto: el registro ya existe';
  if (status === 422 || status === 400) return 'Datos inválidos';
  if (!status) return 'Sin conexión con el servidor';
  return 'Error al guardar';
}
