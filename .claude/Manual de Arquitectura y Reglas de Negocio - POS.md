---

# **📖 MANUAL DE ARQUITECTURA, PRODUCTO Y REGLAS DE NEGOCIO**

**Sistema POS "Camaleón"**

## **1\. VISIÓN Y FILOSOFÍA DEL PRODUCTO**

El sistema POS es una plataforma de **Arquitectura Dual Inyectada**. No es un software genérico de "talla única". El sistema se reconfigura dinámicamente basándose en dos vectores principales:

1. **El Vector UX (Giro):** Determina el Motor de Interfaz (Cómo opera el cliente).  
2. **El Vector Capacidad (Plan):** Determina la profundidad financiera y operativa (Qué límites y módulos tiene).

---

## **2\. VECTOR UX: DOS SHELLS POS (BOUNDED CONTEXTS)**

> **Actualización 2026-05-04 (post-AUDIT-050 + AUDIT-052):** El sistema fue consolidado de 4 motores fragmentados a **2 shells permanentes** separados como contextos delimitados. La razón no es estética — es que las dos topologías transaccionales son estructuralmente incompatibles. **No se fusionan.**

El Onboarding del pos-landing obliga al cliente a elegir una categoría de giro. Esta selección inyecta el `BusinessTypeId` en la base de datos, que se mapea al `PosExperience` y determina cuál de los **dos shells** carga la Caja Principal.

### **Flujo de Asignación Automática (Onboarding)**

```
Cliente entra al Landing
        │
        ▼
   Selección de Categoría
        │
        ├── Restaurantes / Bares / Cafés con mesas ──► PosExperience: Restaurant
        │                                              ▼
        │                                     Shell: Full-Service F&B
        │                                     (RestaurantHubComponent en /pos)
        │
        └── Comida Rápida / Tiendas / Servicios ─────► PosExperience: Counter / Retail / Quick / Services
                                                       ▼
                                             Shell: Fast-Lane POS
                                             (UnifiedPosComponent en /pos/sell)
                                                  │
                                                  ├─ vista 'grid'   (Counter, Retail)
                                                  └─ vista 'keypad' (Quick, Services)
```

---

### **Detalle de los Shells**

#### 🍽️ **Shell 1 — Full-Service F&B (Restaurant Hub Omnicanal)**

Cuál: `RestaurantHubComponent` en `/pos`. Aplica al macro **Food & Beverage** (Restaurantes, Bares, Cafés con servicio en mesa).

La Caja Principal en modo Restaurante NO es un simple mapa de mesas. Es un **Hub Omnicanal** que centraliza tres canales de venta simultáneos mediante un switcher:

1. **Dine-in (Mesas):** Renderiza `<app-tables />`. Mapa de zonas y mesas con polling en tiempo real, reservaciones, y operaciones inter-orden (move-items / merge / split-equal / split-by-items). Flujo: Abrir mesa ➔ Asignar comensales ➔ Enviar comanda a cocina ➔ Imprimir pre-cuenta ➔ Cobrar.
2. **Takeout (Para Llevar):** Renderiza `<app-product-grid />` (el shell legacy completo con cart-panel embebido). Flujo: Agregar productos al carrito ➔ Cobrar (vía `/pos/checkout`) ➔ Imprimir ticket. Ojo: este shell legacy es **distinto** del Chameleon — el hub F&B lo conserva por simetría con su flujo de cocina.
3. **Delivery:** Lista de órdenes de plataformas externas (Uber Eats, Rappi, DiDi Food). Flujo: Recibir orden ➔ Aceptar ➔ Coordinar con cocina ➔ Marcar lista.

Adicionalmente, la Caja recibe en tiempo real las cuentas creadas por los Meseros (dispositivos móviles) y coordina el flujo con las Pantallas de Cocina (KDS). Es el punto de convergencia de todos los dispositivos de la sucursal.

**Topología transaccional:** 1 cajero ↔ N órdenes abiertas concurrentes (una por mesa) ↔ ciclo de vida en cocina (Pending → InProgress → Ready → Delivered). Una orden vive minutos u horas.

#### 🦎 **Shell 2 — Fast-Lane POS (Chameleon Invisible)**

