# AUDIT-041 — Device Setup Routing & Mode Verticalization

**Status:** Read-only audit — no files were modified.
**Date:** 2026-04-26
**Branch:** `refactor/settings-and-product-ux`

---

## TL;DR

1. **The redirect to `/setup` is not from a single bad guard — it's the natural endpoint of three separate paths that all converge on `/pin`, where `setupGuard` decides whether to bounce.** The Owner-bypass logic in `setupGuard` is correct in isolation, but it relies on `currentUser()` being populated at decision time. Several flows reach `/pin` with `currentUser()` already cleared (post `/auth/me` 401, fresh tab, post-register), and at that point the guard cannot tell an Owner from anyone else.
2. **The `modes[]` array in `SetupComponent` is statically declared and never gated by tenant context.** It cannot be gated client-side from this surface alone because the API the email flow calls (`/device/setup`) does not return tenant macro / sub-category info — only `businessId`, `businessName`, `branches[]`. The fix needs a backend change OR a different gating point.

---

## 1. Why does the user land on `/setup`?

### Files inspected
- [src/app/app.routes.ts](src/app/app.routes.ts)
- [src/app/core/guards/auth.guard.ts](src/app/core/guards/auth.guard.ts)
- [src/app/core/guards/setup.guard.ts](src/app/core/guards/setup.guard.ts)
- [src/app/core/guards/admin-shell.guard.ts](src/app/core/guards/admin-shell.guard.ts)
- [src/app/core/guards/provisioning.guard.ts](src/app/core/guards/provisioning.guard.ts)
- [src/app/core/guards/device-auth.guard.ts](src/app/core/guards/device-auth.guard.ts)
- [src/app/modules/login/login.component.ts](src/app/modules/login/login.component.ts)
- [src/app/core/services/device-routing.service.ts](src/app/core/services/device-routing.service.ts)
- [src/app/modules/setup/setup.component.ts](src/app/modules/setup/setup.component.ts)

