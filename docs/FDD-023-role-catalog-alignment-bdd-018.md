# FDD-023 — Frontend Role Catalog Alignment with BDD-018

> Aligns the frontend `UserRoleId` enum and human-role label maps with
> the new backend role catalog established by BDD-018. Removes legacy
> `Admin` and the misclassified hardware modes `Kitchen` / `Kiosk`
> from the human role catalog. Numeric IDs shift to a 1-based 1..5
> sequence.
> **Status:** Draft — pending implementation approval.
> **Author:** Senior Angular Architect (Claude).
> **Date:** 2026-05-01.

> Builds on: backend [BDD-018](../../backend/docs/BDD-018-role-catalog-cleanup.md) (referenced by name; lives in the backend repo).
> Related (unaffected): [FDD-022](FDD-022-rollback-device-auth.md) — auth interceptor token resolution.

---

## 0. Executive Summary

Backend BDD-018 collapsed the role catalog. Two cleanups happened in one migration:

1. **Removed `Admin`** — legacy role kept around since the early days; never used in production. Owners and Managers cover its responsibilities.
2. **Removed `Kitchen` and `Kiosk` from human roles** — these were always *device screen modes* (unattended hardware), not human-authenticated roles. They were misclassified in the original catalog, causing 403s when Kitchen-role users PIN-logged into cashier-mode devices (the human role policy `[Authorize(Roles = "Owner,Manager,Cashier")]` rejected them, even though the device IS linked).

The frontend `UserRoleId` enum still carries the old taxonomy and old IDs (Cashier=4, Kitchen=6, etc.). This FDD aligns it to the new 1-based catalog.

> **Important distinction preserved:** `Kitchen` and `Kiosk` continue to exist as **device screen modes** in `DeviceConfig['mode']` (`'cashier' \| 'tables' \| 'kitchen' \| 'kiosk' \| 'reception'`). Those drive the unattended-device routing and are unaffected by this change. The interceptor's `DEVICE_TOKEN_MODES = ['kitchen', 'kiosk', 'reception']` likewise stays.

---

## 1. Backend Contract (BDD-018)

| Old role | Old ID | New role | New ID |
|---|---|---|---|
| Owner | 1 | Owner | **1** |
| Admin | 2 | — | **REMOVED** (migrate to Manager server-side) |
| Manager | 3 | Manager | **2** |
| Cashier | 4 | Cashier | **3** |
| Waiter | 5 | Waiter | **4** |
| Kitchen | 6 | — | **REMOVED** (was a device mode misclassified as a human role) |
| Host | 7 | Host | **5** |
| Kiosk | 8 | — | **REMOVED** (was a device mode misclassified as a human role) |

The backend re-issues JWTs against the new catalog after the migration. Pre-existing JWTs in browser localStorage are considered **stale**: on next login the new claim set overwrites them. Manual smoke-testers should run a "Clear Site Data" (or PWA uninstall) before re-logging to avoid the previous role residue.

---

## 2. Components to Modify

| # | File | Type | Scope of change | Risk |
|---|---|---|---|---|
| 1 | [src/app/core/enums/config.enum.ts](../src/app/core/enums/config.enum.ts) | Enum + label map | `UserRoleId` rewritten with new IDs (Owner=1, Manager=2, Cashier=3, Waiter=4, Host=5). `USER_ROLE_LABELS` updated to drop the 3 removed entries. `BACK_OFFICE_ROLES` keeps `[Owner, Manager]` (still valid). | **High** — auth-critical |
| 2 | [src/app/modules/admin/components/users/admin-users.component.ts](../src/app/modules/admin/components/users/admin-users.component.ts) | Component (TS) | Dropdown options sweep — drop the `Cocina` (Kitchen) entry. Any `[UserRoleId.Cashier, UserRoleId.Kitchen, UserRoleId.Waiter]` arrays drop the Kitchen reference. | Medium |
| 3 | Any guard / service / pipe that compares roles | Various | Sweep references to `UserRoleId.Admin`, `UserRoleId.Kitchen`, `UserRoleId.Kiosk` and string literals `'Admin'`, `'Kitchen'`, `'Kiosk'` (case-sensitive — capitalized) used in **role-comparison** contexts. NOT to be confused with `'kitchen'` / `'kiosk'` lowercase, which are device modes and stay. | Medium — discovered during grep |

### Components NOT modified

