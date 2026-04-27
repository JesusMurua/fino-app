# AUDIT-046 — Core Services Dependency Graph + DI Cycles

**Status:** Read-only audit. No files modified.
**Date:** 2026-04-26
**Branch:** `refactor/settings-enterprise-layout`

---

## TL;DR

- **48 services** under `src/app/core/services/`. Direct dependency map below.
- **6 dependency cycles** total. All transit through `AuthService ↔ TenantContextService` or `AuthService ↔ ConfigService`. Most are dormant — they only manifest when AuthService.constructor fires HTTP.
- **1 service has HTTP side effects in its constructor**: `AuthService` (the chain starts at `syncTenantContext` → `setContext` → `fetchPlanCatalog`).
- **The interceptor injects 4 services**, three of which transitively depend on AuthService. Lazy-injection only helps for the `logout()` path (already fixed in commit `fb6f6f6`); the request-time injects (ConfigService, DeviceService) cannot be deferred because they are needed synchronously to set the bearer token.
- **The `queueMicrotask` defer in `TenantContextService.setContext` is structurally correct** and should remain until at least step 1 of the proposed restructure lands. It's not a band-aid — it's the right answer to "service constructors should not fire HTTP".

---

## Step 1 — Direct dependencies

| Service | Injects |
|---|---|
| `ApiService` | `HttpClient` (built-in) |
| `AuthService` | `ApiService`, `DatabaseService`, `Router`, `TenantContextService` |
| `BranchDeliveryConfigService` | `HttpClient` |
| `BranchService` | `ApiService` |
| `BusinessService` | `ApiService` |
| `CartService` | `DatabaseService`, `ProductService`, `PromotionService` |
| `CashRegisterService` | `AuthService`, `MessageService`, `ApiService`, `DatabaseService`, `DeviceService` |
| `CatalogService` | `ApiService` |
| `ConfigService` | `DatabaseService`, `ApiService`, `AuthService` |
| `CustomerService` | `ApiService`, `AuthService`, `DatabaseService` |
| `DatabaseService` | (none — extends Dexie) |
| `DeliveryService` | `HttpClient` (no service deps) |
| `DeviceRoutingService` | `AuthService`, `ConfigService` |
| `DeviceService` | `ApiService`, `ConfigService` |
| `DiscountService` | `ApiService`, `DatabaseService` |
| `IdleService` | `ConfigService`, `OrderContextService`, `CartService`, `Router` |
| `InventoryConsumptionService` | `HttpClient` |
| `InventoryService` | `AuthService`, `DatabaseService`, `HttpClient` |
| `InvoicingService` | `ApiService`, `AuthService`, `DatabaseService`, `HttpClient` |
| `KioskDataService` | `ApiService`, `DatabaseService`, `ProductService` |
| `KitchenAudioService` | (none) |
| `KitchenService` | `MessageService` (optional), `DeviceService`, `KitchenAudioService`, `ApiService`, `DatabaseService` |
| `NotificationService` | `SwPush`, `ApiService`, `HttpClient`, `Router`, `MessageService`, `KitchenService` |
| `OnboardingChecklistService` | `CashRegisterService`, `PrinterService`, `ProductService`, `TenantContextService` |
| `OrderContextService` | (none) |
| `OrdersService` | `SyncService`, `ApiService`, `AuthService`, `DatabaseService` |
| `PaymentProviderService` | `ApiService`, `ConfigService` |
| `PrintService` | `ConfigService`, `DatabaseService`, `InvoicingService`, `PrinterDestinationService`, `PrinterService` |
| `PrinterDestinationService` | `DatabaseService` |
| `PrinterService` | `ConfigService` |
| `ProductCategoryService` | `ApiService`, `AuthService`, `DatabaseService`, `ProductService` |
| `ProductImportService` | `HttpClient` |
| `ProductService` | `ApiService`, `AuthService`, `DatabaseService`, `InventoryService` |
| `PromotionService` | `ApiService`, `AuthService`, `DatabaseService` |
| `PwaService` | `SwUpdate` |
| `ReportService` | `ApiService` |
| `ReservationService` | `ApiService` |
| `RouteAccessPolicy` | (none) |
| `ScannerService` | (none) |
| `SessionRehydrationService` | `AuthService` |
| `StockReceiptService` | `HttpClient` |
| `SupplierService` | `HttpClient` |
| `SyncService` | `DatabaseService`, `ApiService`, `AuthService`, `Injector` |
| `TableAssignmentService` | `DatabaseService`, `MessageService`, `OrderContextService`, `SyncService` |
| `TableService` | `DatabaseService`, `HttpClient` |
| `TenantContextService` | `CatalogService` |
| `UserService` | `HttpClient` |
| `ZoneService` | `HttpClient` |