### The exact bypass condition
[setup.guard.ts:23-40](src/app/core/guards/setup.guard.ts#L23-L40):

```ts
if (authService.sessionType() === 'email') return true;
if (isBackOfficeRole(authService.currentUser()?.roleId)) return true;
if (!configService.isDeviceConfigured()) {
  return router.createUrlTree(['/setup']);
}
```

Both bypasses require `currentUser()` (or the JWT-derived `sessionType()`) to resolve to a logged-in Owner/Manager **at the moment the guard runs**. If neither is true and the device has no config in IndexedDB, the user is redirected to `/setup`.

### Three paths that produce the unexpected `/setup` landing

| # | Trigger | Chain | Why bypass fails |
|---|---------|-------|------------------|
| **A** | App boots at `/` (unauthenticated, fresh device) | `''` → `/pin` ([app.routes.ts:17](src/app/app.routes.ts#L17)) → `setupGuard` → `/setup` | No JWT yet. `currentUser()` is null. Bypass cannot fire. |
| **B** | Owner navigates to a deep `/admin/*` URL after their session expired | `/admin/*` → `authGuard` → `isAuthenticated()` false → `/pin` ([auth.guard.ts:22-25](src/app/core/guards/auth.guard.ts#L22-L25)) → `setupGuard` → `/setup` | `authGuard` clears the URL into `RETURN_URL_KEY` but does NOT preserve the user. By the time `setupGuard` runs, no session remains. |
| **C** | Owner logs in successfully but `/auth/me` returns 401 mid-flight | `/login` → `getPostLoginRoute(Owner)` returns `/admin` → `adminShellGuard` calls `SessionRehydrationService.hydrateForShell('admin')` → returns `unauthorized` → `SessionRehydrationService` clears the session → `/pin` ([admin-shell.guard.ts:25-29](src/app/core/guards/admin-shell.guard.ts#L25-L29)) → `setupGuard` → `/setup` | `hydrateForShell` *clears* the session before redirecting. So when `setupGuard` evaluates `currentUser()`, it is null. |

Path **C** is the most likely match for the user's report ("logged in as Admin and was unexpectedly forced into /setup"). The user technically logged in, but a stale or clock-skewed token failed `/auth/me`, the session was wiped, and the chain dumped them at `/setup`.

### Secondary aggravating factor
[setup.guard.ts:35-37](src/app/core/guards/setup.guard.ts#L35-L37) only checks `isDeviceConfigured()`. It has **no awareness of role or session for the third decision** (kiosk redirect). That is fine, but it means any human session that loses its JWT on a Back Office device sees the consumer-facing setup UI — there is no "you appear to be a Back Office user, retry login" branch.

### Recommendation (routing layer)

Two complementary fixes:

1. **Tighten the Back Office bypass in `setupGuard`.** Use a stricter signal than `currentUser()?.roleId`, e.g. add `isBackOfficeRole(authService.previousUserRole())` reading from the persisted role flag *even when the live session was just cleared*. This way Path C still goes to `/login` (not `/setup`) when the rehydration fails. The persisted-role read must be cleared at logout to avoid surfacing for a different user later.
2. **Promote `adminShellGuard`'s `unauthorized` branch to redirect to `/login` instead of `/pin` when the persisted role indicates a Back Office user.** Keep `/pin` for terminal/PIN roles only. This also fixes Path C without altering `setupGuard`.

These changes are independent of the verticalization issue (Section 2) and can ship as their own commit.

---

## 2. Why does `/setup` show "Mesas" and "Pantalla de Cocina" for a Gym tenant?

### Files inspected
- [src/app/modules/setup/setup.component.ts](src/app/modules/setup/setup.component.ts)
- [src/app/core/services/tenant-context.service.ts](src/app/core/services/tenant-context.service.ts) (for available signals)

### Current state
[setup.component.ts:126-131](src/app/modules/setup/setup.component.ts#L126-L131):

```ts
readonly modes: ModeOption[] = [
  { value: 'cashier', icon: '💳', label: 'Caja Registradora',  description: 'Cobro y venta directa' },
  { value: 'tables',  icon: '🪑', label: 'Mesas',             description: 'Servicio a mesas (restaurante, bar)' },
  { value: 'kitchen', icon: '👨‍🍳', label: 'Pantalla de Cocina', description: 'Vista de pedidos para cocina' },
  { value: 'kiosk',   icon: '📱', label: 'Kiosko',            description: 'Autoservicio para clientes' },
];
```

This is a **static array** declared at the class level. There is **no filtering** by tenant macro, sub-category, or feature.

`TenantContextService` is **not injected** in `SetupComponent`. Even if it were, it would not help in the email flow: `submitEmail()` calls `POST /device/setup` (a *device-pairing* endpoint), not `/auth/login`. `SetupResponse` is:

```ts
interface SetupResponse {
  businessId: number;
  businessName: string;
  branches: BranchOption[];
}
```

(see [setup.component.ts:29-33](src/app/modules/setup/setup.component.ts#L29-L33))

…which carries **no tenant vertical info**. `BranchOption` is just `{ id, name }`. So there is currently no way for the frontend to know "this tenant is a Gym" at the moment the modes are rendered.

### Why the code-flow path doesn't have this problem
[setup.component.ts:393-417](src/app/modules/setup/setup.component.ts#L393-L417): the activation-code flow (`submitCode` → `code-review`) does **not** show a mode picker — the admin pre-selects the mode in Back Office when issuing the code, and the user just confirms. So vertical gating is **already correct on that path** because the gating happens upstream at code generation. The visible bug is exclusively in the **email flow** (the `mode` step at [setup.component.ts:322-356](src/app/modules/setup/setup.component.ts#L322-L356)).

### Three implementation options

#### Option A — Backend: enrich `/device/setup` response (recommended)
Add 4 fields to `SetupResponse`:
```ts
interface SetupResponse {
  businessId: number;
  businessName: string;
  branches: BranchOption[];
  // NEW:
  primaryMacroCategoryId: MacroCategoryType;
  subCategoryType?: SubCategoryType;
  hasKitchen: boolean;
  hasTables: boolean;
}
```
Then in the component:
```ts
readonly availableModes = computed(() => this.modes.filter(m => {
  switch (m.value) {
    case 'tables':  return this.tenantHasTables();
    case 'kitchen': return this.tenantHasKitchen();
    case 'kiosk':   return this.tenantContext.hasFeature(FeatureKey.KioskMode);
    case 'cashier': return true;
  }
}));
```
Cleanest. The backend already knows the answer; no extra round-trips. Backend change is small (3-4 columns already exist on the Branch / Business records).

#### Option B — Frontend: do a real auth login during email flow
Change `submitEmail` to call `authService.emailLogin(email, password)` before pairing the device. After login, `TenantContextService` populates with macro/sub-category. Then filter `modes` from those signals.

Trade-offs:
- Pro: No backend change.
- Con: Conflates two flows (device pairing vs user auth). After this, the user has a live JWT in localStorage on a shared device — that's a security regression, since the email flow is supposed to issue a *device token*, not a user token. Reject.

#### Option C — Per-branch gating only
Filter modes after `selectBranch()` based on `branch.hasKitchen` / `branch.hasTables`. Requires `BranchOption` to carry those flags (small backend change). Strictly weaker than Option A because:
- It does not gate `kiosk` (a feature-flag concern, not a branch concern).
- For a Gym tenant, `branch.hasTables = false` and `branch.hasKitchen = false`, but there is no positive signal to surface a Gym-specific "Recepción" mode (if/when one is added).

### Recommended gating rules

| Mode | Show when |
|------|-----------|
| `cashier` | Always (universal) |
| `tables` | `macro === FoodBeverage` AND `branch.hasTables === true` |
| `kitchen` | `(macro === FoodBeverage \|\| macro === QuickService)` AND `branch.hasKitchen === true` AND tenant has `FeatureKey.KdsBasic` or `RealtimeKds` |
| `kiosk` | Tenant has `FeatureKey.KioskMode` |

For a Gym tenant (macro = `Services`), only `cashier` and possibly `kiosk` (if their plan unlocks it) would be visible. The "Mesas" and "Pantalla de Cocina" cards disappear entirely.

### Future-proofing: vertical-specific modes
If a future Gym vertical needs a "Recepción" device mode (gym front desk), the same gating mechanism scales: add a `reception` entry with `show when subCategory === Gym`. Putting the filter logic in `availableModes` as a computed keeps the rule centralized.

---

## 3. Recommended order of operations

1. **First, fix Path C in routing** (Section 1, fix #2): update `adminShellGuard` to send Back Office users to `/login`, not `/pin`, on rehydration failure. This stops the most-visible bug — the Owner getting "stuck" at `/setup` — without touching the device pairing flow.
2. **Next, ship Option A** (backend `/device/setup` response enrichment) to gate the modes by vertical. This is independent and safe to ship behind a backend deploy.
3. **Then add the `availableModes` computed** in `SetupComponent` and switch the template's `*ngFor` over `modes` to iterate `availableModes()` instead.
4. (Optional, polish) Tighten `setupGuard` (Section 1, fix #1) for defense-in-depth.

No files were modified by this audit.
