# POS Architecture — Current State

> Last updated: 2026-05-04 (post AUDIT-050 chameleon refactor + AUDIT-052 bounded-context decision)
> Purpose: Map the implemented POS shells, routing logic, and bounded contexts.

---

## 1. POS Shells — Two Bounded Contexts

The POS module contains **two distinct shells by design**, separated as bounded contexts because their transaction topologies are structurally incompatible. See [AUDIT-052](AUDIT-052-restaurant-hub-chameleon.md) for the full rationale; do not propose merging them.

### 1.1 Fast-Lane POS (Chameleon) — `UnifiedPosComponent` at `/pos/sell`

Single shell that consolidates the macros **Retail / Counter / Quick / Services**. Topology: 1 cashier ↔ 1 transient cart ↔ 1 linearised sale. The view mode (catalog grid ↔ keypad calculator) is driven by `PosViewModeService`, seeded from `tenantContext.posExperience()`, persisted in `localStorage`, and toggled from the header.

Composition:

| Slot | Component | Responsibility |
|---|---|---|
| Header | `<app-pos-header>` | Shift chip, sync indicator, view-mode toggle |
| Stage (`grid`) | `<app-product-grid-inner>` | Category sidebar + product tiles/list — no shell |
| Stage (`keypad`) | `<app-keypad-stage>` | Free-form description + price + recents + catalog search |
| Right pane | `<app-cart-panel [isGlassMode]="true" />` | Shared sidebar with opt-in glassmorphism |
| Inline cobro (non-F&B) | `<app-quick-pay>` | Cash dialog with bills + change, persists order |
| Overlay | `<app-delivery-panel>` | Optional, when `hasDelivery()` feature is on |

### 1.2 Full-Service F&B (Hub) — `RestaurantHubComponent` at `/pos`

Macro **Food & Beverage** only. Topology: 1 cashier ↔ N concurrent open orders (one per table) ↔ kitchen lifecycle (Pending → InProgress → Ready → Delivered) ↔ inter-order operations (move-items / merge / split-equal / split-by-items). Orders live minutes to hours.

Composition:

| Channel | Component | Responsibility |
|---|---|---|
| Tables (default) | `<app-tables>` | Floor map, zones, reservations, merge/split/move dialogs |
| Para Llevar (Takeout) | `<app-product-grid>` (legacy full shell with cart-panel embedded) | Walk-up bar; uses cart-panel branched via `isFoodAndBeverage()` to send to kitchen |
| Delivery | inline placeholder + `<app-delivery-panel>` overlay | Uber Eats / Rappi / DiDi Food integrations |

### 1.3 Standalone modes (orthogonal)

| Mode | Route | Component | Notes |
|---|---|---|---|
| Tables (direct nav) | `/tables` | `TablesComponent` | Same module mounted by hub; reachable directly when device mode is `tables` |
| Waiter | `/pos/waiter` | `WaiterPosComponent` | Feature-gated (`FeatureKey.WaiterApp`). Mobile-oriented |
| Kitchen Display (KDS) | `/kitchen/:destinationId` | `KitchenDisplayComponent` | Multi-area, real-time polling |
| Kiosk | `/kiosk` | `KioskShellComponent` | Self-service: idle timeout, welcome → catalog → detail → summary → ticket |
| Checkout | `/pos/checkout` | `CheckoutComponent` | Full payment page (F&B flow with cards/splits/tipping) |

---

## 2. Routing Logic

### 2.1 Post-login routing

```
User logs in (PIN or email)
      │
      ▼
DeviceRoutingService.getPostLoginRoute(roleId, deviceMode?)
      │
      ├── Owner / Manager ──────────── → /admin
      ├── Kitchen ───────────────────── → /kitchen
      ├── Host ──────────────────────── → /tables
      ├── Waiter
      │     ├── deviceMode = 'tables' → /tables
      │     └── otherwise ──────────── → /pos/waiter
      └── Cashier
            ├── deviceMode = 'tables'  → /tables
            ├── deviceMode = 'kitchen' → (hardware-shell error)
            └── otherwise ─────────── → resolvePosRoute()
```

### 2.2 `resolvePosRoute()` — Macro → Shell mapping

```
PosExperience      Route                 Shell
─────────────────  ────────────────────  ──────────────────────────────
'Restaurant'       /pos                  RestaurantHubComponent
'Retail'           /pos/sell             UnifiedPosComponent (default: grid)
'Counter'          /pos/sell             UnifiedPosComponent (default: grid)
'Quick'            /pos/sell             UnifiedPosComponent (default: keypad)
'Services'         /pos/sell             UnifiedPosComponent (default: keypad)
fallback           /pos/sell             UnifiedPosComponent (with console warn)
```

