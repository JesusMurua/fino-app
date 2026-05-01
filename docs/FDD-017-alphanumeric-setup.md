# FDD-017 — Alphanumeric Setup Screen & Agnostic UX Copy

> Phase 3 of the BDD-016 device-onboarding initiative. Frontend-only deliverable.
> **Status:** Draft — pending implementation approval.
> **Author:** Senior Angular Architect (Claude).
> **Date:** 2026-04-30.

---

## 0. Executive Summary

The `/setup` activation-code screen blocks alphanumeric input due to a `\D` regex that strips every non-digit before it reaches state — making the input "feel frozen" when the user types valid letters from the new secure-alphabet code (`[A-HJKMNP-TV-Z2-9]`). In parallel, the back-office cash-register link-code modal still uses copy that assumes specific hardware ("iPad") and a specific role ("cajero"), which breaks for non-restaurant verticals (gym reception, kiosk, kitchen).

This document specifies the frontend changes to:

1. Accept the secure alphabet end-to-end on `/setup` (state, paste, auto-advance, auto-backspace, select-on-focus, auto-submit).
2. Replace hardcoded hardware/role copy in the link-code modal with neutral, vertical-agnostic text.
3. Keep the existing `signal<string[]>` approach — no migration to `FormGroup` / `FormArray`.

> **Semantic note:** the modal in [admin-registers.component.html](../src/app/modules/admin/components/admin-registers/admin-registers.component.html) is technically a **caja-binding** modal (it links a cash register to an already-activated device), not a *device activation* modal. The copy update applies regardless, but downstream developers should keep that distinction clear when naming variables and writing future copy.

---

## 1. Interfaces / Models

No new interfaces. Existing ones receive **JSDoc-only** updates to reflect the new alphabet.

| File | Symbol | Change | Rationale |
|---|---|---|---|
| [device.service.ts](../src/app/core/services/device.service.ts) | `generateCode()` JSDoc (line 374-381) | "6-digit activation code" → "6-character alphanumeric activation code (secure alphabet `[A-HJKMNP-TV-Z2-9]`, ambiguous chars excluded)" | Aligns documentation with new backend contract. |
| [cash-register.service.ts](../src/app/core/services/cash-register.service.ts) | `generateLinkCode()` JSDoc (line 478-487) | "Same UX language as the device activation code" → keep the phrase but qualify: alphanumeric, 6 chars, secure alphabet | Same backend twin, same alphabet. |
| [setup.component.ts](../src/app/modules/setup/setup.component.ts) | State-machine JSDoc (line 71-83) | "enter 6-digit code" → "enter 6-character alphanumeric code" | Internal coherence. |
| [device.model.ts](../src/app/core/models/device.model.ts) | `ActivateDevicePayload.code` JSDoc (line 88-90) | "6-digit pairing code" → "6-character alphanumeric pairing code" | Type-level documentation. |

> Field types remain `string` everywhere — no shape change.

---

## 2. Componentes a Modificar

| # | File | Type | Scope of change | Risk |
|---|---|---|---|---|
| 1 | [setup.component.ts](../src/app/modules/setup/setup.component.ts) | Standalone component (TS) | Replace `\D` regex with secure-alphabet sanitizer; add paste handler; add select-on-focus; uppercase normalization; refine auto-advance / auto-backspace; auto-submit on 6th valid char | Medium — central to onboarding |
| 2 | [setup.component.html](../src/app/modules/setup/setup.component.html) | Standalone component (template) | `inputmode="numeric"` → `inputmode="text"`; `autocapitalize="characters"`; `(paste)` binding; `(focus)` binding for select-on-focus; subtitle "6 dígitos" → "6 caracteres" | Low |
| 3 | [setup.component.scss](../src/app/modules/setup/setup.component.scss) | Stylesheet | Add `text-transform: uppercase` + `letter-spacing` polish on `.setup-code__box` | Low |
| 4 | [admin-registers.component.html](../src/app/modules/admin/components/admin-registers/admin-registers.component.html) | Standalone component (template) | Replace hardcoded copy in `<p-dialog>` link-code modal; clean up HTML comment block | Low — copy-only |
| 5 | [device.service.ts](../src/app/core/services/device.service.ts) | Service (JSDoc) | JSDoc on `generateCode` | None |
| 6 | [cash-register.service.ts](../src/app/core/services/cash-register.service.ts) | Service (JSDoc) | JSDoc on `generateLinkCode` | None |
| 7 | [device.model.ts](../src/app/core/models/device.model.ts) | Model (JSDoc) | JSDoc on `ActivateDevicePayload` and `GenerateCodeResponse` | None |