---

## Step 2 — Identified cycles

All six cycles transit through the `AuthService` ↔ `TenantContextService` ↔ `CatalogService` ↔ `ApiService` triangle. Listed in the order they would manifest if every service were constructed during AuthService.constructor.

### Cycle 1 — direct (the original NG0200, now defused)
```
AuthService → TenantContextService → CatalogService → ApiService → (HTTP) → authInterceptor → inject(AuthService)
```
**Status**: defused by `runInInjectionContext` lazy-inject in interceptor (commit `fb6f6f6`) — AuthService.logout is only resolved on a 401 response, well after construction.

### Cycle 2 — via ConfigService (the second NG0200 you saw)
```
AuthService → TenantContextService → CatalogService → ApiService → (HTTP) → authInterceptor → inject(ConfigService) → ConfigService → AuthService
```
**Status**: defused by `queueMicrotask` defer in `TenantContextService.setContext` (commit `90213ec`).

### Cycle 3 — via DeviceService (latent, would manifest if Cycle 2 were fixed differently)
```
AuthService → TenantContextService → CatalogService → ApiService → (HTTP) → authInterceptor → inject(DeviceService) → DeviceService → ConfigService → AuthService
```
**Status**: defused by the same `queueMicrotask` because the HTTP no longer fires during construction.

### Cycle 4 — DeviceRoutingService
```
AuthService → ... → DeviceRoutingService → AuthService (via constructor injection)
```
**Status**: dormant. `DeviceRoutingService` is not in the auth interceptor or in any constructor reachable from AuthService.constructor. Listed for completeness — it would fire if some HTTP path injected `DeviceRoutingService` during AuthService construction, which it doesn't.

### Cycle 5 — SessionRehydrationService
```
AuthService → ... → SessionRehydrationService → AuthService
```
**Status**: dormant. SessionRehydrationService is only injected by guards (post-bootstrap), not by anything in the auth chain.

### Cycle 6 — implicit via every "AuthService-aware" service
Each service in the dep map that injects `AuthService` (CashRegisterService, CustomerService, InventoryService, InvoicingService, OrdersService, ProductCategoryService, ProductService, PromotionService, SyncService, ConfigService, DeviceRoutingService, SessionRehydrationService) creates a *potential* cycle if it ends up being injected by the interceptor. None of them are today, but if a future change adds e.g. `inject(ProductService)` to the interceptor, Cycle 6 fires immediately.

**Consolidated count**: 12 services hold a direct hard dependency on `AuthService`. Any one of them, if pulled into the interceptor, reignites the cycle.

---

## Step 3 — Constructors with side effects

The audit looks for: HTTP calls, observable subscriptions, calls to other services that may fire HTTP, and `effect()` blocks that could trigger HTTP on first run.

