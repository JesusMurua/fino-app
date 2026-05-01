# FDD-018 — Universal Alphabet Sync & Link-Code Hardening

> Sibling of FDD-017. Closes the gap between `/setup` and `pos-header` link-code redemption.
> **Status:** Draft — pending implementation approval.
> **Author:** Senior Angular Architect (Claude).
> **Date:** 2026-04-30.

---

## 0. Executive Summary

[FDD-017](FDD-017-alphanumeric-setup.md) introduced the secure 30-character alphabet `[A-HJKMNP-TV-Z2-9]` (Crockford-like, with `I` / `L` / `O` / `U` / `0` / `1` excluded as visually ambiguous) and applied it end-to-end on the `/setup` activation-code screen. The same secure alphabet now governs **every** code emitted by the backend — both `/admin/devices` activation codes and `/admin/registers` link-codes — per the BDD-016/BDD-017 backend unification.

The `pos-header` session-blocker, where a cashier redeems an admin-issued link-code to bind an unattended device to a register, was **not updated** to enforce the alphabet client-side. Cashiers can currently type any chars they want (including `L`, `U`, `0`, `1`), let the backend reject the combination, and see a confusing 404 *"Código inválido o expirado"* — when the real cause is that the input contained a forbidden char.

This document specifies the frontend changes to:

1. Centralize `SECURE_ALPHABET_REGEX` and the canonical sanitizer in a single shared utility (`core/utils/secure-alphabet.utils.ts`).
2. Make `/setup` consume the shared utility (remove local duplication).
3. Apply the same sanitizer in `pos-header`'s `onLinkCodeInput` so invalid chars never reach the signal.
4. Refresh stale JSDoc and placeholder copy that pre-date the unified contract.

**Out of scope:** the `(paste)` / `(focus)` micro-interactions added to `/setup` in FDD-017. The `pos-header` blocker uses a single text input (not a 6-cell rig), and the `(input)` event already covers paste flow via the same handler. Adding paste-specific handling would be an enhancement, not a bug fix.

---

## 1. Interfaces / Models

No new interfaces. JSDoc-only refresh on one service method.

| File | Symbol | Change |
|---|---|---|
| [cash-register.service.ts](../src/app/core/services/cash-register.service.ts) | `redeemLinkCode` JSDoc | Qualify the *"Alphanumeric uppercase 6-char code"* phrase with the secure alphabet `[A-HJKMNP-TV-Z2-9]` and the BDD-017 contract reference. |

---

## 2. Components & Files to Modify

| # | File | Type | Scope of change | Risk |
|---|---|---|---|---|
| 1 | [src/app/core/utils/secure-alphabet.utils.ts](../src/app/core/utils/secure-alphabet.utils.ts) (NEW) | Utility module | Export `SECURE_ALPHABET_REGEX` constant + `sanitizeSecureCode(value, maxLength?)` pure function | Low |
| 2 | [setup.component.ts](../src/app/modules/setup/setup.component.ts) | Standalone component (TS) | Delete local `SECURE_ALPHABET_REGEX`, `sanitizeChar`, `sanitizePastedCode`; consumers (`onCodeInput`, `onCodePaste`) call the shared utility | Medium |
| 3 | [pos-header.component.ts](../src/app/modules/pos/components/pos-header/pos-header.component.ts) | Standalone component (TS) | `onLinkCodeInput` calls `sanitizeSecureCode(value, 6)`; JSDoc on `canRedeemCode` updated to drop the *"future expansion"* note and state the strict 30-char contract | Medium |
| 4 | [pos-header.component.html](../src/app/modules/pos/components/pos-header/pos-header.component.html) | Standalone component (template) | `placeholder="ABC123"` → `placeholder="P3K7H9"` (the `1` is forbidden by the alphabet) | Low |
| 5 | [cash-register.service.ts](../src/app/core/services/cash-register.service.ts) | Service (JSDoc) | JSDoc-only — qualify alphabet | None |

---

## 3. State Management

No changes to signals. The two consumers retain their existing state shape:

| Consumer | Signal | Type | Effect of refactor |
|---|---|---|---|
| `setup.component.ts` | `codeDigits` | `WritableSignal<string[]>` (length 6) | Unchanged — only the helper that writes to it is now an import instead of a local. |
| `pos-header.component.ts` | `linkCodeInput` | `WritableSignal<string>` | Unchanged — `onLinkCodeInput` body switches from `value.toUpperCase().slice(0, 6)` to `sanitizeSecureCode(value, 6)`. |

The shared utility itself is **stateless** — pure function with no side effects.

---

## 4. Validations & UX

### 4.1 Utility contract

| Symbol | Signature | Behavior |
|---|---|---|
| `SECURE_ALPHABET_REGEX` | `RegExp` (global flag) — `/[^A-HJKMNP-TV-Z2-9]/g` | Matches every char *outside* the secure alphabet. Used as a global strip pattern via `String.prototype.replace`. |
| `sanitizeSecureCode` | `(value: string, maxLength?: number) => string` | (1) `.toUpperCase()`, (2) `.replace(SECURE_ALPHABET_REGEX, '')`, (3) if `maxLength` is provided, `.slice(0, maxLength)`. Returns `''` when the input contained nothing valid. |

### 4.2 Behavior parity matrix