> **Out of scope** — confirmed unchanged:
> - [pos-header.component.ts](../src/app/modules/pos/components/pos-header/pos-header.component.ts) (`onLinkCodeInput`, line 671) — already alphanumeric and uppercase.
> - All `/admin/devices` flows — `lastGeneratedCode` display is read-only and copy is already neutral.

---

## 3. Estructura del Estado Reactivo (Signals)

The existing `signal<string[]>(['', '', '', '', '', ''])` is preserved. No new top-level signals. One **constant** (the secure alphabet) and one **derived helper** (the sanitizer) are added as private members.

| Symbol | Kind | Type | Purpose |
|---|---|---|---|
| `codeDigits` (existing) | `WritableSignal` | `string[]` (length 6) | Authoritative state for the 6 cells. Each entry is `''` or one uppercase char from the secure alphabet. |
| `SECURE_ALPHABET_REGEX` (new) | `private readonly` constant | `RegExp` | Single source of truth for char validity: `/[^A-HJKMNP-TV-Z2-9]/g` (used to **strip** invalid chars). |
| `sanitizeChar()` (new) | `private` method | `(raw: string) => string` | Uppercases, runs the strip regex, returns the first remaining char or `''`. Used by both the `(input)` and `(paste)` handlers — guarantees both paths share identical filtering. |
| `sanitizePastedCode()` (new) | `private` method | `(raw: string) => string` | Uppercases, runs the strip regex on the full paste payload, returns up to 6 chars. |

### State transitions

| Trigger | Transition | Side effects |
|---|---|---|
| Valid char typed in cell `i` | `codeDigits[i]` ← uppercase char | Focus moves to cell `i+1` (if `i<5`); on `i=5` and all cells full → `submitCode()` |
| Invalid char typed in cell `i` | `codeDigits[i]` unchanged (cell remains as-is, **not blanked**) | No focus change. The DOM input value re-renders from the signal so the visual stays consistent (no "freeze"). |
| Backspace on cell `i` with non-empty value | `codeDigits[i]` ← `''` | Focus stays on cell `i` |
| Backspace on cell `i` already empty | `codeDigits[i]` unchanged | Focus moves to cell `i-1` (if `i>0`); the previous cell is **selected** so the user can immediately overwrite |
| Focus on any cell | No state change | Cell content is selected (`select()` on the input element) |
| Paste of N valid chars (N ≤ 6) starting at cell `i` | `codeDigits` cells `i..min(i+N-1, 5)` ← chars | Focus moves to first remaining empty cell. Auto-submit **only** when all 6 cells are non-empty after the paste. |

> The signal is mutated only via `.update(d => [...d])` (immutable update) — never via `.set` with the same reference, so existing change-detection assumptions hold.

---

## 4. Validaciones y UX

### 4.1 Char filtering policy

| Source | Rule | Outcome on invalid input |
|---|---|---|
| `(input)` event | One char from secure alphabet | Silent drop. Cell value re-renders from signal. **Cursor stays in the cell** so the user can keep typing. **No focus change**, no error toast, no shake. |
| `(paste)` event | All chars filtered against secure alphabet | Silent drop of invalid chars. Valid remainder distributed across cells starting at the focused cell. |
| `(keydown)` event | Backspace handled explicitly (see state-transitions table). All other keys fall through to native handling. | n/a |

### 4.2 Visual & micro-interactions

| Aspect | Specification |
|---|---|
| Casing | Inputs visually uppercase via CSS `text-transform: uppercase`. State stores uppercase chars. The `autocapitalize="characters"` attribute hints the mobile virtual keyboard. |
| `inputmode` | `"text"` (not `"numeric"`, not `"latin"`). Mobile keyboards stay on the alphabetic layout. |
| `maxlength` | Stays at `1` per cell (defense in depth — paste is handled by the explicit `(paste)` listener, not by the per-cell input). |
| Select-on-focus | `(focus)` handler calls `event.target.select()`. Lets the user replace the cell content with a single keystroke. |
| Letter-spacing | Slight `letter-spacing` increase on the cell font for legibility of similar chars. |
| Auto-submit | Triggered only when **all 6 cells are non-empty after a manual or pasted entry**. Implemented as `if (codeDigits().every(d => d !== '')) submitCode()`. |
| Loading / error states | Unchanged from current implementation (`isLoading`, `error` signals). |
| Subtitle copy | "Ingresa el código de 6 dígitos" → **"Ingresa el código de 6 caracteres"**. |

