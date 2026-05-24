import {
  FieldDescriptor,
  ProductFormSchema,
  ProductFormSchemaRegistry,
  SectionDescriptor,
} from './product-form.schema';

/**
 * Per-vertical schemas for the product creation/edit form.
 *
 * AUDIT-058 Vector B POC: the registry is exhaustive over
 * `PosExperience`. Adding a new vertical (e.g. Hospitality) means
 * extending the `PosExperience` union and adding ONE entry here —
 * TypeScript will flag the missing key at compile time.
 *
 * Field set is currently identical across verticals (the form
 * collects the same product attributes); differentiation lives in
 * the `previewVariant` and in section-level `showSection` predicates
 * that gate Membership / Modifiers based on tenant capabilities.
 * Future vertical-specific fields (e.g. Hospitality "room number")
 * are added by appending to a vertical's `sections` only.
 */

// ---------------------------------------------------------------------------
// Shared section definitions — reused across most verticals
// ---------------------------------------------------------------------------

const SECTION_BASIC: SectionDescriptor = {
  id:          'basic',
  title:       'Información básica',
  icon:        'pi pi-info-circle',
  defaultOpen: true,
  fields: [
    {
      key:          'name',
      kind:         'text',
      label:        'Nombre',
      defaultValue: '',
      validators:   ['required', 'maxLength60', 'nonBlank'],
    },
    {
      key:          'description',
      kind:         'textarea',
      label:        'Descripción',
      defaultValue: '',
    },
    {
      key:          'barcode',
      kind:         'text',
      label:        'Código de barras / SKU',
      defaultValue: '',
      hint:         'Opcional. Para retail con escaneo.',
    },
    {
      key:          'pricePesos',
      kind:         'currency',
      label:        'Precio',
      defaultValue: 0,
      validators:   ['required', 'positiveNumber'],
      min:          0,
    },
    {
      key:          'categoryId',
      kind:         'category-picker',
      label:        'Categoría',
      defaultValue: null,
    },
    {
      key:          'isAvailable',
      kind:         'switch',
      label:        'Disponible para venta',
      defaultValue: true,
    },
  ],
};

const SECTION_INVENTORY: SectionDescriptor = {
  id:          'inventory',
  title:       'Inventario',
  icon:        'pi pi-box',
  defaultOpen: false,
  fields: [
    {
      key:          'trackStock',
      kind:         'switch',
      label:        'Controlar stock',
      defaultValue: false,
    },
    {
      key:          'currentStock',
      kind:         'integer',
      label:        'Stock inicial',
      defaultValue: 0,
      min:          0,
      showWhen:     (v) => v['trackStock'] === true,
    },
    {
      key:          'lowStockThreshold',
      kind:         'integer',
      label:        'Alerta mínima',
      defaultValue: 0,
      min:          0,
      showWhen:     (v) => v['trackStock'] === true,
    },
  ],
};

const SECTION_FISCAL: SectionDescriptor = {
  id:          'fiscal',
  title:       'Datos fiscales',
  icon:        'pi pi-receipt',
  defaultOpen: false,
  fields: [
    {
      key:          'satProductCode',
      kind:         'sat-code',
      label:        'Clave SAT del producto',
      defaultValue: '',
    },
    {
      key:          'satUnitCode',
      kind:         'dropdown',
      label:        'Unidad SAT',
      defaultValue: '',
    },
    {
      key:          'taxRate',
      kind:         'tax-picker',
      label:        'Tasa de impuesto',
      defaultValue: null,
    },
    {
      key:          'isTaxIncluded',
      kind:         'switch',
      label:        'Precio incluye impuestos',
      defaultValue: true,
    },
  ],
};

/** Membership section — section-level visibility is gated by tenant
 *  capability `supportsMemberships` (resolved at consumer level, not in the
 *  schema, so the schema stays decoupled from `TenantContextService`). */
const SECTION_MEMBERSHIP: SectionDescriptor = {
  id:          'membership',
  title:       'Vigencia y membresía',
  icon:        'pi pi-clock',
  badge:       { label: 'Servicios', variant: 'purple' },
  defaultOpen: false,
  fields: [
    {
      key:          'isMembership',
      kind:         'switch',
      label:        '¿Es un producto con vigencia?',
      defaultValue: false,
    },
    {
      key:          'membershipDurationDays',
      kind:         'integer',
      label:        'Días de vigencia',
      defaultValue: 30,
      validators:   ['min1', 'max3650'],
      min:          1,
      max:          3650,
      suffix:       ' días',
      hint:         'Al cobrar este producto, la vigencia del cliente se extenderá por este número de días.',
      showWhen:     (v) => v['isMembership'] === true,
    },
  ],
};

