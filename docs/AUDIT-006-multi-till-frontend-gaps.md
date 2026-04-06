# AUDIT-006: Multi-Till Frontend Gap Analysis

**Date:** 2026-04-06
**Branch:** `feat/multi-till-frontend`
**Status:** Gap Analysis Complete - Awaiting Implementation Approval

---

## 1. Executive Summary

The .NET backend now supports **multiple physical cash registers per branch** (multi-till).
The Angular frontend currently operates under a **single-session-per-branch** assumption
and has **zero awareness** of physical registers. This audit identifies every gap that must
be closed to integrate the new backend endpoints.

---

## 2. Backend Endpoints Available (New)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/cashregister/registers` | List registers for active branch |
| `POST` | `/cashregister/registers` | Create a register `{ name, isActive }` |
| `GET` | `/cashregister/registers/by-device/{deviceUuid}` | Lookup register by device UUID |
| — | Session endpoints | Now accept optional `cashRegisterId` |

---

## 3. What Is ALREADY Implemented

### 3.1 DeviceConfig Model (`src/app/core/models/device-config.model.ts`)

- Stores device-level config in `localStorage` under key `pos-device-config`.
- Fields: `mode`, `deviceName`, `businessId`, `branchId`, `businessName`, `branchName`, `configuredAt`, printer fields.
- **No UUID field. No register link.**

### 3.2 CashRegisterSession Model (`src/app/core/models/cash-register.model.ts`)

- `CashRegisterSession` interface with `id`, `branchId`, `status`, movements, etc.
- `OpenSessionRequest`: `{ initialAmountCents, openedBy }`.
- `CloseSessionRequest`: `{ countedAmountCents, closedBy, notes }`.
- **No `cashRegisterId` in any request interface.**

### 3.3 CashRegisterService (`src/app/core/services/cash-register.service.ts`)

- `loadActiveSession(branchId)` + polling every 3 min.
- `openSession(branchId, request)` -> `POST /cashregister/session/open`.
- `closeSession(branchId, request)` -> `POST /cashregister/session/close`.
- `addMovement(branchId, request)`, `getHistory(branchId, from, to)`.
- `activeSession` signal + `hasOpenSession` computed.
- Dexie fallback when API unreachable.
- **No methods call `/cashregister/registers` or `/cashregister/registers/by-device/`.**

### 3.4 PosHeaderComponent Session Blocker (`src/app/modules/pos/components/pos-header/pos-header.component.ts:546-582`)

- `showSessionBlocker` computed: blocks POS when no open session.
- `openSessionFromBlocker()` sends `{ initialAmountCents, openedBy }`.
- **No `cashRegisterId` injected into the open request.**

### 3.5 Admin Cash Register UI (`src/app/modules/admin/components/cash-register/cash-register.component.ts`)

- Open/close session dialogs, movement management, 30-day history.
- Route: `/admin/cash`.
- **Manages sessions only. No physical register CRUD.**

### 3.6 Dexie Schema (`src/app/core/services/database.service.ts`)

- `cashSessions` table indexed by `branchId, status, openedAt`.
- `cashMovements` table indexed by `sessionId, createdAt`.
- **No `cashRegisters` table.**

---

## 4. GAPS Identified

### GAP-1: No Device UUID Generation or Persistence

| Aspect | Detail |
|--------|--------|
| **What's missing** | A stable UUID per browser/device stored in `localStorage` (`kaja_device_uuid`) |
| **Why it matters** | The backend endpoint `GET /registers/by-device/{deviceUuid}` requires a UUID to look up the assigned register |
| **Where to fix** | `DeviceConfig` model + a new `DeviceService` (or extend `ConfigService`) |

### GAP-2: No `CashRegister` Interface / Model

| Aspect | Detail |
|--------|--------|
| **What's missing** | A `CashRegister` interface representing a physical register entity: `{ id, branchId, name, isActive, deviceUuid?, createdAt }` |
| **Why it matters** | Cannot type API responses from `GET /cashregister/registers` or store registers locally |
| **Where to fix** | `src/app/core/models/cash-register.model.ts` (extend existing file) |

### GAP-3: No Register CRUD Methods in Service

| Aspect | Detail |
|--------|--------|
| **What's missing** | `getRegisters()`, `createRegister(name, isActive)`, `getRegisterByDevice(uuid)` methods |
| **Why it matters** | Frontend cannot list, create, or look up physical registers |
| **Where to fix** | `src/app/core/services/cash-register.service.ts` (add methods) |

