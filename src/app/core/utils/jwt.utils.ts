/**
 * Pure helpers for inspecting JWT payloads on the client. The utilities
 * here intentionally avoid any HttpClient or service dependency so they
 * are safe to call from constructors and bootstrap-time hydration paths
 * without triggering the auth interceptor → AuthService cycle.
 */

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