The default view mode in the chameleon is seeded by `PosViewModeService.initializeDefault(experience)` and persists per-device via `localStorage` once the cashier flips it.

### 2.3 BusinessTypeId → PosExperience

| BusinessTypeId | Macro | PosExperience | Route |
|---|---|---|---|
| Restaurant (1) | F&B | `Restaurant` | `/pos` (Hub) |
| Cafe (3) | F&B | `Restaurant` (Counter sub-mode of hub) | `/pos` |
| Bar (4) | F&B | `Restaurant` | `/pos` |
| FoodTruck (5) | F&B | `Counter` | `/pos/sell` (grid default) |
| Retail (2) | Retail | `Retail` | `/pos/sell` (grid default) |
| Abarrotes (8) | Retail | `Retail` | `/pos/sell` |
| Ferreteria (9) | Retail | `Retail` | `/pos/sell` |
| Papeleria (10) | Retail | `Retail` | `/pos/sell` |
| Farmacia (11) | Retail | `Retail` | `/pos/sell` |
| General (6) | Services | `Quick` / `Services` | `/pos/sell` (keypad default) |
| Taqueria (7) | Quick | `Quick` | `/pos/sell` (keypad default) |
| Servicios (12) | Services | `Services` | `/pos/sell` (keypad default) |

> Authoritative mapping is resolved through `CatalogService` from the backend's `BusinessTypeCatalog.posExperience` field. The table reflects expected defaults and the local `MACRO_POS_EXPERIENCE` fallback in `device-routing.service.ts`.

### 2.4 Device mode values

```typescript
type DeviceMode = 'cashier' | 'kiosk' | 'tables' | 'kitchen' | 'admin' | 'reception';
```

Stored in localStorage as Base64-obfuscated JSON. Legacy values are auto-migrated:
- `'counter'` → `'cashier'`
- `'waiter'` → `'tables'`

---

## 3. Plan Limits & Feature Flags

### 3.1 Quantitative limits

| Limit | Free | Basic | Pro | Enterprise |
|---|---|---|---|---|
| Max users | 3 | Unlimited | Unlimited | Unlimited |
| Max products | 100 | Unlimited | Unlimited | Unlimited |

> Defined in `PLAN_LIMITS` at `src/app/core/models/plan.model.ts`.

### 3.2 Feature matrix

| Feature | Free | Basic | Pro | Enterprise |
|---|---|---|---|---|
| Thermal Printing | Yes | Yes | Yes | Yes |
| Barcode Scanner | — | Yes | Yes | Yes |
| Weight Scale | — | — | — | Yes |
| Zones | — | Yes | Yes | Yes |
| Bar Seats | — | Yes | Yes | Yes |
| Kiosk Mode | — | Yes | Yes | Yes |
| Tables | — | Yes | Yes | Yes |
| Inventory | — | Yes | Yes | Yes |
| Cash Register | — | Yes | Yes | Yes |
| Promotions | — | Yes | Yes | Yes |
| Advanced Reports | — | — | Yes | Yes |
| CFDI Invoicing | — | — | Yes | Yes |
| Loyalty Program | — | — | Yes | Yes |
| Clients & Credit | — | — | Yes | Yes |
| Multi-Branch | — | — | Yes | Yes |
| Reservations | — | — | Yes | Yes |
| API Access | — | — | — | Yes |

> Defined in `PLAN_FEATURE_MAP` and `FEATURE_MIN_PLAN` at `src/app/core/models/plan.model.ts`.
> Feature gating is enforced by `FeatureFlagService.canUse(feature)` which intersects plan features with business-type relevance.

### 3.3 Trial behavior

During an active trial (`trialEndsAt` is in the future):
- If `planTypeId` is Free → treated as **Basic** (all Basic features unlocked).
- If `planTypeId` is Pro/Enterprise → uses the contracted plan.

> Logic in `FeatureFlagService.getEffectivePlan()`.

---

## 4. Architecture Layers