### GAP-4: No Admin UI for Physical Register Management

| Aspect | Detail |
|--------|--------|
| **What's missing** | A component to list/create/toggle registers, and assign devices to them |
| **Why it matters** | The business owner needs a UI to manage which physical tills exist |
| **Where to fix** | New component under `src/app/modules/admin/components/` + new route in `admin.routes.ts` |

### GAP-5: `OpenSessionRequest` Missing `cashRegisterId`

| Aspect | Detail |
|--------|--------|
| **What's missing** | Optional `cashRegisterId` field in `OpenSessionRequest` interface |
| **Why it matters** | Backend now accepts `cashRegisterId` to bind a session to a specific register |
| **Where to fix** | `src/app/core/models/cash-register.model.ts` (line 28-31) |

### GAP-6: Session Blocker Does Not Pass `cashRegisterId`

| Aspect | Detail |
|--------|--------|
| **What's missing** | `PosHeaderComponent.openSessionFromBlocker()` does not resolve the device's linked register and inject `cashRegisterId` into the open request |
| **Why it matters** | This is **the critical integration point** - without it sessions remain branch-level, not register-level |
| **Where to fix** | `src/app/modules/pos/components/pos-header/pos-header.component.ts` (lines 558-580) |

### GAP-7: No `cashRegisters` Dexie Table

| Aspect | Detail |
|--------|--------|
| **What's missing** | A Dexie table to cache registers for offline display |
| **Why it matters** | Offline-first architecture requires local persistence of register data |
| **Where to fix** | `src/app/core/services/database.service.ts` (new version bump) |

### GAP-8: `CashRegisterSession` Missing `cashRegisterId` Field

| Aspect | Detail |
|--------|--------|
| **What's missing** | The `CashRegisterSession` interface has no `cashRegisterId` property |
| **Why it matters** | Backend responses will now include this field; frontend must type it |
| **Where to fix** | `src/app/core/models/cash-register.model.ts` (line 2-14) |

---

## 5. Step-by-Step Implementation Plan

### Phase A: Foundation (Models + Device Identity)

**Step A1 - Generate Device UUID**
- Create `DeviceService` in `src/app/core/services/device.service.ts`.
- On first call, generate a `crypto.randomUUID()` and store as `kaja_device_uuid` in `localStorage`.
- Expose `deviceUuid` as a readonly property.
- Files: new `device.service.ts`.

**Step A2 - Add `CashRegister` Model**
- Add `CashRegister` interface to `cash-register.model.ts`:
  ```typescript
  export interface CashRegister {
    id: number;
    branchId: number;
    name: string;
    isActive: boolean;
    deviceUuid?: string;
    createdAt?: string;
  }
  ```
- Add optional `cashRegisterId?: number` to `OpenSessionRequest`.
- Add optional `cashRegisterId?: number` to `CashRegisterSession`.
- File: `src/app/core/models/cash-register.model.ts`.

**Step A3 - Dexie Schema Bump**
- Add `cashRegisters` table: `'id, branchId, isActive, deviceUuid'`.
- Bump to version 19.
- File: `src/app/core/services/database.service.ts`.

### Phase B: Service Layer

**Step B1 - Register CRUD Methods**
- Add to `CashRegisterService`:
  - `getRegisters(): Promise<CashRegister[]>` -> `GET /cashregister/registers`
  - `createRegister(name: string, isActive: boolean): Promise<CashRegister>` -> `POST /cashregister/registers`
  - `getRegisterByDevice(uuid: string): Promise<CashRegister | null>` -> `GET /cashregister/registers/by-device/{uuid}`
- Cache results in `db.cashRegisters`.
- File: `src/app/core/services/cash-register.service.ts`.

**Step B2 - Register Resolution Helper**
- Add `resolveLinkedRegister(): Promise<CashRegister | null>` method:
  1. Get `deviceUuid` from `DeviceService`.
  2. Call `getRegisterByDevice(uuid)`.
  3. Return the linked register (or `null` if unlinked device).
- Expose as `linkedRegister` signal on the service.
- File: `src/app/core/services/cash-register.service.ts`.

### Phase C: Admin UI (Register Management)

**Step C1 - Admin Registers Component**
- Create `AdminRegistersComponent` at `src/app/modules/admin/components/admin-registers/`.
- Features:
  - PrimeNG `p-table` listing all registers (name, status, linked device UUID).
  - "New Register" dialog with `name` input + `isActive` toggle.
  - Toggle `isActive` inline.
  - Display linked device UUID (read-only, assigned from POS device).
