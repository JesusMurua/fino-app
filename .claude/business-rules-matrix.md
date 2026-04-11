# Business Rules & Feature Gating Matrix
**Version:** 1.0
**Core Philosophy:** Todo hardware de procesamiento local (Impresoras térmicas, Escáneres USB/BT, Básculas locales, Cajón de dinero) es **GRATIS** (Tier 0) en todos los giros. Lo que consume recursos de servidor (Sockets, S3, Webhooks, Multi-tenant) se monetiza.

## 1. Business Types & Plan Availability
No todos los giros requieren los 4 planes. La UI y el API deben adaptarse a esta estructura.

### 1.1 Food & Beverage (Restaurantes y Bares)
*Alta complejidad. Requieren control de flujo de alimentos.*
- **Free ($0):** 1 Caja, Hardware Core, 50 productos, Comandas impresas (sin pantalla).
- **Basic ($199):** Productos ilimitados, Facturación CFDI, KDS Básico (Pantalla con auto-refresh, sin sockets).
- **Pro ($499) [RECOMMENDED]:** Realtime KDS (Sockets), Mapa de Mesas, App Meseros, Kiosco Autoservicio, Multi-Caja.
- **Enterprise ($999):** Multi-Sucursal (Franquicias), API Pública, Inventario Avanzado (Recetas/Mermas).

### 1.2 Quick Service (Cafeterías y Fast Food)
*Flujo rápido, sin gestión de mesas.*
- **Free ($0):** 1 Caja, Hardware Core, 50 productos.
- **Basic ($149) [RECOMMENDED]:** Productos ilimitados, Facturación CFDI, Realtime KDS de Barra.
- **Pro ($349):** Kiosco Autoservicio, Lealtad/CRM, Multi-Caja.
*(Enterprise plan NO APLICA)*

### 1.3 Retail (Tiendas y Comercios)
*Enfoque en volumen de inventario y rapidez de escaneo.*
- **Free ($0):** 1 Caja, Hardware Core, 500 productos.
- **Basic ($149) [RECOMMENDED]:** Productos ilimitados, Facturación CFDI, Control de Fiado/Crédito.
- **Pro ($349):** Inventario Multi-bodega, Reportes Comparativos, Alertas de Stock.
*(Enterprise plan NO APLICA)*

### 1.4 Specialized Services (Estéticas, Consultorios, Talleres)
*Baja complejidad. Enfoque en agenda y cobro.*
- **Free ($0):** 1 Caja, Hardware Core, Folios simples, Base de clientes.
- **Pro ($99) [RECOMMENDED]:** Facturación CFDI, Folios personalizados, Historial CRM, Recordatorios.
*(Basic y Enterprise NO APLICAN)*

## 2. Architectural Constraints
1. **Frontend UI:** Si un feature NO aplica a un giro (ej. Mesas en Retail), debe OCULTARSE (DOM removal). Si aplica pero requiere un plan superior, debe mostrarse BLOQUEADO (Lock icon -> Upsell modal).
2. **Backend API:** El gating no depende de booleanos (ej. `HasKitchen`), sino de una relación en base de datos (`BusinessTypeFeature`) evaluada por un `IFeatureGateService`.
3. **Database Constraints:** "Soft Enforcement" para planes Free existentes que exceden cuotas (ej. >50 productos). Los GETs funcionan, pero los POSTs/PUTs lanzan `PlanLimitExceededException`.