| Service | Constructor side effect | Detail | HTTP-on-init? |
|---|---|---|---|
| `ApiService` | `.pipe(catchError(...))` setup | Pure RxJS plumbing; no HTTP fires. | No |
| **`AuthService`** | **Calls `this.syncTenantContext()`** | **Triggers `tenantContext.setContext()` → `catalogService.fetchPlanCatalog()` → HTTP `GET /catalog/plans`. Source of Cycles 1–3.** | **YES** |
| `CartService` | Calls `this.loadFromDb()` | Reads Dexie `cart` table. Local-only. | No |
| `CashRegisterService` | `effect(...)` watching `authService.isAuthenticated()` → `silentlyRecoverLinkedRegister()` | `effect()` runs as a microtask AFTER DI hydration completes, so the HTTP call inside doesn't reach the constructor's call stack. | No (deferred) |
| `ConfigService` | Calls `this.loadDeviceConfig()` | Reads `localStorage[DEVICE_CONFIG_KEY]` only. Pure local. | No |
| `DatabaseService` | `this.version(N).stores({...})` | Dexie schema setup. No HTTP. | No |
| `DeliveryService` | `effect(() => { if (...) this.startPolling() })` | `effect()` is async; polling only starts when feature flag turns on. | No (deferred) |
| `DeviceService` | Reads/generates `localStorage[DEVICE_UUID_KEY]` | Pure local. | No |
| `IdleService` | Early-return if infra device | No HTTP. | No |
| `KitchenService` | n/a — `void this.loadPendingPrintJobs()` is in `start()`, NOT the constructor (false positive in regex sweep) | — | No |
| `NotificationService` | `swPush.messages.subscribe(...)` | Subscribes to push notifications. No HTTP. | No |
| `OnboardingChecklistService` | `effect(...)` watching tenant context | `effect()` is async. | No (deferred) |
| `OrdersService` | `this.stopPolling()` | Defensive cleanup. No HTTP. | No |
| `PromotionService` | n/a — `await this.getFromCache()` is inside an async method, not the constructor | — | No |
| `SyncService` | Empty body — `initialize()` is a separate method called explicitly by `AppComponent` | No constructor side effects. | No |

**Conclusion**: `AuthService` is the **only** service in the codebase that fires HTTP during construction. Everything else either uses `effect()` (which is microtask-deferred) or waits for an explicit `initialize()` / `start()` / `load()` method call.

---

## Step 4 — What the interceptor injects

[`auth.interceptor.ts`](src/app/core/interceptors/auth.interceptor.ts) — current state after commits `fb6f6f6` and `90213ec`:

| Inject | Where | Used in | Transitive deps to AuthService? |
|---|---|---|---|
| `EnvironmentInjector` | Top of interceptor (line ~38) | Captured for the lazy `runInInjectionContext` in the 401 handler. | No |
| `ConfigService` | Top of interceptor (line ~39) | Happy path — every request, via `resolveBearerToken()` to read `deviceConfig$.getValue().mode` | **YES — direct** (`ConfigService → AuthService`) |
| `DeviceService` | Top of interceptor (line ~40) | Happy path — every request, via `resolveBearerToken()` to read device token | **YES — indirect** (`DeviceService → ConfigService → AuthService`) |
| `MessageService` (PrimeNG) | Mid-body (line ~59) | Error path — 402 toast | No (PrimeNG service) |
| `AuthService` | **Lazy** inside `runInInjectionContext` in 401 handler | Error path only — `authService.logout()` | n/a (cached by the time it fires) |

### Why request-time injects can't be lazy

`ConfigService` and `DeviceService` are needed *before* the request fires to compute the `Authorization: Bearer …` header. Their injection runs synchronously in the same call stack as AuthService.constructor → fetchPlanCatalog → HTTP. Wrapping them in `runInInjectionContext` triggers the same construction; deferring the inject to a microtask would also defer the request, breaking every API call. So the only viable defense for these two paths is "AuthService.constructor must not fire HTTP synchronously" — exactly what `queueMicrotask` enforces.

---

## Step 5 — Restructure proposal (in priority order)

### Goal
Eliminate the architectural smell that AuthService's constructor fires HTTP. After the proposal, the queueMicrotask defer becomes redundant and can be removed safely. Latent Cycles 4–6 also dissolve because no service in the dep graph hydrates with HTTP side effects.

### Change A — Move `syncTenantContext` out of AuthService.constructor *(highest impact, smallest change)*