Cuál: `UnifiedPosComponent` en `/pos/sell`. Aplica a los macros **Counter, Retail, Quick y Services** — todo lo que NO es F&B con mesas.

Un solo shell que se reconfigura visualmente según el `PosExperience` del tenant, vía `PosViewModeService`:

| Vista | Stage component | Default para | UX |
|---|---|---|---|
| `grid` | `<app-product-grid-inner />` | Counter (cafés sin mesa, food-truck), Retail (abarrotes, ferretería, papelería, farmacia) | Cuadrícula visual con categorías, búsqueda, scanner de código de barras |
| `keypad` | `<app-keypad-stage />` | Quick (taquerías informales, general), Services (manicure, salones, talleres) | Calculadora libre con descripción + precio + recientes + búsqueda en catálogo opcional |

El cajero puede flipar el toggle del header en cualquier momento (ej. un gym vendiendo agua después de cobrar una clase). La elección persiste en `localStorage` (`pos_view_mode_override`).

**Cobro inline:** los giros Fast-Lane no toleran un detour a `/pos/checkout`. El botón "Cobrar" del cart-panel abre el diálogo `<app-quick-pay>` (efectivo + denominaciones + cambio) directamente. Persiste la orden vía `SyncService` y vuelve al POS sin cambiar de pantalla.

**Topología transaccional:** 1 cajero ↔ 1 carrito transient ↔ 1 venta linealizada. Al cobrar, el carrito se vacía. **No hay estado entre transacciones.**

---

### **Frontera de Contexto: Por qué los 2 shells NO se consolidan**

> **Esta sección es invariante arquitectural. No negociable sin un nuevo audit.** Cualquier sesión futura (humana o IA) que proponga fusionar los dos shells debe leer [docs/AUDIT-052-restaurant-hub-chameleon.md](../docs/AUDIT-052-restaurant-hub-chameleon.md) primero.

1. **Lifecycles incompatibles**: el carrito Fast-Lane es transient (vive ~30 segundos); la orden F&B es persistent (vive horas) y atraviesa estados de cocina que no existen non-F&B.
2. **Cardinalidad distinta**: Fast-Lane mantiene `N=1` carritos a la vez; F&B mantiene `N=mesas-ocupadas`.
3. **Operaciones inter-orden**: merge / split / move solo tienen sentido cuando hay órdenes abiertas concurrentes — un patrón ausente de Fast-Lane por construcción.
4. **Inversión del mental model**: en Fast-Lane el cart es protagonista; en F&B el floor map es protagonista y el cart es un detalle de la mesa activa.
5. **Inclusión asimétrica**: F&B ya contiene un sub-modo Fast-Lane (canal "Para Llevar" dentro del hub). Fast-Lane no puede contener F&B sin volverse F&B.

**Consecuencia operacional:**
- Cualquier feature que aplique a **ambos contextos** (delivery, sync offline, cash-register sessions, shift management, glassmorphism opt-in) vive en **servicios o componentes shared** que ambos shells consumen — no se duplica.
- El `<app-cart-panel>` es el único componente compartido que conoce ambos mundos, ramificado vía `isFoodAndBeverage()` y `hasKitchen()`. Esa ramificación es sana porque vive en un solo punto.
- **Nunca se debe** absorber `<app-tables>`, `OrderContextService`, `TableService`, ni el ciclo de cocina en `UnifiedPosComponent`. Si surge la tentación, esta sección debe leerse antes de hacerlo.
- **Nunca se debe** crear un tercer shell por giro nuevo. Verticales nuevos: si encajan en topología 1-cart-1-sale → Fast-Lane (extender `PosExperience`); si necesitan órdenes abiertas persistentes → F&B Hub (extender canal). No hay tercer camino.

---

### **Modo Mesero (Waiter Mode) — Feature Pro**

El **Modo Mesero** (`WaiterPosComponent` en `/pos/waiter`) es un motor adicional **NO ligado a un giro de negocio**, sino a un **rol de dispositivo Pro**. Está reservado exclusivamente para el rol Waiter en dispositivos móviles (celulares y tablets pequeñas) que toman órdenes directamente en mesa, alimentando órdenes al hub F&B.