| File / Concept | Why it stays |
|---|---|
| `DeviceConfig['mode']` union (`cashier \| tables \| kitchen \| kiosk \| reception`) | Hardware modes — orthogonal to human roles. Kitchen Display screens, kiosks, reception screens are unattended devices that authenticate via device JWT and route by their `mode`. |
| `DEVICE_TOKEN_MODES = ['kitchen', 'kiosk', 'reception']` in [auth.interceptor.ts](../src/app/core/interceptors/auth.interceptor.ts) | Same reason — references device modes, not human roles. |
| `device-routing.service.ts` mode-based navigation | Same — drives unattended-device entry points. |
| `BACK_OFFICE_ROLES = [Owner, Manager]` | Both still exist post-refactor. Still represents the back-office privilege tier. |

---

## 3. State Management

No signals tocados. The enum + label maps are pure constants. The change is type-system + value-mapping only.

---

## 4. Validations & UX

### 4.1 Type-system safety

`USER_ROLE_LABELS` is typed as `Record<UserRoleId, string>`. After the enum is reduced from 8 to 5 entries, TypeScript will flag any `Record` definition that includes `[UserRoleId.Admin]: ...`, `[UserRoleId.Kitchen]: ...`, or `[UserRoleId.Kiosk]: ...` because those keys no longer exist. This is the primary defense — the compiler catches incomplete migrations.

### 4.2 String-literal sweep (manual)

TypeScript will NOT catch role checks done by string match (e.g., `if (user.role === 'Kitchen') { ... }`). These have to be located by grep. Case-sensitivity is critical:

| Pattern to remove | Pattern to KEEP |
|---|---|
| `'Admin'`, `'Kitchen'`, `'Kiosk'` (capitalized — human-role string match) | `'kitchen'`, `'kiosk'` (lowercase — DeviceConfig.mode) |

### 4.3 Stale localStorage handling

After the deploy, users with old JWTs in `pos_auth_token` will have a stale numeric `roleId` (e.g., `4` which used to mean Cashier, now means Waiter under the new enum). The recommended behavior on re-login is silent overwrite — the next successful login replaces the storage with the new shape. **No proactive migration of localStorage on the frontend.** If users report visual oddities pre-relogin, "Clear Site Data" is the supported reset.

---

## 5. Implementation Order

| Phase | Step | File | Description |
|---|---|---|---|
| **A — Doc** | A1 | `docs/FDD-023-...md` (NEW) | Create this document. |
| **B — Enum core** | B1 | `config.enum.ts` | Rewrite `UserRoleId` to 1..5 sequence. Update `USER_ROLE_LABELS`. Verify `BACK_OFFICE_ROLES` (no change required). |
| **C — Numeric refs** | C1 | All | `grep -rn "UserRoleId\.\(Admin\|Kitchen\|Kiosk\)" src/` → remove or refactor each occurrence. |
| **D — String refs** | D1 | All | `grep -rn "'Admin'\|'Kitchen'\|'Kiosk'" src/` (capitalized) → audit each: if comparing roles → remove. If unrelated → leave. |
| **E — Verification** | E1 | n/a | Final grep proves 0 references. `npm run lint` + `npm run build` pass. |

> **Stop conditions:**
> - Lint or build regression in any touched file.
> - Any post-fix grep finds `UserRoleId.Admin`, `UserRoleId.Kitchen`, or `UserRoleId.Kiosk`.
> - `DeviceConfig['mode']` union or `DEVICE_TOKEN_MODES` was modified (forbidden by Constraint #1).

---

## 6. Acceptance Criteria

| ID | Criterion | How to verify |
|---|---|---|
| **AC-1** | `UserRoleId` enum exactly matches BDD-018 (Owner=1, Manager=2, Cashier=3, Waiter=4, Host=5). | Static: read `config.enum.ts` post-fix. |
| **AC-2** | `DeviceConfig['mode']` union and `DEVICE_TOKEN_MODES` constant unmodified. | Static: `git diff` shows zero changes in those files / lines. |
| **AC-3** | Zero references to `UserRoleId.Admin`, `UserRoleId.Kitchen`, `UserRoleId.Kiosk` in `src/`. | `grep -rn "UserRoleId\.\(Admin\|Kitchen\|Kiosk\)" src/` returns 0 matches. |
| **AC-4** | `npm run lint` and `npm run build` pass without new issues. | CI / local. |
| **AC-5** | A user can successfully PIN-login as each of the 5 valid human roles and reach the correct entry point. | Manual smoke (deferred — requires backend BDD-018 deployed + Clear Site Data + per-role test PIN). |

---

**End of document.** Awaiting confirmation to proceed with **Phase B — Enum core**.