Today: [`auth.service.ts:165-170`](src/app/core/services/auth.service.ts#L165-L170)
```ts
constructor(...) {
  this.syncTenantContext();   // ← fires HTTP synchronously
}
```

Proposed: trigger from `AppComponent.ngOnInit` (already exists, already calls `authService.refreshSubscriptionStatus()`), or from an `APP_INITIALIZER` factory. AuthService still hydrates its signals from localStorage at field-init time (synchronous, no HTTP); it just stops kicking off the catalog fetch from the constructor itself.

Net effect:
- DI graph hydrates without any HTTP traffic.
- `AppComponent` (already running post-bootstrap) calls `authService.syncTenantContext()` once.
- Interceptor sees a fully cached injector for every subsequent request.
- All six cycles become structurally impossible to trigger.

**Blast radius**: low. One method call moved from one location to another. AuthService's public API doesn't change. `syncTenantContext` is already idempotent.

### Change B — Break `ConfigService → AuthService` *(medium effort, future-proofs the graph)*

Today: `ConfigService` only uses `AuthService.branchId` (one getter). The full AuthService dep is overkill.

Two options:

**B.1 — Extract `BranchContextService`**:
```ts
@Injectable({ providedIn: 'root' })
export class BranchContextService {
  readonly activeBranchId = signal<number>(loadStoredBranchId());
}
```
`AuthService` and `ConfigService` both inject `BranchContextService`. AuthService writes to it on login; ConfigService reads from it. No more circular reference.

**B.2 — Lazy injection inside ConfigService**:
```ts
private readonly injector = inject(Injector);
private get authService() { return this.injector.get(AuthService); }
```
Cheaper to write, less elegant. Mirrors the interceptor pattern.

Either option **breaks Cycles 2 and 3 at the type level**, not just at runtime.

**Blast radius**: medium for B.1 (a new tiny service + 2 services migrate to it). Low for B.2 (just ConfigService).

### Change C — Break `DeviceService → ConfigService` *(low priority, defense-in-depth)*

Today: `DeviceService` injects `ConfigService` to read `deviceConfig$`. After Change B, this no longer triggers a cycle, so this change is optional.

If desired: extract `DeviceConfigStore` (similar shape to BranchContextService) — pure localStorage reads, no AuthService dep. ConfigService reads from + writes to it; DeviceService reads from it.

**Blast radius**: low. Mostly mechanical.

### Change D — Remove the `queueMicrotask` defer

Once Change A lands, `TenantContextService.setContext` no longer fires from a constructor → no need to defer. Revert commit `90213ec` and let the catalog fetch run synchronously.

**Blast radius**: trivial.

### Change E — Remove the `runInInjectionContext` defensive code

Once Change A lands, the 401 handler can go back to `inject(AuthService)` at the top of the interceptor — no cycle path remains. Revert commit `fb6f6f6`.

**Blast radius**: trivial. Leaving the lazy pattern is also fine; it's idiomatic.

---

## Recommended order of implementation

| Step | Change | Effort | Risk | Required for next |
|---|---|---|---|---|
| 1 | **A** — Move `syncTenantContext` to `AppComponent.ngOnInit` (or APP_INITIALIZER) | XS | Low | — |
| 2 | **B.1 or B.2** — Break `ConfigService → AuthService` | M (B.1) / S (B.2) | Low | — |
| 3 | **D** — Remove `queueMicrotask` (verifies step 1 worked) | XS | Trivial | Step 1 must land first |
| 4 | **E** (optional) — Revert `runInInjectionContext` to eager inject | XS | Trivial | Step 1 + 2 must land first |
| 5 | **C** (optional) — Break `DeviceService → ConfigService` | S | Trivial | Step 2 |

Step 1 alone defuses every cycle at runtime. Steps 2–5 defuse them at the type level so the graph is correct by construction (no future regression possible without explicitly re-introducing the smell).

---

## Risks / open questions

1. **Could Change A break a consumer that depends on tenant context being primed before AppComponent renders?** Probably not — every consumer reads tenant context via signals or guards, which both run AFTER AppComponent.ngOnInit fires. But worth verifying with a route guard test to be certain.
2. **`SyncService` injects `Injector`** — this is the existing pattern for lazy resolution within a service. Confirms the team is comfortable with that pattern; B.2 is a low-risk option.
3. **`KitchenService` uses `inject(MessageService, { optional: true })`** — flag, not a problem; optional inject doesn't trigger a cycle.

No files were modified by this audit.
