/**
 * Pure helpers for inspecting JWT payloads on the client. The utilities
 * here intentionally avoid any HttpClient or service dependency so they
 * are safe to call from constructors and bootstrap-time hydration paths
 * without triggering the auth interceptor → AuthService cycle.
 */

import { MacroCategoryCode } from '../enums';

/**
 * Extracts the `features` claim from a JWT payload as a string array.
 *
 * The .NET backend may serialize the claim as a native JSON array
 * (`"features": ["X", "Y"]`) OR as a JSON-encoded string for legacy
 * compatibility (`"features": "[\"X\",\"Y\"]"`). This helper transparently
 * normalizes both shapes; anything else (missing claim, malformed JWT,
 * unparsable string) resolves to `undefined`.
 *
 * Returns `undefined` rather than throwing so callers can use the
 * idiomatic `if (features) …` pattern; a missing or malformed claim
 * is a recoverable signal, not an error condition.
 *
 * @param token Raw JWT string — must be the standard three-segment
 *              `header.payload.signature` shape.
 */
export function extractFeaturesFromJwt(token: string): readonly string[] | undefined {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return undefined;
    const payload = JSON.parse(atob(parts[1]));
    let feats = payload.features;
    if (typeof feats === 'string') {
      try { feats = JSON.parse(feats); } catch { return undefined; }
    }
    return Array.isArray(feats) ? feats : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Maps a backend `macroCategory` claim string to the typed
 * `MacroCategoryCode` string-literal union (FDD-028 F5 B1).
 *
 * Tolerant by design: the backend may emit casing variations
 * (`"services"`, `"Services"`), spaces (`"Quick Service"`), ampersands
 * (`"Food&Beverage"`), or punctuation we have not seen yet. We
 * normalise to lowercase alphabetic-only before comparing so a future
 * backend tweak does not silently break tenant context hydration. An
 * unknown / empty value resolves to `null`.
 */
export function parseMacroCategoryClaim(value: unknown): MacroCategoryCode | null {
  if (typeof value !== 'string') return null;
  const normalised = value.toLowerCase().replace(/[^a-z]/g, '');
  switch (normalised) {
    case 'foodbeverage':
    case 'foodandbeverage':
      return MacroCategoryCode.FoodBeverage;
    case 'quickservice':
      return MacroCategoryCode.QuickService;
    case 'retail':
      return MacroCategoryCode.Retail;
    case 'services':
      return MacroCategoryCode.Services;
    default:
      return null;
  }
}

/**
 * Extracts and parses the `macroCategory` claim from a JWT payload.
 *
 * Returns `null` for missing / empty / unrecognised values so callers
 * can use the idiomatic `if (macro !== null) …` pattern. Never throws.
 *
 * @param token Raw JWT string — must be the standard three-segment
 *              `header.payload.signature` shape.
 */
export function extractMacroCategoryFromJwt(token: string): MacroCategoryCode | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(atob(parts[1]));
    return parseMacroCategoryClaim(payload.macroCategory);
  } catch {
    return null;
  }
}