```
┌─────────────────────────────────────────────────────┐
│                     UI Layer                         │
│  Fast-Lane (Chameleon at /pos/sell)                  │
│    └── grid stage  │  keypad stage  │  cart-panel    │
│  Full-Service F&B (Hub at /pos)                      │
│    └── tables  │  takeout  │  delivery               │
│  Standalone: Waiter │ Kitchen │ Kiosk │ Admin        │
├─────────────────────────────────────────────────────┤
│                  Routing Layer                       │
│  DeviceRoutingService + AuthGuard + OnboardingGuard  │
│  Role × DeviceMode × PosExperience → Route           │
├─────────────────────────────────────────────────────┤
│                 Feature Gating                       │
│  FeatureFlagService: canUse() / meetsPlan()          │
│  Plan tier × Business type → allowed features        │
├─────────────────────────────────────────────────────┤
│                  State Layer                         │
│  AuthService │ ConfigService │ TenantContext         │
│  CartService (signal) │ PosViewModeService           │
│  SyncService │ CashRegisterService │ TableService    │
├─────────────────────────────────────────────────────┤
│                 Persistence                          │
│  IndexedDB (Dexie) — offline-first                   │
│  localStorage — device config, auth tokens, viewMode │
│  Backend API (PostgreSQL) — source of truth          │
└─────────────────────────────────────────────────────┘
```

---

## 5. Key Files Reference

| File | Purpose |
|---|---|
| `src/app/app.routes.ts` | Top-level routing with guards and role restrictions |
| `src/app/modules/pos/pos.routes.ts` | POS sub-routes (`/pos/sell`, `/pos`, `/pos/checkout`, `/pos/waiter`, `/pos/add-meal/:id`) |
| `src/app/core/services/device-routing.service.ts` | Role + device mode + macro → post-login destination |
| `src/app/core/services/pos-view-mode.service.ts` | Chameleon shell view mode (keypad ↔ grid) signal + persistence |
| `src/app/core/services/feature-flag.service.ts` | Plan + giro → feature availability |
| `src/app/core/services/cart.service.ts` | Cart signal source of truth (incl. `addQuickItem`) |
| `src/app/core/services/order-context.service.ts` | F&B-only: active table + adding-to-order tracking |
| `src/app/core/services/table.service.ts` | F&B-only: move-items / merge / split endpoints |
| `src/app/core/models/plan.model.ts` | Plan tiers, feature maps, quantitative limits |
| `src/app/core/models/catalog.model.ts` | `PosExperience` type, `BusinessTypeCatalog` |
| `src/app/core/models/device-config.model.ts` | `DeviceConfig` interface and defaults |

---

## 6. Bounded Context Invariants

These rules are **non-negotiable without a new architectural audit**:

1. **Fast-Lane and Full-Service F&B do not consolidate.** Their transaction topologies (1 transient cart vs N persistent kitchen-bound orders) are structurally incompatible. F&B already contains a sub-mode Fast-Lane (Para Llevar); Fast-Lane cannot contain F&B without becoming F&B. See [AUDIT-052](AUDIT-052-restaurant-hub-chameleon.md).

2. **Cross-cutting features live in shared services**, not duplicated per shell. Examples: `DeliveryService`, `SyncService`, `CashRegisterService`, `ShiftPanelComponent`, `<app-cart-panel>`. The cart-panel is the only component that knows both worlds, branched via `isFoodAndBeverage()` and `hasKitchen()`.

3. **Glassmorphism on `<app-cart-panel>` is opt-in via `[isGlassMode]="true"`** — applied only inside `<app-unified-pos>`. Inside `<app-restaurant-hub>` the cart stays opaque to avoid transparent-bleed.

4. **Backend is authoritative on tax calculation** at `OrderItemTax`. The frontend cart preview falls back to `DEFAULT_TAX_RATE = 16` in `tax.utils.ts` until the API surfaces a tenant default. Never hardcode `taxRate` on `CartItem` construction in `addQuickItem` or anywhere else.

5. **No vertical-specific POS shells beyond the two above.** New verticals (any `PosExperience` value) onboard via the Chameleon if their topology fits the 1-cart-1-sale model, or by extending the F&B hub if they need persistent open orders. There is no third path.

---

## 7. Gaps & Recommendations

### 7.1 Open items

1. **Waiter Mode (mobile-first)** — `/pos/waiter` exists as an entry point but currently shares the `TablesComponent` UX. A mobile-optimized waiter view with simplified order-taking is not yet built.
2. **Master Cashier (Hub)** — No centralized live view for supervising multiple cash registers/sessions in real time. The admin registers page (`/admin/registers`) handles register CRUD but is not an operational screen.
3. **Tenant default tax rate** — Frontend cart preview drifts from backend ticket totals when a tenant uses a non-16% rate. Unblocked the day API exposes `tenantContext.defaultTaxRate()`.

### 7.2 Potential future work

- Build a dedicated `WaiterPosComponent` with mobile-first layout and streamlined order flow.
- Build a `MasterCashierComponent` at `/pos/hub` showing all open sessions, totals, and drawer status with polling/WebSocket.
