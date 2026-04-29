# POS SaaS: Arquitectura de Monetización y Límites de Hardware

Este documento es la Fuente Única de Verdad (Single Source of Truth) para las reglas de negocio, límites de dispositivos y estrategia de monetización. Todo límite numérico proviene de la base de datos, eliminando constantes en el código.

## 1. Modelo de Datos y Features (Hardware vs Sesiones)
Se introduce la propiedad `EnforcementScope` (`Global` o `Branch`) en `FeatureCatalog` para dictar cómo el backend agrupa el conteo.

| Modo (Device) | Feature Key | Tipo | Ámbito (Scope) | Regla de Negocio & Monetización |
| :--- | :--- | :--- | :--- | :--- |
| **Caja (`cashier`)** | `MaxCashRegisters` | Cuantitativo | Global | Free: 1, Basic: 1, Pro: 3, Ent: ∞. Cajas extra requieren pago de Add-on. |
| **Hostess (`tables`)** | `MaxCashRegisters` | Cuantitativo | Global | **Comparte la cuota con `cashier`**. Una terminal fija de Hostess cuenta como una Caja. |
| **Cocina (`kitchen`)** | `MaxKdsScreens` | Cuantitativo | Global | Free: 0, Basic: 1, Pro: 3, Ent: ∞. Pantallas extra requieren pago de Add-on. *(Nota: `RealtimeKds` se mantiene booleano dictando solo el uso de WebSockets).* |
| **Kiosko (`kiosk`)** | `MaxKiosks` | Cuantitativo | Global | Free/Basic/Pro: 0, Ent: ∞. Todas las terminales en planes estándar requieren pago de Add-on. |
| **Recepción (`reception`)** | `MaxReceptionsPerBranch` | Cuantitativo | Branch | Límite default: 1 por Sucursal (vía BD, no hardcoded). No se venden extras. |
| **App Mesero (N/A)** | `WaiterApp` | Booleano | Sesión | No usa códigos de activación. Es un feature de sesión web/móvil BYOD (Bring Your Own Device). Meseros ilimitados. |

## 2. Reglas de Enforcement (Cálculo y Validación)
Antes de emitir un Código de Activación de 6 dígitos, el backend debe calcular el consumo actual basándose en el `EnforcementScope` de la feature asociada.

**Fórmula Estricta de Consumo:**
`Uso = COUNT(Devices WHERE IsActive = true AND Mode = X) + COUNT(DeviceActivationCodes WHERE IsUsed = false AND ExpiresAt > UtcNow AND Mode = X)`

- **Scope Global (Cajas/Hostess, Cocina, Kioskos):** Si `Uso` >= `(Límite del Plan + Add-ons comprados)`, rechazar con error `403 Plan Limit Exceeded`.
- **Scope Branch (Recepción):** Filtrar la consulta SQL por `BranchId`. Si `Uso` >= `Límite`, rechazar con error `403 Limit Exceeded`.

## 3. Higiene y Política de Downgrade
- **Higiene de Códigos (Invalidación Activa):** Al generar un nuevo código, el sistema hará soft-delete (`IsUsed = true`) a cualquier código previo pendiente que coincida exactamente en `[BranchId + Mode + Name]`.
- **Política de Downgrade (Hard-Cut FIFO):** Si un tenant baja de plan y excede su nuevo límite, el sistema ordenará los dispositivos por `CreatedAt` ASC. Mantendrá activos los "N" permitidos y marcará `IsActive = false` en el excedente, forzando un 401 en dichas terminales.

## 4. Hoja de Ruta de Desarrollo (4 Fases)
- **Fase 1 (Schema & Seeding):**
  - Eliminar llaves legacy (`KdsBasic`, `KioskMode`) del enum y seeders. Reemplazarlas por `MaxKdsScreens`, `MaxKiosks` y `MaxReceptionsPerBranch`.
  - Agregar la columna `EnforcementScope` a `FeatureCatalog`. Ajustar la matriz de planes (`DbInitializer.cs`).
- **Fase 2 (Enforcement Core):** Inyectar la fórmula de conteo data-driven, bloqueo (403) y la higiene automática en `DeviceService.GenerateActivationCodeAsync`.
- **Fase 3 (UX & DTOs):** Enriquecer `GenerateCodeResponse` (Name, CreatedAt, ExpiresAt, Mode) y crear endpoint `GET /api/devices/pending-codes`.
- **Fase 4 (Stripe Multi-Item):** Modificar `Subscription` para soportar `SubscriptionItems` (1-N). Refactorizar `StripeService` para procesar arrays de items (Plan Base + Add-ons).
