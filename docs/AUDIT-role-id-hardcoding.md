# AUDIT — Hardcoded Role IDs en el frontend

**Tipo:** Análisis puro (sin modificaciones)
**Branch:** `fix/pos-to-admin-routing-auth`
**Fecha:** 2026-04-19
**Contexto:** Evaluar impacto en frontend de un re-index backend `Owner=1, Manager=2, Cashier=3` (eliminando el hueco de `Admin=2`).

---

## 1. TL;DR

- **No existen comparaciones numéricas `roleId === N` ni `roleId !== N` en todo `src/`.** Todas las comparaciones usan el enum `UserRoleId`.
- **Existe enum centralizado** en [src/app/core/enums/config.enum.ts:2-11](../src/app/core/enums/config.enum.ts#L2-L11) — `UserRoleId` — ya cumple el rol de `roles.constants.ts`. No se necesita un archivo nuevo.
- **Riesgo real del re-index NO es hardcoding TS**, sino datos serializados con IDs viejos (JWTs en `localStorage`, hashes en Dexie, snapshots en `orders`).

---

## 2. Enum y helpers existentes

Archivo único de verdad: [src/app/core/enums/config.enum.ts](../src/app/core/enums/config.enum.ts)

```ts
// líneas 2-11
export enum UserRoleId {
  Owner   = 1,
  Admin   = 2,
  Manager = 3,
  Cashier = 4,
  Waiter  = 5,
  Kitchen = 6,
  Host    = 7,
  Kiosk   = 8,
}

// líneas 19-22
export const BACK_OFFICE_ROLES: readonly UserRoleId[] = [
  UserRoleId.Owner,
  UserRoleId.Manager,
];

// líneas 25-27
export function isBackOfficeRole(roleId: UserRoleId | null | undefined): boolean {
  return roleId != null && BACK_OFFICE_ROLES.includes(roleId);
}

// líneas 116-125
export const USER_ROLE_LABELS: Record<UserRoleId, string> = { ... };
```

> El enum NO es `const enum`, así que TypeScript emite el mapeo bidireccional (`UserRoleId[1] === 'Owner'`). Eso significa que los valores numéricos también se usan en runtime vía reverse-lookup en [admin-users.component.ts:307](../src/app/modules/admin/components/users/admin-users.component.ts#L307) (`if (user.roleId in UserRoleId)`).

---

## 3. Búsqueda de hardcoded IDs numéricos — resultado

| Patrón | Matches |
|---|---|
| `roleId === <número>` | **0** |
| `roleId !== <número>` | **0** |
| `role === 'Owner'/'Manager'/...` (string) | **1** (legado, marcado `@deprecated` en el DTO) |
| `roleId: <número>` como valor literal | **0** |
| Arrays numéricos `[1, 2, 3]` con semántica de roles | **0** |

**Única comparación por string encontrada:**
[pos-header.component.ts:351](../src/app/modules/pos/components/pos-header/pos-header.component.ts#L351)

```ts
if (res.valid && (res.role === 'Owner' || res.role === 'Manager'
                 || res.roleId === UserRoleId.Owner || res.roleId === UserRoleId.Manager)) {
```

El DTO `VerifyPinResponse` declara `role?: string` con JSDoc `@deprecated Use roleId instead` ([pos-header.component.ts:60-65](../src/app/modules/pos/components/pos-header/pos-header.component.ts#L60-L65)). Es un shim de compatibilidad mientras el backend emite ambos campos. No es un hardcoding numérico; es legado de string.

---

## 4. Archivos que consumen `UserRoleId` (44 ocurrencias, 10 archivos productivos + enum)

Distribución de `UserRoleId.X` por archivo (según conteo):

| Archivo | Ocurrencias | Uso principal |
|---|---|---|
| [src/app/core/enums/config.enum.ts](../src/app/core/enums/config.enum.ts) | 10 | Definición + `BACK_OFFICE_ROLES` + `USER_ROLE_LABELS` |
| [src/app/modules/admin/components/users/admin-users.component.ts](../src/app/modules/admin/components/users/admin-users.component.ts) | 13 | `roleOptions`, form default, `usesPin`/`usesEmail`, `isOwner`, `resolveRoleId` fallback |
| [src/app/modules/pos/components/pos-header/pos-header.component.ts](../src/app/modules/pos/components/pos-header/pos-header.component.ts) | 6 | Computeds `showOrdersButton`, `showTablesButton`, `userRoleLabel`, `canSelfLink`, verificación PIN |
| [src/app/core/services/device-routing.service.ts](../src/app/core/services/device-routing.service.ts) | 6 | `switch (roleId)` en `getPostLoginRoute` |
| [src/app/app.routes.ts](../src/app/app.routes.ts) | 4 | `data: { roles: [UserRoleId...] }` en `/admin`, `/pos`, `/orders`, `/tables` |
| [src/app/core/guards/role.guard.ts](../src/app/core/guards/role.guard.ts) | 1 (import) | `allowedRoles: UserRoleId[] = route.data['roles']` |
| [src/app/core/guards/provisioning.guard.ts](../src/app/core/guards/provisioning.guard.ts) | 1 | Consulta rol para redirects |
| [src/app/modules/admin/admin-shell.component.ts](../src/app/modules/admin/admin-shell.component.ts) | 1 | Gating UI por rol |
| [src/app/modules/admin/components/settings/admin-settings.component.ts](../src/app/modules/admin/components/settings/admin-settings.component.ts) | 1 | `currentUser()?.roleId === UserRoleId.Owner` |
| [src/app/modules/admin/components/settings/admin-settings.component.html](../src/app/modules/admin/components/settings/admin-settings.component.html) | 1 | Template `@if (...roleId === UserRoleId.Owner)` |
| [src/app/modules/orders/orders-list.component.ts](../src/app/modules/orders/orders-list.component.ts) | 1 | Filtrado por rol |

Archivos que solo **usan los helpers** (`isBackOfficeRole`, `USER_ROLE_LABELS`, `BACK_OFFICE_ROLES`):

- [src/app/core/guards/terminal.guard.ts](../src/app/core/guards/terminal.guard.ts) — `isBackOfficeRole()` bypass de hardware
- [src/app/core/guards/role.guard.ts](../src/app/core/guards/role.guard.ts) — `isBackOfficeRole()` fallback

**Conclusión:** el frontend está disciplinado — todas las decisiones de autorización pasan por el enum, no por literales numéricos.

---

## 5. `roleOptions` — lista incompleta en admin-users

[admin-users.component.ts:58-64](../src/app/modules/admin/components/users/admin-users.component.ts#L58-L64):

```ts
readonly roleOptions: RoleOption[] = [
  { label: 'Dueño',  value: UserRoleId.Owner,   ... },
  { label: 'Gerente',value: UserRoleId.Manager, ... },
  { label: 'Cajero', value: UserRoleId.Cashier, ... },
  { label: 'Mesero', value: UserRoleId.Waiter,  ... },
  { label: 'Cocina', value: UserRoleId.Kitchen, ... },
];
```

**Faltan** `Admin`, `Host`, `Kiosk`. No es hardcoding numérico, pero es divergencia con el enum: al crear un usuario desde el Back Office, esos tres roles no son seleccionables. Si el re-index backend redefine `Admin` (elimina o reasigna), este componente debe revisarse por omisión, no por IDs.

Adicionalmente, `color` e `icon` viven inline en el componente. Si se extraen a `config.enum.ts` como `USER_ROLE_METADATA`, el re-index futuro solo toca un archivo.

---

## 6. Dependencias de los IDs numéricos (runtime y datos)

El código TS no hardcodea IDs, pero el sistema sí depende de los valores numéricos en varios puntos que el re-index tocaría:

| Lugar | Dependencia |
|---|---|
| JWT firmado por backend | `roleId` claim numérico → `handleLoginSuccess` ([auth.service.ts:441-479](../src/app/core/services/auth.service.ts#L441-L479)) lo persiste tal cual |
| `localStorage[AUTH_USER_KEY]` | Serializa `AuthUser.roleId` numérico |
| Dexie `employeeHashes` | Almacena `roleId` numérico ([auth.service.ts:240-246](../src/app/core/services/auth.service.ts#L240-L246)) |
| Dexie `orders` / `cartItems` | Si llevan snapshot de rol del operador |
| `in UserRoleId` check | [admin-users.component.ts:307](../src/app/modules/admin/components/users/admin-users.component.ts#L307) — un registro con ID viejo caería al fallback `UserRoleId.Cashier` |
| Enum `UserRoleId` mismo | Los números `1-8` se editarían en el archivo central |

**Consecuencia del re-index:** reindexar en backend sin migración coordinada puede causar:
1. JWTs viejos en `localStorage` interpretan `roleId=3` como `Cashier` (nuevo esquema) cuando originalmente era `Manager`.
2. Hashes offline en Dexie quedan con `roleId` stale — login offline asigna roles incorrectos.
3. `resolveRoleId` fallback a `Cashier` silencioso puede ocultar los problemas.

---

## 7. ¿Se necesita un `roles.constants.ts` nuevo?

**No.** El enum y sus helpers ya están centralizados en [config.enum.ts](../src/app/core/enums/config.enum.ts). Crear un segundo archivo fragmentaría la fuente de verdad.

**Sugerencias — opcionales, no bloqueantes para el re-index:**

1. **Consolidar metadata visual (color/icon) en `config.enum.ts`** como `USER_ROLE_METADATA: Record<UserRoleId, { label: string; color: string; icon: string }>`. Elimina la duplicación parcial de `roleOptions` en `admin-users.component.ts`.
2. **Completar `roleOptions`** para incluir `Admin`, `Host`, `Kiosk` (o documentar por qué se omiten).
3. **Agregar un helper de migración** `isValidRoleId(n: number): n is UserRoleId` que detecte numerics fuera del enum actual — útil para logs durante la ventana de re-index.
4. **Considerar `const enum`** si no hay necesidad de reverse lookup. Hay 1 uso de `in UserRoleId` que requiere el mapeo bidireccional; habría que evaluar.

---

## 8. Checklist para el re-index backend → frontend

Cuando el backend publique el nuevo catálogo `Owner=1, Manager=2, Cashier=3, ...`, las acciones mínimas de frontend son:

- [ ] Actualizar los números en [config.enum.ts:3-10](../src/app/core/enums/config.enum.ts#L3-L10) para espejar el nuevo catálogo.
- [ ] Verificar que `BACK_OFFICE_ROLES` siga listando los roles correctos por nombre (los nombres no cambian).
- [ ] Forzar logout global en despliegue: en el bootstrap, si el JWT decodificado tiene `roleVersion` anterior (o simplemente purgar `AUTH_USER_KEY` + `AUTH_TOKEN_KEY` en el deploy de migración), invalidar la sesión.
- [ ] Purgar Dexie `employeeHashes` y re-sincronizar en el próximo login online.
- [ ] Revisar si el backend sigue enviando `role: string` en `VerifyPinResponse` — si se elimina, quitar el fallback de [pos-header.component.ts:351](../src/app/modules/pos/components/pos-header/pos-header.component.ts#L351).
- [ ] Decidir explícitamente qué pasa con el rol `Admin` si se elimina (afecta FDD-013, donde está flagged).
- [ ] Completar `roleOptions` en `admin-users.component.ts` si el backend cambió la lista de roles asignables.

Ninguno de estos pasos requiere tocar comparaciones en componentes — todas siguen funcionando porque apuntan al enum, no al número.

---

## 9. Conclusión

El frontend está bien disciplinado: **cero hardcoded IDs numéricos de roles**. El enum `UserRoleId` en `config.enum.ts` ya funciona como `roles.constants.ts`. El re-index backend se absorbe con un cambio de un solo archivo (`config.enum.ts`) más la estrategia de invalidación de datos persistidos (JWT, Dexie). El mayor riesgo no es código sino datos en reposo con IDs viejos.
