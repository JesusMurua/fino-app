# POS Architecture — Current State vs Target

> Generated: 2026-04-09
> Purpose: Map the implemented POS modes, routing logic, and plan limits against the target business model.

---

## 1. POS Modes — Current vs Target

| # | Target Mode | Status | Route | Component | Notes |
|---|-------------|--------|-------|-----------|-------|
| 1 | **Retail / Scanner** (Abarrotes) | Implemented | `/pos/retail` | `RetailPosComponent` | Barcode scanner, bill denominations, stock-guarded cart, category sidebar |
| 2 | **Quick Service / Touch** (Cafeterías) | Implemented | `/pos/counter` | `CounterPosComponent` | Kitchen order option, denominations, local cart, order numbering |
| 3 | **Tables** (Restaurantes) | Implemented | `/tables` | `TablesComponent` | Floor map, zones, split/merge, move items, reservations |
| 4 | **Waiter Mode** (Mobile) | Partial | `/tables` | `TablesComponent` | Waiters route to `/tables` when device mode is `tables`. No dedicated mobile-optimized waiter component exists yet — they share the same `TablesComponent` UI. |
| 5 | **KDS** (Kitchen) | Implemented | `/kitchen/:destinationId` | `KitchenDisplayComponent` | Multi-area via `AreaSelectorComponent`, real-time polling |
| 6 | **Master Cashier** (Hub) | Not implemented | — | — | No centralized hub view for managing multiple open registers/sessions from a single screen. Cash register management exists in `/admin/registers` but is admin-only, not a live POS mode. |

### Additional modes (implemented, not in target list)

| Mode | Route | Component | Notes |
|------|-------|-----------|-------|
| **Restaurant POS** (default) | `/pos` | `ProductGridComponent` | Full catalog grid with categories, cart panel, delivery panel |
| **Quick POS** (free-form) | `/pos/quick` | `QuickPosComponent` | No catalog required; type name + price. Best for taquerías, informal vendors |
| **Kiosk** (self-service) | `/kiosk` | `KioskShellComponent` | Idle timeout, touch-only UI, welcome → catalog → detail → summary → ticket |

---

## 2. Routing Logic

### How the app selects a POS experience

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
      │     └── otherwise ──────────── → resolvePosRoute()
      └── Cashier
            ├── deviceMode = 'tables'  → /tables
            ├── deviceMode = 'kitchen' → /kitchen
            └── otherwise ─────────── → resolvePosRoute()

resolvePosRoute()
      │
      ├── 1. configService.posExperience()  ← loaded from Dexie/API
      ├── 2. Fallback: authService.businessTypeId() → CatalogService
      └── 3. Last resort: '/pos' (Restaurant)

PosExperience mapping:
      'Restaurant' → /pos
      'Counter'    → /pos/counter
      'Retail'     → /pos/retail
      'Quick'      → /pos/quick
```

### BusinessTypeId → PosExperience mapping

| BusinessTypeId | PosExperience | Route |
|----------------|---------------|-------|
| Restaurant (1) | Restaurant | `/pos` |
| Retail (2) | Retail | `/pos/retail` |
| Cafe (3) | Counter | `/pos/counter` |
| Bar (4) | Restaurant | `/pos` |
| FoodTruck (5) | Counter | `/pos/counter` |
| General (6) | Quick | `/pos/quick` |
| Taqueria (7) | Quick | `/pos/quick` |
| Abarrotes (8) | Retail | `/pos/retail` |
| Ferreteria (9) | Retail | `/pos/retail` |
| Papeleria (10) | Retail | `/pos/retail` |
| Farmacia (11) | Retail | `/pos/retail` |
| Servicios (12) | Quick | `/pos/quick` |

> Note: The actual mapping is resolved through `CatalogService` using the backend's `BusinessTypeCatalog.posExperience` field. The table above reflects the expected defaults.

### Device mode values

```typescript
type DeviceMode = 'cashier' | 'kiosk' | 'tables' | 'kitchen' | 'admin';
```

Stored in localStorage as Base64-obfuscated JSON. Legacy values are auto-migrated:
- `'counter'` → `'cashier'`
- `'waiter'` → `'tables'`

---

## 3. Plan Limits & Feature Flags

### Quantitative limits

| Limit | Free | Basic | Pro | Enterprise |
|-------|------|-------|-----|------------|
| Max users | 3 | Unlimited | Unlimited | Unlimited |
| Max products | 100 | Unlimited | Unlimited | Unlimited |

> Defined in `PLAN_LIMITS` at `src/app/core/models/plan.model.ts`.

### Feature matrix

| Feature | Free | Basic | Pro | Enterprise |
|---------|------|-------|-----|------------|
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

### Trial behavior

During an active trial (`trialEndsAt` is in the future):
- If `planTypeId` is Free → treated as **Basic** (all Basic features unlocked).
- If `planTypeId` is Pro/Enterprise → uses the contracted plan.

> Logic in `FeatureFlagService.getEffectivePlan()`.

---

## 4. Architecture Layers

```
┌─────────────────────────────────────────────────────┐
│                     UI Layer                         │
│  POS Modes: Restaurant │ Retail │ Counter │ Quick    │
│  Standalone: Tables │ Kitchen │ Kiosk │ Admin        │
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
│  AuthService (signals) │ ConfigService (Dexie+API)   │
│  CartService │ SyncService │ CashRegisterService     │
├─────────────────────────────────────────────────────┤
│                 Persistence                          │
│  IndexedDB (Dexie) — offline-first                   │
│  localStorage — device config, auth tokens           │
│  Backend API — source of truth when online            │
└─────────────────────────────────────────────────────┘
```

---

## 5. Key Files Reference

| File | Purpose |
|------|---------|
| `src/app/app.routes.ts` | Top-level routing with guards and role restrictions |
| `src/app/modules/pos/pos.routes.ts` | POS variant sub-routes |
| `src/app/core/services/device-routing.service.ts` | Role + device mode → post-login destination |
| `src/app/core/services/feature-flag.service.ts` | Plan + giro → feature availability |
| `src/app/core/models/plan.model.ts` | Plan tiers, feature maps, quantitative limits |
| `src/app/core/models/catalog.model.ts` | `PosExperience` type, `BusinessTypeCatalog` |
| `src/app/core/models/device-config.model.ts` | `DeviceConfig` interface and defaults |
| `src/app/core/services/config.service.ts` | Two-layer config (Dexie + localStorage) |
| `src/app/core/enums/config.enum.ts` | `BusinessTypeId`, `UserRoleId`, `PlanTypeId` |

---

## 6. Gaps & Recommendations

### Missing from target

1. **Waiter Mode (dedicated)** — Waiters currently share `TablesComponent`. A mobile-optimized waiter view with simplified order-taking and table assignment is not yet built.
2. **Master Cashier (Hub)** — No centralized live view for supervising multiple cash registers/sessions in real-time. The admin registers page (`/admin/registers`) handles register CRUD but is not a live operational screen.

### Potential improvements

- Extract a `WaiterPosComponent` with mobile-first layout, large touch targets, and streamlined order flow (no admin features visible).
- Build a `MasterCashierComponent` at `/pos/hub` showing all open sessions, their totals, and drawer status in real-time with polling or WebSocket updates.