### 4.3 Edge cases (explicit, per FDD-017 review)

| Edge case | Behavior |
|---|---|
| **Paste with < 6 valid chars** | Distribute the valid chars starting at the focused cell. Leave focus on the **first empty cell** after the paste. **Do NOT auto-submit.** |
| **Paste with > 6 valid chars** | Truncate to 6, distribute across all cells starting at cell 0 (paste overrides current state). Auto-submit. |
| **Paste while not on cell 0** | Distribution starts at the focused cell. Existing chars in that range are overwritten. |
| **Backspace on cell with value** | Clears the cell. **Focus stays on that cell.** A second backspace then jumps to the previous cell (matches current behavior). |
| **Backspace on already-empty cell** | Moves focus to the previous cell and selects its content (so user can overwrite immediately). |
| **Char outside secure alphabet typed** | Silent drop. Cell content re-renders from signal. **Input must NOT appear frozen** — the user sees that nothing happened, focus stays put, no advance. |
| **Lowercase typed** | Normalized to uppercase before state write. Equivalent to typing the uppercase variant. |
| **Submit fired with partial state (race)** | Guarded by existing `if (code.length !== 6) return` in `submitCode()`. No regression. |

### 4.4 Modal copy (caja-binding dialog)

Location: [admin-registers.component.html](../src/app/modules/admin/components/admin-registers/admin-registers.component.html), lines 201-271.

| Element | Current (remove) | New (replace) |
|---|---|---|
| HTML comment block (L201-203) | `Link-code dialog — generated for an unlinked register so the cashier on the iPad can redeem it without an Owner/Manager being on-site.` | `Link-code dialog — issues a short-lived caja-binding code so a remote operator can pair their device with this register without an Owner/Manager being on-site.` |
| Dialog header (L206) | `'Código para ' + name` / `'Código de vinculación'` | **No change** — already neutral. |
| Intro paragraph (L223-226) | `Dictale este código al cajero. Lo ingresará en el iPad cuando vea "Dispositivo no vinculado".` | `Comparte este código con quien atenderá el dispositivo. Lo ingresará cuando vea la pantalla de "Dispositivo no vinculado".` |
| Copy button tooltip (L235) | `Copiar al portapapeles` | **No change** — already neutral. |
| Hint at the bottom (L257-260) | `El código se invalida automáticamente al usarse. Si lo escribiste mal, cierra este diálogo y genera uno nuevo.` | **No change** — already neutral. |

> The new intro text drops both hardware (`iPad`) and role (`cajero`) assumptions and references the *exact* string the operator will see on the destination screen ("Dispositivo no vinculado"), which exists verbatim in [setup.component.html](../src/app/modules/setup/setup.component.html). No spelling fix needed because the word `Dictale` is replaced entirely.

---

## 5. Flujo de Interacción de Usuario

### 5.1 Happy path — manual typing

| Step | User action | System response |
|---|---|---|
| 1 | Lands on `/setup`, header reads "Código de activación" + subtitle "Ingresa el código de 6 caracteres" | Cell 0 is auto-focused (existing behavior preserved). |
| 2 | Types `9` | Char accepted, cell 0 = `9`, focus → cell 1, cell 1 selected. |
| 3 | Types `3` | Cell 1 = `3`, focus → cell 2. |
| 4 | Types `v` (lowercase) | Normalized to `V`. Cell 2 = `V`, focus → cell 3. |
| 5 | Types `f`, `l` (`L` is not in secure alphabet) | Cell 3 = `F`, focus → cell 4. `L` → silent drop on cell 4, cell 4 stays empty, focus stays on cell 4. |
| 6 | Types `u` (also not in alphabet, since `U` is excluded) | Silent drop. User realizes the code shown to them must use the secure alphabet. |
| 7 | Types `T` | Cell 4 = `T`, focus → cell 5. |
| 8 | Types `9` | Cell 5 = `9`. All 6 cells non-empty → `submitCode()` fires automatically. |
| 9 | Backend validates → `step` flips to `code-review`. | Existing flow continues unchanged. |

