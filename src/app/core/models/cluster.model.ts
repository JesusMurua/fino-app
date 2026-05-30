/**
 * Cluster taxonomy for Macro 4 (Servicios Especializados) sub-giros.
 *
 * Mirrors the backend `ClusterCodes` static class (POS.Domain/Helpers/ClusterCodes.cs)
 * and the DB CHECK constraint on `BusinessTypeCatalog.ClusterCode`.
 * Backend emits the slug in the `BusinessTypeCatalog.clusterCode` field
 * for Services sub-giros; FE owns the Spanish display label + default-
 * visibility decision (presentation concerns).
 *
 * Adding / renaming a cluster requires a coordinated backend migration
 * (new constant + CHECK constraint update). See FDD-???.
 */

/** Canonical cluster slugs — must stay in sync with backend `ClusterCodes`. */
export const CLUSTER_CODES = [
  'beauty',
  'health',
  'automotive',
  'pets',
  'repair',
  'fitness',
  'education',
  'home',
  'events',
  'professional',
] as const;

export type ClusterCode = typeof CLUSTER_CODES[number];

/** Spanish display labels — FE-owned presentation. */
export const CLUSTER_LABELS: Record<ClusterCode, string> = {
  beauty:       'Belleza y Cuidado Personal',
  health:       'Salud y Bienestar',
  automotive:   'Automotriz',
  pets:         'Mascotas',
  repair:       'Reparación y Tecnología',
  fitness:      'Fitness y Deportes',
  education:    'Educación y Academias',
  home:         'Hogar y Servicios Técnicos',
  events:       'Eventos y Creativos',
  professional: 'Profesionales Independientes',
};

/**
 * Clusters surfaced by default in the wizard. The remaining 5 clusters
 * collapse under a "Ver más sub-giros" toggle — keeps the initial chip
 * list manageable while still exposing the full taxonomy on demand.
 */
export const DEFAULT_VISIBLE_CLUSTERS: ReadonlySet<ClusterCode> = new Set<ClusterCode>([
  'beauty',
  'health',
  'automotive',
  'pets',
  'repair',
]);

/**
 * Canonical display order — drives the cluster rendering sequence in
 * the wizard. Order: high-frequency SMB clusters first, then long-tail
 * under "Ver más".
 */
export const CLUSTER_DISPLAY_ORDER: readonly ClusterCode[] = CLUSTER_CODES;

/** Type guard for narrowing arbitrary strings to a known `ClusterCode`. */
export function isClusterCode(value: string | undefined | null): value is ClusterCode {
  return value !== null && value !== undefined && (CLUSTER_CODES as readonly string[]).includes(value);
}
