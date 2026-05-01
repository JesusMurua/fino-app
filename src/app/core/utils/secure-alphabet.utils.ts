/**
 * Pure helpers for the project's secure activation/link-code alphabet.
 *
 * The backend (BDD-016 / BDD-017) emits every device-activation and
 * cash-register link-code from a 30-character Crockford-like alphabet —
 * `[A-HJKMNP-TV-Z2-9]`. The visually ambiguous chars `I`, `L`, `O`, `U`,
 * `0` and `1` are excluded so codes can be dictated over the phone or
 * via radio without errors.
 *
 * This module is the **single source of truth** for that alphabet on the
 * frontend. Every UI input that accepts an activation/link-code must
 * sanitize through `sanitizeSecureCode` so the user sees consistent
 * silent-drop behavior across screens (FDD-017 / FDD-018).
 */

/**
 * Pattern matching characters that fall OUTSIDE the secure alphabet
 * `[A-HJKMNP-TV-Z2-9]`. Used as a global strip pattern via
 * `String.prototype.replace`. Exported for testability — production code
 * should call `sanitizeSecureCode` instead of consuming the regex directly.
 */
export const SECURE_ALPHABET_REGEX = /[^A-HJKMNP-TV-Z2-9]/g;

/**
 * Sanitizes a user-supplied string against the secure alphabet:
 *   1. Uppercases the input.
 *   2. Strips every char outside `[A-HJKMNP-TV-Z2-9]`.
 *   3. Optionally clamps the result to `maxLength` chars.
 *
 * Returns `''` when the input contained nothing valid. Callers rely on
 * this contract to implement the FDD-017 "silent drop" UX — when the
 * sanitized result equals the previous state, the UI should not advance
 * focus, shake, or surface an error.
 *
 * @param value     Raw input from `(input)` / `(paste)` events
 * @param maxLength Optional upper bound on the returned length (e.g. 1
 *                  for a single-cell input, 6 for a full-code paste)
 */
export function sanitizeSecureCode(value: string, maxLength?: number): string {
  const stripped = value.toUpperCase().replace(SECURE_ALPHABET_REGEX, '');
  return maxLength === undefined ? stripped : stripped.slice(0, maxLength);
}