* **Cuándo se carga:** Cuando un usuario con rol `Waiter` inicia sesión en un dispositivo configurado en `mode: 'tables'`, o cuando se accede explícitamente a `/pos/waiter`.
* **UX:** Layout mobile-first con touch targets grandes, vista compacta de productos, flujo de comanda a cocina integrado.
* **NO se usa para:** Ventas Fast-Lane. Esos negocios usan el Chameleon (`UnifiedPosComponent`).
* **Plan requerido:** Solo Pro. En plan Free, los meseros usan el flujo regular de la Caja Principal.

---

### **Reglas Fiscales (Backend Authoritative)**

A partir de la migración a PostgreSQL con motor relacional de impuestos, **el backend es la única autoridad fiscal**. `OrderItemTax` calcula el IVA al guardar la orden según el régimen del tenant. El frontend muestra un **preview** del IVA en el cart-panel usando `DEFAULT_TAX_RATE = 16` como fallback cuando el `CartItem.taxRate` es undefined — esto es preview, no verdad.

**Reglas para frontend:**
- **Nunca hardcodear** `taxRate: 16` ni `taxRate: DEFAULT_TAX_RATE` al construir `CartItem` (ej. en `addQuickItem`). Dejarlo `undefined` para que el backend aplique el régimen real.
- Si el preview se ve desfasado para un tenant exento o con tasa fronteriza, **NO arreglarlo en frontend**. Cuando API exponga `tenantContext.defaultTaxRate()`, wirearlo al fallback canónico en `tax.utils.ts` — un solo punto resuelve el drift.

---

## **3\. VECTOR CAPACIDAD: PLANES, PRECIOS Y LÍMITES**

El sistema utiliza un modelo Freemium agresivo. La regla de oro es: **"Te dejo operar gratis, pero te cobro por crecer y delegar"**.

### **🪝 PLAN GRATIS ($0 / mes)**

*El gancho de adquisición. Suficiente para operar, imposible para escalar.*

* **Público:** Autoempleo, dueños que operan su propio negocio.  
* **Límites Estrictos (Enforced by API):**  
  * 1 Sucursal máxima.  
  * 3 Usuarios máximos (Dueño \+ 2 turnos).  
  * 100 Productos máximos en el catálogo.  
* **Regla de Hardware:** **SÍ incluye Impresión Térmica de tickets**. Un POS sin impresora es inútil y mata la adopción.

### **💸 PLAN PRO ($249 / mes \- Precio Promo)**

*(Precio Regular: $499/mes)*

*El motor financiero de la empresa. Para negocios que delegan tareas y necesitan cumplimiento fiscal.*

* **Público:** Negocios consolidados con empleados y áreas divididas.  
* **Límites Expandidos:**  
  * 3 Sucursales (Expansión multi-branch).  
  * Usuarios Ilimitados.  
  * Productos Ilimitados.  
* **Desbloqueos Críticos:** \* Movilidad: Modo Mesero y Pantallas de Cocina (KDS).  
  * Fiscal: Facturación CFDI (SAT).  
  * Retención: Módulo de Clientes, Fiado y Lealtad.

### **🏢 PLAN ENTERPRISE ($999 / mes)**

*Para cadenas, franquicias y alta especialidad.*

* **Límites:** Sucursales ilimitadas.  
* **Desbloqueos Críticos:**  
  * Hardware Industrial: Integración de Básculas para venta por peso.  
  * Desarrollo: Acceso total a la API para integraciones externas (ERPs, e-commerce propios).

---

## **4\. MATRIZ EXHAUSTIVA DE FUNCIONALIDADES (FEATURE FLAGS)**

Esta tabla define exactamente qué candados (canUse) deben existir en el Frontend y Backend.