/** Modifiers section — gated by `supportsKitchenOrders` capability at the
 *  consumer level. Sizes and modifier groups are FormArray fields handled
 *  by dedicated renderer kinds. */
const SECTION_MODIFIERS: SectionDescriptor = {
  id:          'modifiers',
  title:       'Modificadores',
  icon:        'pi pi-sliders-h',
  badge:       { label: 'F&B', variant: 'blue' },
  defaultOpen: false,
  fields: [
    {
      key:          'printingDestinationId',
      kind:         'printer-picker',
      label:        'Destino de impresión',
      defaultValue: null,
      hint:         'Cocina, barra, etc. Donde se imprime la comanda de este producto.',
    },
    {
      key:          'sizes',
      kind:         'array-sizes',
      label:        'Tamaños',
      defaultValue: null,
      hint:         'Precio = base + cargo extra por tamaño.',
    },
    {
      key:          'modifierGroups',
      kind:         'array-modifier-groups',
      label:        'Grupos de modificadores',
      defaultValue: null,
    },
  ],
};

// ---------------------------------------------------------------------------
// Vertical-specific compositions
// ---------------------------------------------------------------------------

const RESTAURANT_SCHEMA: ProductFormSchema = {
  sections: [SECTION_BASIC, SECTION_MODIFIERS, SECTION_INVENTORY, SECTION_FISCAL],
  previewVariant: 'card-fb',
};

const COUNTER_SCHEMA: ProductFormSchema = {
  sections: [SECTION_BASIC, SECTION_MODIFIERS, SECTION_INVENTORY, SECTION_FISCAL],
  previewVariant: 'button-counter',
};

const RETAIL_SCHEMA: ProductFormSchema = {
  sections: [SECTION_BASIC, SECTION_INVENTORY, SECTION_FISCAL],
  previewVariant: 'row-retail',
};

const QUICK_SCHEMA: ProductFormSchema = {
  sections: [SECTION_BASIC, SECTION_MEMBERSHIP, SECTION_INVENTORY, SECTION_FISCAL],
  previewVariant: 'service-tile',
};

const SERVICES_SCHEMA: ProductFormSchema = {
  sections: [SECTION_BASIC, SECTION_MEMBERSHIP, SECTION_INVENTORY, SECTION_FISCAL],
  previewVariant: 'service-tile',
};

// ---------------------------------------------------------------------------
// Public registry
// ---------------------------------------------------------------------------

/**
 * Authoritative schema lookup. `Record<PosExperience, _>` enforces
 * exhaustiveness — TypeScript catches a missing vertical at compile.
 */
export const PRODUCT_FORM_SCHEMAS: ProductFormSchemaRegistry = {
  Restaurant: RESTAURANT_SCHEMA,
  Counter:    COUNTER_SCHEMA,
  Retail:     RETAIL_SCHEMA,
  Quick:      QUICK_SCHEMA,
  Services:   SERVICES_SCHEMA,
};

/**
 * Safe lookup with `Restaurant` fallback for the brief window between
 * component init and tenant-context hydration (when `posExperience()`
 * may still be `undefined`). Matches the fallback pattern in
 * `product-form.placeholders.ts` for behavioural consistency.
 */
export function schemaFor(experience: import('../../../../../../core/models/catalog.model').PosExperience | undefined): ProductFormSchema {
  return PRODUCT_FORM_SCHEMAS[experience ?? 'Restaurant'];
}

/**
 * Defensive — returns every field declared anywhere across the registry,
 * deduplicated by key. Used by the builder service to construct a
 * superset FormGroup that covers all possible verticals; sections that
 * are not part of the active schema simply hide their fields via
 * `showSection` / `showWhen` but the controls remain in the form so
 * vertical switches at runtime do not invalidate the FormGroup.
 */
export function allFieldDescriptors(): readonly FieldDescriptor[] {
  const seen = new Set<string>();
  const out: FieldDescriptor[] = [];
  for (const schema of Object.values(PRODUCT_FORM_SCHEMAS)) {
    for (const section of schema.sections) {
      for (const field of section.fields) {
        if (!seen.has(field.key)) {
          seen.add(field.key);
          out.push(field);
        }
      }
    }
  }
  return out;
}
