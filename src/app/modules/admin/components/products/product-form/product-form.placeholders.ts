import { PosExperience } from '../../../../../core/models/catalog.model';

/**
 * Vertical-aware placeholder strings shown inside the product form.
 *
 * Driven by `posExperience` (resolved server-side from the tenant's
 * business type) rather than the macro category, so adding a new
 * vertical (e.g. Hospitality) only requires a single entry here —
 * not a fan-out of switch statements across the form component.
 */
export interface ProductFormPlaceholders {
  name: string;
  modifierGroup: string;
  modifierExtra: string;
}

/**
 * Authoritative placeholder catalog keyed by `PosExperience`.
 * TypeScript enforces exhaustiveness — adding a new `PosExperience`
 * value forces a corresponding entry here, preventing silent fallback
 * to Restaurant copy (the bug AUDIT-058 §1.1 flagged in the legacy
 * twin-switch implementation).
 */
export const POS_EXPERIENCE_PLACEHOLDERS: Record<PosExperience, ProductFormPlaceholders> = {
  Restaurant: {
    name:          'Ej. Torta de Milanesa',
    modifierGroup: 'Nombre del grupo (ej. Proteína, Salsas)',
    modifierExtra: 'Ej. Queso extra, Sin cebolla',
  },
  Counter: {
    name:          'Ej. Café americano',
    modifierGroup: 'Nombre del grupo (ej. Tamaño, Leche)',
    modifierExtra: 'Ej. Leche de almendra',
  },
  Retail: {
    name:          'Ej. Coca-Cola 600ml',
    modifierGroup: 'Nombre del grupo (ej. Variedad)',
    modifierExtra: 'Ej. Color rojo, Talla M',
  },
  Quick: {
    name:          'Ej. Mensualidad',
    modifierGroup: 'Nombre del grupo (ej. Variantes)',
    modifierExtra: 'Ej. Opción adicional',
  },
  // `Services` is the canonical backend value for Services-macro tenants
  // (gym, spa, barbería, taller). Treated as a synonym of `Quick` per the
  // PosExperience type docs — same UX, kept distinct for backend parity.
  Services: {
    name:          'Ej. Mensualidad',
    modifierGroup: 'Nombre del grupo (ej. Variantes)',
    modifierExtra: 'Ej. Opción adicional',
  },
};

/**
 * Safe lookup with a Restaurant fallback for the brief window between
 * component init and tenant-context hydration (when `posExperience()`
 * may still be `undefined`). Restaurant copy was the original default
 * before this catalog landed, so the fallback preserves pre-existing
 * UX during cold-boot.
 */
export function placeholdersFor(experience: PosExperience | undefined): ProductFormPlaceholders {
  return POS_EXPERIENCE_PLACEHOLDERS[experience ?? 'Restaurant'];
}