### 5.2 Happy path — paste

| Step | User action | System response |
|---|---|---|
| 1 | Lands on `/setup`, focus on cell 0. | n/a |
| 2 | Pastes `93VFT9` (6 valid chars). | All 6 cells populate atomically. Auto-submit fires. |

### 5.3 Edge — paste with surrounding noise / partial validity

| Step | User action | System response |
|---|---|---|
| 1 | Pastes ` "93vft9" ` (whitespace + quotes around). | Sanitizer strips noise → `93VFT9`. All 6 cells populate. Auto-submit. |
| 2 | Pastes `93VF` (only 4 valid chars). | Cells 0-3 populate. Focus → cell 4. **No auto-submit.** User types remaining 2 chars manually. |

### 5.4 Edge — correcting a mistake

| Step | User action | System response |
|---|---|---|
| 1 | Cells 0-5 = `9`, `3`, `V`, `F`, `T`, `9`. Cursor at cell 5. Backend rejected (typo). | Error banner shows. |
| 2 | User clicks cell 2. | Focus → cell 2, cell 2 contents (`V`) selected. |
| 3 | User types `B`. | Cell 2 = `B` (overwrites `V`). Focus → cell 3, cell 3 selected. |
| 4 | User presses Tab/Right (or just types the rest) … | Standard navigation. |
| 5 | User presses Backspace on cell 3 (which has `F`). | Cell 3 cleared, focus stays. Backspace again → focus → cell 2, cell 2 selected. |

### 5.5 Caja-binding modal flow (Back Office)

| Step | Actor | Action / response |
|---|---|---|
| 1 | Owner/Manager | Opens `/admin/registers`, clicks "Generar código" on an unlinked register. |
| 2 | System | `<p-dialog>` opens; header "Código para {register name}". Loading spinner while `generateLinkCode()` resolves. |
| 3 | System | Code value (6 chars from the secure alphabet, monospace) + countdown + copy button rendered. |
| 4 | Owner/Manager | Reads new neutral copy: *"Comparte este código con quien atenderá el dispositivo. Lo ingresará cuando vea la pantalla de 'Dispositivo no vinculado'."* |
| 5 | Owner/Manager | Copies code, sends it via WhatsApp / radio / etc. to the operator at the device. |
| 6 | Operator (out of scope) | Enters the code on the device's session-blocker (`pos-header.component.ts`). |

---

## 6. Orden de Implementación

Sequenced to minimize regressions and let each change be tested in isolation.

| Phase | Step | File(s) | Description | Verification |
|---|---|---|---|---|
| **A — Copy & docs** (low risk, no logic) | A1 | [admin-registers.component.html](../src/app/modules/admin/components/admin-registers/admin-registers.component.html) | Replace HTML comment block + intro paragraph copy. | Open Back Office → Registers → "Generar código". Visual check of new copy. |
| | A2 | [device.service.ts](../src/app/core/services/device.service.ts), [cash-register.service.ts](../src/app/core/services/cash-register.service.ts), [device.model.ts](../src/app/core/models/device.model.ts), [setup.component.ts](../src/app/modules/setup/setup.component.ts) | JSDoc-only updates: "6-digit" → "6-character alphanumeric". | `npm run lint` passes. No behavior change. |
| **B — Setup logic** (core fix) | B1 | [setup.component.ts](../src/app/modules/setup/setup.component.ts) | Add `SECURE_ALPHABET_REGEX` constant + `sanitizeChar` private method. | Unit-testable in isolation. |
| | B2 | [setup.component.ts](../src/app/modules/setup/setup.component.ts) | Refactor `onCodeInput` to use `sanitizeChar`; ensure invalid chars cause **no** state mutation and **no** focus change. | Manual: type `1`, `0`, `I`, `L`, `O`, `U` → input does not advance, does not blank, does not freeze. Type `9` → advances. |
| | B3 | [setup.component.ts](../src/app/modules/setup/setup.component.ts) | Refine `onCodeKeydown` for the explicit two-step Backspace behavior (clear-then-jump). | Manual: fill 6 cells, backspace twice from last cell → cell 5 clears, then focus jumps to cell 4 with `T` selected. |
| | B4 | [setup.component.ts](../src/app/modules/setup/setup.component.ts) | Add `onCodeFocus(index, event)` handler for select-on-focus. | Manual: tab between cells → existing chars are highlighted. |
| | B5 | [setup.component.ts](../src/app/modules/setup/setup.component.ts) | Add `onCodePaste(index, event)` handler with `sanitizePastedCode`. | Manual: paste `93VFT9` → all cells populate, auto-submit fires. Paste `93VF` → only 4 cells fill, no submit. |
| **C — Setup template & styles** | C1 | [setup.component.html](../src/app/modules/setup/setup.component.html) | `inputmode="numeric"` → `"text"`; add `autocapitalize="characters"`; bind `(paste)` and `(focus)` to new handlers; subtitle copy. | Visual + paste/focus events fire as bound. |
| | C2 | [setup.component.scss](../src/app/modules/setup/setup.component.scss) | Add `text-transform: uppercase` + slight `letter-spacing`. | Visual check at desktop + tablet breakpoints. |
| **D — End-to-end** | D1 | All | Full activation cycle: generate code in `/admin/devices` → enter on `/setup` → land on `code-review` → confirm → reach `/pin` (or mode-specific entry). | Browser-based manual test on the dev server. |
| | D2 | All | Full caja-binding cycle: generate link-code in `/admin/registers` → redeem from a paired device's session-blocker. | Verify modal copy renders correctly in the Back Office. |