| Input scenario | `/setup` (post-FDD-017) | `pos-header` (post-FDD-018) |
|---|---|---|
| Type valid char (`B`, `9`, `K`) | Cell receives uppercase, focus advances | Char appended uppercase to `linkCodeInput` |
| Type ambiguous char (`L`, `U`, `0`, `1`, `O`, `I`) | Silent drop — cell value preserved, no advance | Silent drop — `linkCodeInput` unchanged at that keystroke |
| Type symbol or whitespace | Silent drop | Silent drop |
| Paste 6 valid chars | Distribute, auto-submit | (Native paste fires `(input)` → sanitizer keeps only valid chars, truncates to 6, button enables) |
| Paste with mixed valid/invalid (`ABCLU3`) | Valid chars distributed to first N cells, no auto-submit | `linkCodeInput` ends with `ABC3` (4 chars), button stays disabled until 6 |
| Paste >6 valid chars | Truncate to 6, distribute, auto-submit | Truncate to 6 via `sanitizeSecureCode(_, 6)` |

### 4.3 Single-input vs 6-cell asymmetry (intentional)

| Capability | `/setup` (6-cell) | `pos-header` (single input) | Reason |
|---|---|---|---|
| DOM/signal resync on invalid char | ✅ Required (per-cell `[value]` binding) | ❌ Not required — single-input `[value]="linkCodeInput()"` already re-renders on every signal write | The signal is updated to the **sanitized** value, which equals the previous value when nothing valid was added. Angular re-applies `[value]` on every change-detection cycle of the parent, and the difference between *"old + nothing"* and *"old"* is `''` — no DOM desync. |
| Two-step Backspace | ✅ Required | ❌ Native single-input behavior is correct | A single backspace on a single input clears one char. No focus-jump UX needed. |
| Select-on-focus | ✅ Required | ⚠️ Optional, not in scope | Not part of the FDD-017 hardening; cashier would need to clear manually if mis-typed. |
| `(paste)` handler | ✅ Required | ❌ Not required | Native paste fires `(input)` → sanitizer kicks in. Single input + sanitizer is sufficient for the cashier flow. |

### 4.4 Silent-drop policy (unchanged from FDD-017)

No shake animation. No error toast. No inline validation message. The user sees that the char did not appear, focus stays where it was, and the submit button stays disabled until a valid 6-char code lives in the signal.

> Rationale: shake/error feedback would diverge from FDD-017 §4.1 and create UX inconsistency between the two screens. If real cashiers report confusion, that's a separate UX-research-driven initiative.

### 4.5 Stale-doc cleanup

| Location | Current | New |
|---|---|---|
| [pos-header.component.ts:657-661](../src/app/modules/pos/components/pos-header/pos-header.component.ts#L657-L661) | *"We do not validate the charset client-side because a future backend change might expand it; the server is authoritative."* | *"Length-only check — the charset is enforced upstream by `sanitizeSecureCode`, which strips any char outside the secure alphabet `[A-HJKMNP-TV-Z2-9]` (BDD-017 unified contract). The server still validates as the authoritative source of truth."* |
| [pos-header.component.html:708](../src/app/modules/pos/components/pos-header/pos-header.component.html#L708) | `placeholder="ABC123"` | `placeholder="P3K7H9"` |
| [cash-register.service.ts:508](../src/app/core/services/cash-register.service.ts#L508) | `@param code Alphanumeric uppercase 6-char code dictated by the admin` | `@param code 6-char code from the secure alphabet [A-HJKMNP-TV-Z2-9] dictated by the admin` |

---

## 5. Implementation Order

| Phase | Step | File | Description | Verification |
|---|---|---|---|---|
| **A — Shared utility** | A1 | `secure-alphabet.utils.ts` (NEW) | Create the utility with `SECURE_ALPHABET_REGEX` + `sanitizeSecureCode`. | File exists. |
| **B — Setup refactor** | B1 | `setup.component.ts` | Import the utility. Delete local `SECURE_ALPHABET_REGEX`, `sanitizeChar`, `sanitizePastedCode`. Replace consumer calls in `onCodeInput` (1-char) and `onCodePaste` (6-char). | Lint clean; build green; grep returns single source. |
| **C — Pos-header hardening** | C1 | `pos-header.component.ts` | Import the utility. Replace `onLinkCodeInput` body. Update `canRedeemCode` JSDoc. | Lint + build. |
| | C2 | `pos-header.component.html` | Update placeholder. | Visual. |
| **D — Service docs** | D1 | `cash-register.service.ts` | Qualify `redeemLinkCode` JSDoc. | None. |

> Stop conditions:
> - Lint regression in any touched file.
> - Type-check / build regression.
> - `grep -r SECURE_ALPHABET_REGEX src/` returns more than one file (AC-1 fails).

---

## 6. Acceptance Criteria

| ID | Criterion | How to verify |
|---|---|---|
| **AC-1** | `sanitizeSecureCode` is the unique source of truth for charset filtering. | `grep -r SECURE_ALPHABET_REGEX src/` returns **only** `src/app/core/utils/secure-alphabet.utils.ts`. |
| **AC-2** | Typing `L`, `U`, `0`, `1`, `O`, `I` in any secure input results in a silent drop. | Manual smoke test on `/setup` and on the `pos-header` link-code blocker. |
| **AC-3** | Pasting `ABCLU3` into the link-code input ends with `ABC3` in the signal (4 valid chars, button disabled). | Manual smoke test on the `pos-header` blocker. |
| **AC-4** | The `pos-header` placeholder uses only chars from the secure alphabet. | Visual; `grep ABC123` returns no occurrences. |
| **AC-5** | No regressions in `npm run lint` or `npm run build`. | CI. |
| **AC-6** | The two existing FDD-017 ACs (typing/paste on `/setup`) continue to pass after the refactor. | Re-run AC-1 / AC-3 / AC-5 / AC-6 / AC-7 from FDD-017 §8. |

---

**End of document.** Awaiting confirmation to proceed with **Phase A — Shared utility**.
