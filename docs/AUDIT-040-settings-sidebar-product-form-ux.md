# AUDIT-040 — Settings UI, Sidebar Routing & Product Form UX

**Status:** Read-only audit — no files were modified.
**Date:** 2026-04-26
**Branch:** `refactor/settings-and-product-ux`

---

## 1. "Business Settings form is rendering empty"

### Files inspected
- [src/app/modules/admin/components/settings/admin-settings.component.ts](src/app/modules/admin/components/settings/admin-settings.component.ts)
- [src/app/modules/admin/components/settings/admin-settings.component.html](src/app/modules/admin/components/settings/admin-settings.component.html)
- [src/app/core/services/config.service.ts](src/app/core/services/config.service.ts)

### Finding — there is **no ReactiveForm here**
The "Business Settings" surface (`AdminSettingsComponent`, Negocio tab) does **not** use `ReactiveFormsModule` at all. The component is signals + `[(ngModel)]`/`[ngModel]+(ngModelChange)`:

- The whole tree hangs off the `config = signal<AppConfig>({ ...DEFAULT_APP_CONFIG })` signal at [admin-settings.component.ts:153](src/app/modules/admin/components/settings/admin-settings.component.ts#L153).
- `ngOnInit` calls `await this.configService.load()` at [admin-settings.component.ts:384-390](src/app/modules/admin/components/settings/admin-settings.component.ts#L384-L390) and pushes the resolved value into `config.set(appConfig)`.
- The HTML reads it back via `[ngModel]="config().businessName"` etc. (lines [49-79](src/app/modules/admin/components/settings/admin-settings.component.html#L49-L79)) and writes via `updateConfig('businessName', $event)`.

So *if* the form is empty, the bug is **not in `patchValue`** (there is none). It is one of the following, in order of likelihood:

| # | Cause | Evidence |
|---|-------|----------|
| 1 | `ConfigService.load()` returns `DEFAULT_APP_CONFIG` because Dexie is empty AND the API call fails (or 404s on `/branch/{id}/config`). | [config.service.ts:113-177](src/app/core/services/config.service.ts#L113-L177) — Step 1 falls back to `{ ...DEFAULT_APP_CONFIG }` when `db.config.get('main')` returns nothing; Step 2 wraps the fetch in `try/catch` and silently swallows API failures (`console.warn`). |
| 2 | The API responds, but with `businessName: ''` because the backend has the row but the column is null. The merge at [config.service.ts:149-162](src/app/core/services/config.service.ts#L149-L162) uses `remote.businessName` directly (no `?? config.businessName`), so an empty string from the server overwrites local data. |
| 3 | The user is logged into a branch whose Dexie store has not been hydrated yet (e.g. just switched branch and `revalidateFromApi` failed). |

**Recommended fix angle:**
- Add a fallback in the merge — `businessName: remote.businessName || config.businessName || ''`.
- Surface a "could not refresh from server" toast so the user knows whether they're reading stale data or no data.
- (Optional) Add a 4xx handler that distinguishes "no config row yet" from "permission denied" — today both look like "form is empty".

> If the user genuinely meant a separate `settings-business.component.ts`, **it does not exist in this repo** — no file matched the name. The Negocio tab is part of `AdminSettingsComponent`.

---

## 2. "Move 'Sucursales' from the main Sidebar into the Negocio tab as a Table"

### Files inspected
- [src/app/modules/admin/admin-shell.component.ts](src/app/modules/admin/admin-shell.component.ts)
- [src/app/modules/admin/admin.routes.ts](src/app/modules/admin/admin.routes.ts)
- [src/app/modules/admin/components/branches/admin-branches.component.ts](src/app/modules/admin/components/branches/admin-branches.component.ts)

### Finding — current state
- The "Sucursales" item is declared in the `navItems` array at [admin-shell.component.ts:133](src/app/modules/admin/admin-shell.component.ts#L133):
  ```ts
  { path: 'branches', icon: 'pi-sitemap', label: 'Sucursales' },
  ```
- It points to the `/admin/branches` route registered in [admin.routes.ts:109-112](src/app/modules/admin/admin.routes.ts#L109-L112), which lazy-loads `AdminBranchesComponent`.
- Historically, `AdminBranchesComponent` was extracted **out of** `AdminSettingsComponent` in FDD-016 (see comment at [admin-settings.component.ts:42-46](src/app/modules/admin/components/settings/admin-settings.component.ts#L42-L46)) so Managers (not just Owners) could reach it via its own URL.
- The current `business` tab settings already imports `TableModule` ([admin-settings.component.ts:71](src/app/modules/admin/components/settings/admin-settings.component.ts#L71)) — most of the wiring is in place.

### Proposed architecture
1. **Remove the nav entry** from `navItems` in `admin-shell.component.ts:133`. Do not delete the `/admin/branches` route — keep it as a deep-link target.
2. **Embed `AdminBranchesComponent` as a child section** at the bottom of the Negocio tab in `admin-settings.component.html` (right after the existing `Configuración de tu sucursal` card, around line 156). Two options:
   - **Recommended:** Add `<app-admin-branches inline />` and have `AdminBranchesComponent` accept an `@Input() inline: boolean` to suppress its own page chrome (toolbar, page title) and render only the table + dialog.
   - **Alternative:** Extract a new presentational `BranchTableComponent` from `AdminBranchesComponent` and render that. Cleaner long-term but more churn.
3. **Permission shield:** Wrap the embedded section in a computed that checks `authService.currentUser()?.roleId === Owner | Manager` so cashiers visiting Settings don't see it.
4. **Empty-state:** When `branches().length <= 1`, render the "Sucursal única" hint instead of a table — avoids visual noise for single-branch tenants.

This is the same pattern the Negocio tab already uses for the "Configuración de tu sucursal" read-only block, so the visual rhythm is consistent.

---

## 3. "Product Form — Save buttons are at the very bottom requiring scroll"

### Files inspected
- [src/app/modules/admin/components/products/product-form/product-form.component.html](src/app/modules/admin/components/products/product-form/product-form.component.html)
- [src/app/modules/admin/components/products/product-form/product-form.component.scss](src/app/modules/admin/components/products/product-form/product-form.component.scss)
- [src/app/modules/admin/admin-shell.component.scss](src/app/modules/admin/admin-shell.component.scss)

### Finding — the markup *intends* sticky, but the CSS chain is broken
- The footer is already declared as a sticky-style element via flexbox at [product-form.component.html:473-488](src/app/modules/admin/components/products/product-form/product-form.component.html#L473-L488) and styled with `flex-shrink: 0` at [product-form.component.scss:42-52](src/app/modules/admin/components/products/product-form/product-form.component.scss#L42-L52).
- The component sets `:host { height: 100% }` and `.product-form-page { display: flex; flex-direction: column; height: 100% }`.
- **The break is in the parent.** `AdminShellComponent` wraps the `<router-outlet />` in `<main class="content">` at [admin-shell.component.html:148-150](src/app/modules/admin/admin-shell.component.html#L148-L150). The `.content` rule at [admin-shell.component.scss:387-394](src/app/modules/admin/admin-shell.component.scss#L387-L394) is:
  ```scss
  .content {
    flex: 1;
    padding: $space-5;
    max-width: 1200px;
    width: 100%;
    margin: 0 auto;
    overflow-y: auto;   // ← scroll lives here, not inside the form
  }
  ```
  The route outlet's host element is a sibling inside `.content`, but `.content` itself is what scrolls. The product-form's `:host { height: 100% }` resolves against `<router-outlet>` (which has zero height by default), so the flex column never gets a constrained height and the footer falls *below the fold*.

### Proposed architectural fix
Two clean options — pick one, do not stack them:

**Option A — Make the route outlet a flex parent (preferred).** Change `.content` to:
```scss
.content {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;       // delegate scroll to the inner page
}
```
…and have each route component own its own padding + scroll region. This makes the existing flex-column layout in `product-form-page` actually work as designed and keeps the toolbar+footer pinned. Other admin pages may need a tiny `padding` adjustment, but they already use their own card layouts.

**Option B — Make the footer truly sticky in viewport.** Change `&__actions` in product-form.scss to:
```scss
&__actions {
  position: sticky;
  bottom: 0;
  z-index: 10;
  /* keep existing visual styling */
}
```
This is a one-component fix and does not require touching `admin-shell`. Trade-off: the footer floats above content rather than docking to the page bottom; on very short forms (mobile narrow viewport) the visual stacking can feel weird.

**Recommendation:** Option A. It's the layout the page was clearly designed for — the body already has `overflow: hidden` and `min-height: 0` (see scss:35-40), which only makes sense if `.content` does not also scroll. Fixing it once unlocks sticky toolbars/footers for every future admin page.

---

## 4. "Expose `Metadata.MembershipDurationDays` for Services/Gyms"

### Files inspected
- [src/app/modules/admin/components/products/product-form/product-form.component.ts](src/app/modules/admin/components/products/product-form/product-form.component.ts)
- [src/app/modules/admin/components/products/product-form/product-form.component.html](src/app/modules/admin/components/products/product-form/product-form.component.html)

### Finding — **already implemented for Gym sub-category**
- The `FormGroup` already declares `isMembership` and `membershipDurationDays` at [product-form.component.ts:96-98](src/app/modules/admin/components/products/product-form/product-form.component.ts#L96-L98) and [product-form.component.ts:585-586](src/app/modules/admin/components/products/product-form/product-form.component.ts#L585-L586).
- The form patches them from `product.metadata?.['membershipDurationDays']` at [product-form.component.ts:320-338](src/app/modules/admin/components/products/product-form/product-form.component.ts#L320-L338).
- The HTML renders the toggle + input at [product-form.component.html:140-161](src/app/modules/admin/components/products/product-form/product-form.component.html#L140-L161), guarded by `@if (isGymTenant())`.
- The save path composes the `metadata` payload via `composeMetadata(...)` at [product-form.component.ts:486-500](src/app/modules/admin/components/products/product-form/product-form.component.ts#L486-L500), which preserves sibling keys (forwards-compatible).
- `isGymTenant` resolves via `tenantContext.currentSubCategory() === SubCategoryType.Gym` ([product-form.component.ts:158-160](src/app/modules/admin/components/products/product-form/product-form.component.ts#L158-L160)).

### Gap analysis
The wiring is **only visible to `SubCategoryType.Gym`**. If the requirement is "all Services tenants" (e.g. spas, talleres, suscripciones genéricas), the gate is too narrow.

### Proposed architecture
Promote the visibility predicate to capture more verticals **without** loosening the metadata contract:

1. **Broaden the visibility computed** to either:
   - any sub-category in a `MEMBERSHIP_VERTICALS: ReadonlySet<SubCategoryType>` constant (Gym, Spa, etc.), OR
   - `tenantContext.currentMacro() === MacroCategoryType.Services` as a coarse fallback when sub-category is null.
   ```ts
   readonly showsMembership = computed(() =>
     MEMBERSHIP_VERTICALS.has(this.tenantContext.currentSubCategory() ?? -1 as SubCategoryType)
     || (this.tenantContext.currentSubCategory() == null
         && this.tenantContext.currentMacro() === MacroCategoryType.Services),
   );
   ```
2. Rename the template `@if (isGymTenant())` to `@if (showsMembership())` (mechanical rename in [product-form.component.html:141](src/app/modules/admin/components/products/product-form/product-form.component.html#L141)).
3. Adjust label copy to be vertical-neutral ("¿Es un producto con vigencia?" / "Días de vigencia") so it reads naturally for Services tenants who aren't gyms.
4. Keep `composeMetadata` as-is — it already preserves unknown keys, so adding more vertical-specific fields later (e.g. `sessionsIncluded`, `renewalGraceDays`) is a non-breaking addition.

Backend impact: zero — `metadata` is already a free-form bag in the DTO.

---

## Summary of proposed work order

| # | Area | Risk | Effort | Notes |
|---|------|------|--------|-------|
| 1 | Negocio tab "empty form" — investigate `ConfigService.load()` API merge | Low | S | Most likely API failure swallowed silently. Add visible error state. |
| 2 | Product Form sticky footer (Option A) | Low | S | Changes `admin-shell` `.content` rule; verify other admin pages don't regress. |
| 3 | Broaden `isGymTenant` → `showsMembership` for Services macro | Low | XS | Mechanical rename + computed update. |
| 4 | Remove `Sucursales` from sidebar & embed into Negocio tab | Med | M | Refactor `AdminBranchesComponent` to support `inline` mode; preserve `/admin/branches` route. |

No files were modified by this audit.
