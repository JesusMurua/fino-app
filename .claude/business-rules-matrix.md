# Business Rules & Feature Gating Matrix
**Version:** 2.0
**Core Philosophy:** Todo hardware de procesamiento local (Impresoras térmicas, Escáneres USB/BT, Básculas locales, Cajón de dinero) es **GRATIS** (Tier 0) en todos los giros. Lo que consume recursos de servidor (Sockets, S3, Webhooks, Multi-tenant) se monetiza.

## 0. Macro Categories & Sub-Giros

El catálogo vive en dos niveles: una **macrocategoría** (`MacroCategoryType`) obligatoria + cero o más **sub-giros** (`BusinessTypeId`) en relación N:M (`BusinessGiro`).

| Macro | Id | Sub-giros (seed commit `75eacdf`) |
|-------|----|-----------------------------------|
| FoodBeverage | 1 | Restaurante (1), BarCantina (2), SportsBar (3) |
| QuickService | 2 | Taqueria (4), Dogos (5), Hamburguesas (6), Cafeteria (7), Paleteria (8), Panaderia (9) |
| Retail | 3 | Abarrotes (10), Expendio (11), Refaccionaria (12), Ferreteria (13), Papeleria (14), Farmacia (15), Boutique (16) |
| Services | 4 | Estetica (17), TallerMecanico (18), Consultorio (19), Gimnasio (20) |

- El JWT sólo carga `primaryMacroCategoryId`; los sub-giros se escriben vía `PUT /api/business/giro` y se consultan en endpoints dedicados.
- La UI del onboarding captura el macro (radio) y uno o más sub-giros (chips). Al marcar "Otra", el sub-giro no materializa un id — el texto libre viaja en `customGiroDescription`.

## 1. Plan Availability per Macro
No todos los macros exponen los 4 planes. La UI oculta lo que no aplica y el backend rechaza combinaciones inválidas.

| Macro | Free | Basic | Pro | Enterprise |
|-------|:----:|:-----:|:---:|:----------:|
| FoodBeverage | ✅ | ✅ | ✅ RECOMMENDED | ✅ |
| QuickService | ✅ | ✅ RECOMMENDED | ✅ | ❌ NO APLICA |
| Retail | ✅ | ✅ RECOMMENDED | ✅ | ❌ NO APLICA |
| Services | ✅ | ❌ NO APLICA | ✅ RECOMMENDED | ❌ NO APLICA |

### 1.1 FoodBeverage (Restaurantes y Bares)
*Alta complejidad. Requieren control de flujo de alimentos.*
- **Free ($0):** 1 Caja, Hardware Core, 50 productos, Comandas impresas (sin pantalla).
- **Basic ($199):** Productos ilimitados, Facturación CFDI, KDS Básico (Pantalla con auto-refresh, sin sockets).
- **Pro ($499) [RECOMMENDED]:** Realtime KDS (Sockets), Mapa de Mesas, App Meseros, Kiosco Autoservicio, Multi-Caja.
- **Enterprise ($999):** Multi-Sucursal (Franquicias), API Pública, Inventario Avanzado (Recetas/Mermas).

### 1.2 QuickService (Cafeterías y Fast Food)
*Flujo rápido, sin gestión de mesas.*
- **Free ($0):** 1 Caja, Hardware Core, 50 productos.
- **Basic ($149) [RECOMMENDED]:** Productos ilimitados, Facturación CFDI, Realtime KDS de Barra.
- **Pro ($349):** Kiosco Autoservicio, Lealtad/CRM, Multi-Caja.
- **Enterprise NO APLICA.**

### 1.3 Retail (Tiendas y Comercios)
*Enfoque en volumen de inventario y rapidez de escaneo.*
- **Free ($0):** 1 Caja, Hardware Core, 500 productos.
- **Basic ($149) [RECOMMENDED]:** Productos ilimitados, Facturación CFDI, Control de Fiado/Crédito.
- **Pro ($349):** Inventario Multi-bodega, Reportes Comparativos, Alertas de Stock.
- **Enterprise NO APLICA.**

### 1.4 Services (Estéticas, Consultorios, Talleres)
*Baja complejidad. Enfoque en agenda y cobro.*
- **Free ($0):** 1 Caja, Hardware Core, Folios simples, Base de clientes.
- **Pro ($99) [RECOMMENDED]:** Facturación CFDI, Folios personalizados, Historial CRM, Recordatorios.
- **Basic NO APLICA · Enterprise NO APLICA.**

## 2. Architectural Constraints
1. **Frontend UI:** Si un feature NO aplica a un giro (ej. Mesas en Retail), debe OCULTARSE (DOM removal). Si aplica pero requiere un plan superior, debe mostrarse BLOQUEADO (Lock icon -> Upsell modal). El bloqueo de planes por macro se surface desde `AVAILABLE_PLANS_BY_MACRO` (frontend) y debe coincidir 1-a-1 con el feature gate del backend.
2. **Backend API:** El gating no depende de booleanos (ej. `HasKitchen`), sino de una relación en base de datos (`BusinessTypeFeature`) evaluada por un `IFeatureGateService`.
3. **Database Constraints:** "Soft Enforcement" para planes Free existentes que exceden cuotas (ej. >50 productos). Los GETs funcionan, pero los POSTs/PUTs lanzan `PlanLimitExceededException`.
