/**
 * Shared error-message catalog for the dynamic-form library.
 *
 * Extracted from `print-control-error.component.ts` in FDD-032 Phase 1
 * (Rule-of-3 prep — PrintControlError + PrintFormError consume the same
 * resolution priority).
 *
 * Priority:
 *   1. `override?.[key]` — consumer Input wins. Empty-string override
 *      ("") is honored explicitly so consumers can blank a key.
 *   2. Built-in catalog (sync + async + cross-field keys promoted in
 *      FDD-029 / FDD-031).
 *   3. Fallback `'Valor inválido'` for keys not in the catalog.
 */

/**
 * Resolves a user-facing error message for a given validation key.
 *
 * @param key      Error key from `AbstractControl.errors` or
 *                 `FormGroup.errors` (e.g. 'required', 'dateRange').
 * @param errorData The error value Angular attaches to the key — used
 *                 by parameterized messages (e.g. maxlength requiredLength).
 * @param override Optional consumer-provided per-key message map.
 */
export function resolveErrorMessage(
  key: string,
  errorData: unknown,
  override?: Record<string, string>,
): string {
  // Priority 1 — messages override (`!== undefined` preserves empty-string
  // overrides as a deliberate "render nothing for this key" signal).
  if (override?.[key] !== undefined) return override[key];

  // Priority 2 — built-in catalog.
  switch (key) {
    case 'required':
      return 'Campo requerido';

    case 'nonBlank':
      return 'No puede contener solo espacios';

    case 'positiveNumber':
      return 'Debe ser un número positivo';

    case 'maxlength': {
      const n = (errorData as { requiredLength?: number })?.requiredLength;
      return n !== undefined ? `Máximo ${n} caracteres` : 'Valor inválido';
    }

    case 'minlength': {
      const n = (errorData as { requiredLength?: number })?.requiredLength;
      return n !== undefined ? `Mínimo ${n} caracteres` : 'Valor inválido';
    }

    case 'min': {
      const n = (errorData as { min?: number })?.min;
      return n !== undefined ? `Valor mínimo: ${n}` : 'Valor inválido';
    }

    case 'max': {
      const n = (errorData as { max?: number })?.max;
      return n !== undefined ? `Valor máximo: ${n}` : 'Valor inválido';
    }

    // FDD-031 §4.3 — async + cross-field validator error keys.
    case 'availability':
      return 'No disponible';

    case 'dateRange':
      return 'Fecha de inicio debe ser anterior a la de fin';

    case 'matchingFields':
      return 'Los valores no coinciden';

    // Priority 3 — fallback for keys not in the catalog.
    default:
      return 'Valor inválido';
  }
}
