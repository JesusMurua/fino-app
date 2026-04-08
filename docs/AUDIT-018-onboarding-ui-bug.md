# AUDIT-018: Onboarding Step 1 — "Otra tienda" Bug & Multi-Selection Feasibility

**Date:** 2026-04-07  
**Status:** Open  
**Component:** `src/app/modules/onboarding/onboarding.component.ts`  
**Severity:** Blocker (user is trapped; cannot advance past Step 1)

---

## 1. Executive Summary

The "Siguiente" button stays disabled when a user selects "Otra tienda" in the retail sub-options grid because the card maps to `BusinessType.Retail` — the same value already stored in `jwtGiro`. The `canProceed()` guard explicitly blocks this exact condition. Additionally, no text input is rendered for the user to specify a custom store type when "Otra tienda" is selected.

**Multi-Selection Assessment:** The current architecture is **single-select by design** (a single `signal<BusinessType>`). Converting to multi-select is feasible but requires changes across 4 layers: state, template, validation, and backend API. The UI card pattern already resembles checkbox behavior visually and can be adapted cleanly.

---

## 2. Bug Analysis — "Otra tienda" Traps the User

### 2.1 Root Cause

**File:** [`onboarding.component.ts:370-376`](src/app/modules/onboarding/onboarding.component.ts#L370-L376)

```typescript
canProceed(): boolean {
  switch (this.currentStep()) {
    case 1: {
      if (!this.selectedGiro()) return false;
      // ⚠️ BUG: This line blocks "Otra tienda"
      if (this.isRetailGroup() && this.selectedGiro() === this.jwtGiro()) return false;
      return true;
    }
    // ...
  }
}
```

**Why it fails:** The `RETAIL_SUB_OPTIONS` array at line 70 maps "Otra tienda" to `BusinessType.Retail`:

```typescript
// Line 70
{ value: BusinessType.Retail, icon: '🏪', label: 'Otra tienda' },
```

When the JWT already contains `BusinessType.Retail` (the parent group), `jwtGiro()` is `'Retail'`. After the user clicks "Otra tienda", `selectedGiro()` becomes `'Retail'` as well. The guard at line 375 sees:

```
isRetailGroup() → true  (jwtGiro is Retail, which is in RETAIL_GROUP)
selectedGiro() === jwtGiro() → 'Retail' === 'Retail' → true
```

Result: `canProceed()` returns `false`. The "Siguiente" button stays disabled. **The user is trapped.**

### 2.2 The guard's original intent

The check was designed to force retail-group users to **pick a specific sub-type** (Abarrotes, Ferretería, Papelería, Farmacia) rather than staying on the generic `Retail` value. But it inadvertently made "Otra tienda" (which legitimately maps back to `Retail`) unreachable.

### 2.3 Missing custom text input

There is **no `<input>` element** anywhere in the Step 1 template for typing a custom store name. The HTML at lines 30–44 of the template only renders the card grid:

```html
<!-- Case A: Retail group from JWT — badge + sub-options -->
@if (isRetailGroup()) {
  <!-- ... badge ... -->
  <div class="giro-grid">
    @for (sub of retailSubOptions; track sub.value) {
      <button class="giro-card" ...>...</button>
    }
  </div>
  <!-- ⚠️ No @if block for a text input when "Otra tienda" is selected -->
}
```

**Expected behavior:** When the user selects "Otra tienda", a text input should appear (e.g., "Describe tu giro") so they can type a custom business type. This value should be sent to the backend alongside `BusinessType.Retail`.

### 2.4 `selectRetailSub()` fires the API but doesn't help

**File:** [`onboarding.component.ts:398-405`](src/app/modules/onboarding/onboarding.component.ts#L398-L405)

```typescript
async selectRetailSub(giro: BusinessType): Promise<void> {
  this.selectedGiro.set(giro);  // sets to 'Retail'
  try {
    await firstValueFrom(
      this.http.put(`${environment.apiUrl}/business/type`, { businessType: giro }),
    );
  } catch { /* best-effort */ }
}
```

The API call succeeds, but `canProceed()` still blocks navigation because the signal value matches `jwtGiro()`.

---

## 3. Recommended Fix for the Bug

### Option A — Minimal fix (allow Retail through when explicitly clicked)

Add a `customRetailConfirmed` signal that tracks whether the user deliberately clicked "Otra tienda":

**In `onboarding.component.ts`:**

```typescript
// New signal — line ~216 area
readonly customRetailConfirmed = signal(false);
readonly customRetailName = signal('');  // for the text input
```

**Update `selectRetailSub()`:**

```typescript
async selectRetailSub(giro: BusinessType): Promise<void> {
  this.selectedGiro.set(giro);
  this.customRetailConfirmed.set(giro === BusinessType.Retail);
  // ... existing API call ...
}
```

**Update `canProceed()` case 1:**

```typescript
case 1: {
  if (!this.selectedGiro()) return false;
  if (this.isRetailGroup() && this.selectedGiro() === this.jwtGiro()
      && !this.customRetailConfirmed()) return false;
  // When "Otra tienda" is confirmed, require a custom name
  if (this.customRetailConfirmed() && !this.customRetailName().trim()) return false;
  return true;
}
```

**Add text input in template (after the giro-grid, inside the `isRetailGroup()` block):**

```html
@if (selectedGiro() === 'Retail' && customRetailConfirmed()) {
  <div class="custom-retail-field">
    <label for="ob-custom-retail">¿Qué tipo de tienda?</label>
    <input
      id="ob-custom-retail"
      type="text"
      pInputText
      [ngModel]="customRetailName()"
      (ngModelChange)="customRetailName.set($event)"
      placeholder="Ej. Dulcería, Estética, Mercería"
    />
  </div>
}
```

**Lines of code affected:** ~15 lines added, 2 lines modified. No breaking changes.

---

## 4. Multi-Selection Feasibility Assessment

### 4.1 Current State Model (Single-Select)

| Layer | Current Implementation | Location |
|-------|----------------------|----------|
| State | `selectedGiro = signal<BusinessType>(...)` | `onboarding.component.ts:215` |
| Template | `[class.giro-card--active]="selectedGiro() === giro.value"` | `onboarding.component.html:64` |
| Validation | `canProceed()` checks single value | `onboarding.component.ts:370` |
| Backend | `PUT /business/type` sends `{ businessType: string }` | `onboarding.component.ts:505` |
| JWT | `businessType` claim = single string | `auth.service.ts` |

### 4.2 Target State Model (Multi-Select / Multi-Giro)

| Layer | Required Change | Effort |
|-------|----------------|--------|
| State | `selectedGiros = signal<Set<BusinessType>>(new Set())` | Low |
| Template | Toggle logic: add/remove from Set, active = `selectedGiros().has(giro.value)` | Low |
| Validation | `selectedGiros().size > 0` | Trivial |
| Backend API | `PUT /business/types` → `{ businessTypes: string[] }` | Medium |
| DB Schema | New join table `BusinessBusinessType` (M:N) or JSON column | Medium |
| JWT | `businessTypes: string[]` claim (array) | Low |
| Auth Service | `businessType()` → `businessTypes()` signal (array) | Medium |
| Downstream consumers | Every `authService.businessType()` call must handle array | **High** |

### 4.3 Downstream Impact Analysis

The `businessType` signal is consumed in **14+ files** across the codebase. Key consumers:

| Consumer | Usage | Multi-Giro Impact |
|----------|-------|--------------------|
| `PRICING_GROUP_MAP` | Maps single type → pricing tier | Needs strategy: highest tier? union? |
| `MODES_BY_GIRO` | Filters device modes | Union of all selected giros' modes |
| `ZONE_SUGGESTIONS` | Suggests zones | Union of all selected giros' zones |
| `isZoneStep` computed | Restaurant/Bar/Cafe → zones | `selectedGiros.has(...)` any of 3 |
| `completeOnboarding()` | Sends type to API | Must send array |
| Plan/feature gating | `BUSINESS_FEATURE_MAP` | Union of features across selected types |

### 4.4 Recommended Multi-Giro Implementation Strategy

**Phase 1 — Fix the bug first** (this PR):
- Implement Option A from Section 3
- Ship immediately to unblock users

**Phase 2 — Multi-Giro state refactor** (separate PR):

1. **State change** — Replace `selectedGiro` with `selectedGiros`:

```typescript
readonly selectedGiros = signal<Set<BusinessType>>(new Set([BusinessType.Restaurant]));

/** Primary giro (first selected, used for pricing/modes) */
readonly primaryGiro = computed(() => {
  const giros = this.selectedGiros();
  return giros.values().next().value ?? BusinessType.General;
});

toggleGiro(giro: BusinessType): void {
  this.selectedGiros.update(current => {
    const next = new Set(current);
    if (next.has(giro)) {
      next.delete(giro);
    } else {
      next.add(giro);
    }
    return next;
  });
}
```

2. **Template change** — Cards become toggleable checkboxes:

```html
<button
  type="button"
  class="giro-card"
  [class.giro-card--active]="selectedGiros().has(giro.value)"
  (click)="toggleGiro(giro.value)"
>
  @if (selectedGiros().has(giro.value)) {
    <i class="pi pi-check-circle giro-card__check"></i>
  }
  <!-- ... rest unchanged ... -->
</button>
```

3. **Validation** — `canProceed()` becomes:

```typescript
case 1: return this.selectedGiros().size > 0;
```

4. **Downstream** — Use `primaryGiro` for pricing/modes (keeps existing behavior) while storing all giros in the backend:

```typescript
// Zone suggestions: union of all selected giros
readonly zoneSuggestions = computed(() => {
  const zones: ZoneDraft[] = [];
  for (const giro of this.selectedGiros()) {
    zones.push(...(ZONE_SUGGESTIONS[giro] ?? []));
  }
  return [...new Map(zones.map(z => [z.name, z])).values()]; // dedup
});
```

5. **Backend API** — New endpoint or extend existing:

```
PUT /api/business/types
Body: { businessTypes: ["Papeleria", "Farmacia"] }
```

### 4.5 UI/UX Considerations for Multi-Select

- **Visual indicator:** The current green border + checkmark already looks like checkbox behavior. No design changes needed for the cards themselves.
- **Selection count badge:** Add a small pill above the grid: "2 giros seleccionados".
- **Max selections:** Consider capping at 3 to keep pricing/feature logic sane.
- **Primary giro:** If pricing differs by giro, either use the highest-priced tier or let the user designate one as primary.
- **Card animation:** Add a subtle scale pulse on toggle (0.95 → 1.0) for tactile feedback.

### 4.6 Effort Estimate

| Phase | Scope | Files Changed |
|-------|-------|---------------|
| Phase 1 (Bug fix) | 1 component (TS + HTML) | 2 |
| Phase 2 (Multi-Giro) | Component + AuthService + models + backend | ~8-12 |

---

## 5. Files Referenced

| File | Lines | Role |
|------|-------|------|
| [`onboarding.component.ts`](src/app/modules/onboarding/onboarding.component.ts) | 215, 370-376, 398-405 | State, validation, selection |
| [`onboarding.component.html`](src/app/modules/onboarding/onboarding.component.html) | 30-44, 301-306 | Template, button binding |
| [`onboarding.component.scss`](src/app/modules/onboarding/onboarding.component.scss) | 99-150 | Card styles (reusable as-is) |
| [`plan.model.ts`](src/app/core/models/plan.model.ts) | 10-23 | BusinessType enum |
| [`auth.service.ts`](src/app/core/services/auth.service.ts) | — | businessType signal consumer |

---

## 6. Conclusion

The bug is a **1-line logic error** in `canProceed()` that can be fixed in under 30 minutes. The multi-select refactor is architecturally clean but has moderate downstream impact due to the `businessType` signal being referenced across 14+ files. Recommend fixing the bug immediately (Phase 1) and planning Multi-Giro as a dedicated feature branch (Phase 2).