- Touch-friendly: 64px row height, large buttons.

**Step C2 - Admin Route**
- Add route `registers` in `admin.routes.ts` pointing to `AdminRegistersComponent`.
- Add menu item in `admin-shell.component.ts` (icon: `pi-server`, label: "Cajas Fisicas").

### Phase D: POS Integration (The Blocker Fix)

**Step D1 - Inject `cashRegisterId` into Session Open**
- In `PosHeaderComponent.openSessionFromBlocker()`:
  1. Call `cashRegisterService.resolveLinkedRegister()`.
  2. If a linked register exists, add `cashRegisterId` to the `OpenSessionRequest`.
  3. If no linked register (unlinked device), open session without `cashRegisterId` (backwards-compatible).
- File: `src/app/modules/pos/components/pos-header/pos-header.component.ts`.

**Step D2 - Show Register Name in POS Header**
- Display the linked register name (e.g., "Caja 1") in the POS header bar next to the session status.
- If unlinked, show "Sin caja asignada" as a subtle indicator.
- File: `pos-header.component.html` + `pos-header.component.ts`.

### Phase E: Device-Register Linking Flow

**Step E1 - Link Device to Register (from Admin)**
- In `AdminRegistersComponent`, add a "Link this device" button per register row.
- On click: calls a new endpoint or stores the `deviceUuid` on the register via `POST /cashregister/registers/{id}/link` (confirm backend support).
- Alternative: if backend doesn't have a link endpoint, store the mapping locally in `DeviceConfig` (add `linkedRegisterId` field).

**Step E2 - Persist Link in DeviceConfig**
- Add optional `linkedRegisterId?: number` and `linkedRegisterName?: string` to `DeviceConfig`.
- On successful link, update `localStorage`.
- On POS boot, call `getRegisterByDevice(uuid)` to validate the link is still active.

---

## 6. Dependency Graph

```
A1 (DeviceService)
 └──> A2 (CashRegister model) ──> A3 (Dexie table)
       └──> B1 (CRUD methods) ──> B2 (resolveLinkedRegister)
             │                       └──> D1 (inject into session open)
             │                              └──> D2 (show in header)
             └──> C1 (Admin UI) ──> C2 (Admin route)
                    └──> E1 (Link device) ──> E2 (Persist link)
```

**Critical path:** A1 -> A2 -> B1 -> B2 -> D1 (this unblocks multi-till session binding).

---

## 7. Risk Notes

| Risk | Mitigation |
|------|------------|
| Backend may not return `cashRegisterId` in session responses yet | Make all new fields optional; graceful fallback to branch-level sessions |
| Existing devices have no UUID | `DeviceService` generates one on first access — transparent migration |
| Offline scenario: device can't resolve register | Cache linked register in Dexie + `DeviceConfig`; use cached value when offline |
| Admin creates register but forgets to link device | POS header shows "Sin caja asignada" indicator as a reminder |

---

## 8. Files to Modify / Create

| Action | File |
|--------|------|
| **CREATE** | `src/app/core/services/device.service.ts` |
| **MODIFY** | `src/app/core/models/device-config.model.ts` (add `linkedRegisterId`) |
| **MODIFY** | `src/app/core/models/cash-register.model.ts` (add `CashRegister`, update requests) |
| **MODIFY** | `src/app/core/services/cash-register.service.ts` (add register CRUD + resolve) |
| **MODIFY** | `src/app/core/services/database.service.ts` (v19: add `cashRegisters` table) |
| **MODIFY** | `src/app/core/models/index.ts` (export new interfaces) |
| **CREATE** | `src/app/modules/admin/components/admin-registers/admin-registers.component.ts` |
| **CREATE** | `src/app/modules/admin/components/admin-registers/admin-registers.component.html` |
| **CREATE** | `src/app/modules/admin/components/admin-registers/admin-registers.component.scss` |
| **MODIFY** | `src/app/modules/admin/admin.routes.ts` (add `registers` route) |
| **MODIFY** | `src/app/modules/admin/admin-shell.component.ts` (add menu item) |
| **MODIFY** | `src/app/modules/pos/components/pos-header/pos-header.component.ts` (inject register ID) |
| **MODIFY** | `src/app/modules/pos/components/pos-header/pos-header.component.html` (show register name) |