> **Stop conditions** — any of the following blocks merging:
> - User reports `/setup` still feels frozen on any invalid char.
> - Paste from a real terminal (with quotes, whitespace) does not auto-submit when the sanitized payload is exactly 6 valid chars.
> - Modal copy still references "iPad" or "cajero" anywhere (including HTML comments).
> - Type-check or lint regression in any touched file.

---

## 7. Out-of-scope (intentionally excluded)

| Item | Why deferred |
|---|---|
| Migration of `signal<string[]>` to `FormGroup`/`FormArray` | The signal-based approach is sufficient for 6 stateless cells with no cross-field validators. Per project constraints (`feedback_workflow.md`). |
| Restyling the cells (background, borders, focus rings beyond letter-spacing) | Out of bug-fix scope. Open a separate UX ticket if desired. |
| Localization (i18n) of the new copy | Project is currently Spanish-only. When i18n lands, both old and new strings will be ingested together. |
| Telemetry on invalid-char events | Useful for tuning the alphabet but not required for this fix. |
| Changes to `pos-header.component.ts` link-code redemption | Already alphanumeric (uses `.toUpperCase()`); no work required. |

---

## 8. Acceptance Criteria

| ID | Criterion | How to verify |
|---|---|---|
| AC-1 | A user can type a code containing letters from the secure alphabet on `/setup` without the input freezing. | Manual on dev server. |
| AC-2 | Characters outside the secure alphabet (`I`, `L`, `O`, `U`, `0`, `1`, lowercase outside alphabet, symbols, whitespace) are silently dropped without advancing focus or blanking the cell. | Manual. |
| AC-3 | Pasting a 6-char valid code populates all cells and auto-submits. | Manual. |
| AC-4 | Pasting a code with surrounding noise (whitespace, quotes) sanitizes correctly and behaves as a 6-char paste. | Manual. |
| AC-5 | Pasting fewer than 6 valid chars distributes them and leaves focus on the first empty cell, **without** auto-submit. | Manual. |
| AC-6 | Backspace on a non-empty cell clears it without changing focus; on an empty cell it moves focus back and selects the previous cell. | Manual. |
| AC-7 | Tabbing or clicking into a cell selects its content (select-on-focus). | Manual. |
| AC-8 | The link-code modal in `/admin/registers` shows the new neutral copy with no references to "iPad", "cajero" or "Dictale". | Visual. |
| AC-9 | All JSDoc references to "6-digit" in scoped files now read "6-character alphanumeric". | `git diff` review. |
| AC-10 | No regressions in `npm run lint`, `npm run build`, or existing unit tests. | CI. |
| AC-11 | The `pos-header` link-code redemption flow remains unchanged. | Smoke test on a paired device. |

---

**End of document.** Awaiting confirmation to proceed with **Phase A — Copy & docs**.