| Módulo / Funcionalidad | Free ($0) | Pro ($249) | Enterprise ($999) |
| :---- | :---- | :---- | :---- |
| **Operación de Caja** |  |  |  |
| Acceso a Motor POS (1 de 4\) | ✅ | ✅ | ✅ |
| Cierre y Corte de Caja (Turnos) | ✅ | ✅ | ✅ |
| Impresión de Tickets Térmicos | ✅ | ✅ | ✅ |
| Soporte de Básculas de Peso | ❌ | ❌ | ✅ |
| **Hardware y Roles Múltiples** |  |  |  |
| Dispositivo KDS (Cocina/Barra) | ❌ | ✅ | ✅ |
| Dispositivo Modo Mesero (Móvil) | ❌ | ✅ | ✅ |
| Kiosko de Auto-Servicio | ❌ | ✅ | ✅ |
| **Catálogo e Inventario** |  |  |  |
| Control de Stock Básico (+/-) | ✅ | ✅ | ✅ |
| Recetas e Insumos (Descuento x Venta) | ❌ | ✅ | ✅ |
| Gestión de Mermas y Proveedores | ❌ | ✅ | ✅ |
| **Clientes y Marketing** |  |  |  |
| Base de Datos de Clientes | ❌ | ✅ | ✅ |
| Cuentas por Cobrar (Fiado / Crédito) | ❌ | ✅ | ✅ |
| Programa de Lealtad (Puntos) | ❌ | ✅ | ✅ |
| Creador de Promociones / Combos | ❌ | ✅ | ✅ |
| **Fiscal y Analítica** |  |  |  |
| Reportes Básicos (Ventas del día) | ✅ | ✅ | ✅ |
| Gráficas, Analítica Avanzada y Export | ❌ | ✅ | ✅ |
| Facturación Electrónica (CFDI) | ❌ | ✅ | ✅ |
| Acceso a la API REST del Sistema | ❌ | ❌ | ✅ |

---

## **5\. REGLAS DE INFRAESTRUCTURA (HARDWARE COMO ROL)**

Para eliminar la confusión de "Usuarios vs Pantallas", el sistema administra el hardware de forma independiente a las personas.

### **Flujo de Operación de Hardware en Plan PRO**

Fragmento de código

graph LR  
    subgraph "Área de Piso"  
    A((Mesero 1\<br\>Usuario Móvil)) \-.-\>|Toma orden| B\[Base de Datos Nube\]  
    C((Mesero 2\<br\>Usuario Móvil)) \-.-\>|Toma orden| B  
    end

    subgraph "Área de Producción"  
    B \===\>|Sincroniza| D\[Tablet Pared\<br\>Rol: KDS Cocina\]  
    B \===\>|Sincroniza| E\[Tablet Barra\<br\>Rol: KDS Bebidas\]  
    end

    subgraph "Caja Físico"  
    F((Cajero\<br\>Usuario)) \--\> G\[PC/Tablet\<br\>Rol: Master POS\]  
    B \===\>|Recibe Cuentas| G  
    G \--\> H\[Impresora Térmica\]  
    G \--\> I\[Gaveta Dinero\]  
    end

* **Regla:** El KDS y la Caja Principal no requieren que un "Mesero" o "Cocinero" inicie sesión en ellos. Son dispositivos físicos vinculados a la sucursal. Los únicos que inician sesión constante (Login) son los dueños, administradores y los meseros en sus celulares.

---

## **6\. POLÍTICAS DE ENFORCEMENT Y SEGURIDAD (MANDATO PARA IT)**

Para proteger la integridad del modelo de negocio y evitar fugas de ingresos, el equipo de ingeniería debe acatar las siguientes reglas:

1. **El Frontend no es seguridad:** Ocultar botones en Angular o ponerles el estilo nav-item--locked es exclusivamente una estrategia de ventas (Up-sell). No se considera seguridad.  
2. **Validación Cuantitativa en el API:** Los controladores en .NET (ej. UserService.cs, ProductService.cs) deben interceptar la creación de entidades. Deben contar el total actual en la base de datos y cruzarlo con la constante del Plan (MaxUsers, MaxProducts). Si excede, lanzar error HTTP 402 Payment Required.  
3. **Bloqueo Funcional por Atributo:** Todo endpoint premium (CFDI, Reportes de Excel, KDS Sockets) debe tener el decorador \[RequiresPlan(PlanType.Pro)\] activo a nivel de controlador de C\#.  
4. **Protección de Downgrade:** Si un cliente deja de pagar y baja de Pro a Free, el API debe respetar su información existente, pero congelar inmediatamente sus capacidades extra (ej. ya no puede enviar comandas al KDS ni timbrar facturas, aunque el KDS siga prendido en la pared).

