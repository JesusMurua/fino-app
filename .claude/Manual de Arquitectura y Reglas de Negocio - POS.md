---

# **📖 MANUAL DE ARQUITECTURA, PRODUCTO Y REGLAS DE NEGOCIO**

**Sistema POS "Camaleón"**

## **1\. VISIÓN Y FILOSOFÍA DEL PRODUCTO**

El sistema POS es una plataforma de **Arquitectura Dual Inyectada**. No es un software genérico de "talla única". El sistema se reconfigura dinámicamente basándose en dos vectores principales:

1. **El Vector UX (Giro):** Determina el Motor de Interfaz (Cómo opera el cliente).  
2. **El Vector Capacidad (Plan):** Determina la profundidad financiera y operativa (Qué límites y módulos tiene).

---

## **2\. VECTOR UX: LOS 4 MOTORES POS (GIROS)**

El Onboarding del pos-landing obliga al cliente a elegir una de 4 categorías. Esta selección inyecta el BusinessTypeId en la base de datos, lo cual determina qué componente de Angular carga la Caja Principal.

### **Flujo de Asignación Automática (Onboarding)**

Fragmento de código

graph TD  
    A\[Cliente entra al Landing\] \--\> B{Selección de Categoría}  
    B \--\>|Restaurantes y Bares| C\[Inyecta Giro: Restaurante\]  
    B \--\>|Comida Rápida y Cafés| D\[Inyecta Giro: Fast Food\]  
    B \--\>|Tiendas y Comercios| E\[Inyecta Giro: Retail\]  
    B \--\>|Servicios Especializados| F\[Inyecta Giro: General\]  
      
    C \--\> G(Motor Asignado: TABLES MODE)  
    D \--\> H(Motor Asignado: COUNTER MODE)  
    E \--\> I(Motor Asignado: RETAIL MODE)  
    F \--\> J(Motor Asignado: QUICK MODE)

### **Detalle de los Motores**

* 🍽️ **Tables Mode / Restaurant (Restaurantes/Bares) — Hub Omnicanal:**
  La Caja Principal en modo Restaurante NO es un simple mapa de mesas. Es un **Hub Omnicanal** que centraliza tres canales de venta simultáneos:
  1. **Dine-in (Comer aquí):** Mapa de zonas y mesas. Flujo: Abrir mesa ➔ Asignar comensales ➔ Enviar comanda a cocina ➔ Imprimir pre-cuenta ➔ Cobrar.
  2. **Takeout (Para llevar):** Órdenes directas de mostrador sin asignación de mesa. Flujo: Agregar productos al carrito ➔ Cobrar ➔ Imprimir ticket con número de orden.
  3. **Comando central:** La Caja recibe, visualiza y cobra las cuentas creadas por los Meseros (dispositivos móviles) y coordina el flujo con las Pantallas de Cocina (KDS).

  La Caja Principal es el punto de convergencia de todos los dispositivos de la sucursal. No depende de que haya mesas activas para operar — siempre puede cobrar órdenes directas.

* 🍔 **Counter Mode (Comida Rápida/Cafés):** Renderiza cuadrícula táctil visual (Grid). Flujo: Tocar productos ➔ Cobrar inmediatamente ➔ Entregar ticket con número de orden. Opcionalmente envía comandas a cocina si `hasKitchen=true`.
* 🏪 **Retail Mode (Tiendas/Abarrotes):** Renderiza lista de alta densidad con búsqueda por nombre o código de barras. Flujo: Escaneo intensivo con lector de código de barras ➔ Cobro por teclado numérico con denominaciones de billetes.
* ✂️ **Quick Mode (Servicios):** Renderiza input de concepto libre. Flujo: Escribir servicio manual (ej. "Manicure") ➔ Ingresar precio variable ➔ Cobrar. También permite búsqueda en catálogo como función secundaria.

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

