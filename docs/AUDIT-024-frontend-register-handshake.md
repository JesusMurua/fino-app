# AUDIT-024: Register Handshake (Landing → Frontend → Backend)

**Date:** 2026-04-10
**Scope:** Query-param ingestion, giro/plan mapping, register payload shape
**Goal:** Verificar que el frontend traduce correctamente los parámetros que vienen de la Landing Page y que el POST de registro coincide con el contrato del nuevo backend Feature Gating.

---

## 1. Mapa del flujo actual

```
Landing Page
    │
    │  GET /register?plan=basic&giro=retail&country=MX
    ▼
RegisterComponent.ngOnInit()
    │
    ├─ route.snapshot.queryParams['giro']  → giroMap[str] → BusinessTypeId (local)
    ├─ route.snapshot.queryParams['plan']  → this.pendingPlan: string | null
    └─ route.snapshot.queryParams['country'] → this.countryCode: string = 'MX'
    │
    ▼
Usuario completa el formulario (nombre, email, password, confirm)
    │
    ▼
submit()
    │
    ├─ planMap[this.pendingPlan] → PlanTypeId (local, inline)
    │
    ▼
HttpClient.post('/auth/register', {
  businessName, ownerName, email, password,
  businessTypeId: BusinessTypeId,     // SINGULAR — number
  planTypeId: PlanTypeId,             // number
  countryCode: 'MX'
})
    │
    ▼
LoginResponse → authService.handleLoginSuccess(response)
    │
    ├─ localStorage[`pending-plan-${branchId}`] = pendingPlan   (side-channel)
    │
    ▼
router.navigate(['/onboarding'])
    │
    ▼
OnboardingComponent
    │
    ├─ selectedGiros = signal<BusinessTypeId[]>([])       // MULTI
    ├─ customGiroText = signal<string>('')
    │
    ▼
PUT /business/type { businessTypes: BusinessTypeId[], customGiroDescription: string | null }
```

**El handshake se parte en dos pasos:** el `POST /auth/register` manda **un solo `businessTypeId`** (singular), y más tarde el `PUT /business/type` manda **un array `businessTypes`** (plural). El contrato inicial pierde información desde el primer segundo si la landing quisiera mandar más de un giro.

---

## 2. Respuestas a las cuatro preguntas del brief

### 2.1 ¿Cómo leemos los query params de la Landing Page?

**Respuesta corta:** de forma síncrona (`route.snapshot.queryParams`), solo en `ngOnInit`, sin validación, sin logging, sin re-lectura.

Archivo: [register.component.ts:102-132](src/app/modules/register/register.component.ts#L102-L132).

- **Tres claves reconocidas:** `giro`, `plan`, `country`. No hay documentación del contrato en el repo — la landing debe usar exactamente esos nombres o el dato se pierde en silencio.
- **Lectura síncrona:** `this.route.snapshot.queryParams`. Si el usuario navega desde otra parte de la SPA con un query string nuevo (ej. `/register?plan=pro`) sin remount, los params no se re-leen. No hay `route.queryParamMap.subscribe`.
- **Sin validación:** si `?giro=xyz`, el valor se normaliza con `.toLowerCase()`, el mapa no lo reconoce, y el formulario cae al default `BusinessTypeId.Restaurant` sin un toast, sin un warning, sin un param señalando que hubo un error.
- **`countryCode` default hardcodeado** a `'MX'`. No hay whitelist de países soportados. Si llega `?country=US` se envía al backend sin validar.
- **`pendingPlan` se guarda como string crudo** (no como `PlanTypeId`). La conversión a enum ocurre hasta `submit()` — eso acopla la forma de URL con la forma del payload en dos lugares distintos del componente.
- **Sin telemetría:** no hay `console.info` ni evento de analytics que deje traza de qué vino desde la landing. Imposible debuggear desde producción "el usuario decía que venía con plan Pro y le salió Free".

### 2.2 ¿Existe una capa de "Mapeo" URL→BusinessType?

**Respuesta corta:** sí, pero es un `Record<string, BusinessTypeId>` inline, incompleto, duplicado y desactualizado respecto al enum.

Archivo: [register.component.ts:108-116](src/app/modules/register/register.component.ts#L108-L116).

```typescript
const giroMap: Record<string, BusinessTypeId> = {
  restaurant: BusinessTypeId.Restaurant,
  cafe: BusinessTypeId.Cafe,
  bar: BusinessTypeId.Bar,
  retail: BusinessTypeId.Retail,
  foodtruck: BusinessTypeId.FoodTruck,
  'food-truck': BusinessTypeId.FoodTruck,
  general: BusinessTypeId.General,
};
```

**Problemas:**

1. **Cobertura incompleta.** El enum `BusinessTypeId` tiene 12 valores: Restaurant, Retail, Cafe, Bar, FoodTruck, General, Taqueria, Abarrotes, Ferreteria, Papeleria, Farmacia, Servicios. El mapa solo reconoce 6 (más un alias `food-truck`). Si la landing manda `?giro=taqueria`, `?giro=abarrotes`, `?giro=ferreteria`, `?giro=papeleria`, `?giro=farmacia` o `?giro=servicios` — los cinco giros de la matriz de Retail y Services — el usuario cae en `Restaurant` por default.

2. **Duplicación en el mismo archivo.** Hay DOS mapas con propósitos solapados:
   - `GIRO_BADGE_MAP` (líneas 16-24) para el texto del badge visual.
   - `giroMap` inline (líneas 108-116) para convertir URL → enum.
   
   Los dos se mantienen a mano y ya divergieron: `GIRO_BADGE_MAP` tampoco incluye taqueria/abarrotes/ferreteria/papeleria/farmacia/servicios.

3. **Fallback silencioso.** Si el string no matchea nada, `mapped` queda `undefined`, la condición `if (mapped)` lo descarta, y el form conserva su default `BusinessTypeId.Restaurant` (definido en la construcción del FormGroup). El usuario nunca sabe que su selección se perdió.

4. **No hay simétrico enum→URL.** Si el frontend quisiera reabrir la landing con el giro actual como query param, tendría que mantener un tercer mapa en otro lugar.

5. **No reutiliza el `CatalogService.businessTypes()` signal** que ya existe (ver [catalog.service.ts:38](src/app/core/services/catalog.service.ts#L38)) y tiene el `code` como campo canónico. Ese servicio es la fuente de verdad de los business types del backend — el mapa inline la ignora.

6. **El mapeo de plan es peor.** Misma arquitectura, mismos defectos:
   ```typescript
   const planMap: Record<string, PlanTypeId> = {
     basic: PlanTypeId.Basic,
     pro: PlanTypeId.Pro,
     enterprise: PlanTypeId.Enterprise,
   };
   ```
   No incluye `free`, case-sensitive lowercase. Si la landing manda `?plan=PRO` → no matchea → default Free. Silencioso.

### 2.3 ¿Qué estructura tiene el payload del POST /auth/register?

**Respuesta corta:** un object literal anónimo construido en el componente, sin interface, con un solo `businessTypeId` (singular) como number.

Archivo: [register.component.ts:174-179](src/app/modules/register/register.component.ts#L174-L179).

```typescript
await firstValueFrom(
  this.http.post<LoginResponse>(
    `${environment.apiUrl}/auth/register`,
    {
      businessName,
      ownerName,
      email,
      password,
      businessTypeId: businessType,   // number (BusinessTypeId)
      planTypeId,                     // number (PlanTypeId)
      countryCode: this.countryCode,  // 'MX' default
    },
  ),
);
```

**Hallazgos:**

1. **No existe una interface `RegisterRequest`** en [auth.model.ts](src/app/core/models/auth.model.ts). Ese archivo solo tiene `AuthUser`, `LoginResponse`, `SubscriptionStatus`, `BranchInfo`. El payload del register es literalmente un object literal anónimo. El backend podría renombrar un campo y el frontend compilaría igual.

2. **NO envía un array de giros.** El campo se llama `businessTypeId` (singular, numérico). Pero el onboarding wizard sí maneja multi-giro (`selectedGiros: signal<BusinessTypeId[]>([])`) y el endpoint `PUT /business/type` aceptará un array `businessTypes` — **el handshake inicial queda desincronizado.** Si la landing algún día quisiera pasar `?giros=retail,papeleria` (plural), el código actual ni siquiera puede leerlo.

3. **No incluye `customGiroDescription`.** El onboarding lo captura cuando el usuario elige "Otra tienda" y lo manda en el PUT posterior. La landing no puede pasar un giro personalizado por URL hoy.

4. **El `planTypeId` queda inmediatamente stale.** El backend puede sobrescribir el plan en la response (por trial logic, validación, A/B test), pero el frontend manda un valor que el usuario no confirmó explícitamente — es solo lo que traía la URL. El registro efectivamente declara un plan sin consentimiento en pantalla.

5. **No pasa por `AuthService`.** El componente hace `inject(HttpClient)` y `http.post` directo. Hay un comentario en [auth.service.ts:411](src/app/core/services/auth.service.ts#L411) que dice *"Public so register flow can call it with the registration response"* — la arquitectura esperaba que el `register()` viviera en `AuthService`, pero nunca se terminó de implementar. Los dos otros flujos de login (`pinLogin`, `emailLogin`) sí son métodos del service. Register es el único outlier.

6. **El `ownerName` no está en `AuthUser`.** Se envía al backend pero no hay ningún campo en [auth.model.ts](src/app/core/models/auth.model.ts) que lo reciba de vuelta. Si el backend lo persiste, el frontend no lo puede mostrar después sin un fetch extra.

7. **El `pendingPlan` se guarda en localStorage DESPUÉS del `handleLoginSuccess()`**, en [register.component.ts:184-186](src/app/modules/register/register.component.ts#L184-L186), con la clave `pending-plan-${currentBranchId}`. Eso crea un canal lateral entre register y onboarding (step 4 del wizard lo lee), acoplado por el `branchId` que apenas se acaba de asignar. Si `currentBranchId` es `0` (caso de error no explícito), el dato se pierde en silencio — `if (this.pendingPlan && user.currentBranchId)`.

8. **No hay CSRF ni anti-forgery.** El endpoint es público, acepta JSON crudo. Aceptable si el backend lo maneja, pero vale mencionarlo.

9. **Contrato implícito no validado en el cliente.** No hay una zod/joi/TS guard que valide el shape de `LoginResponse` al regresar. El frontend asume que el backend devuelve exactamente lo que espera y, si algún día agrega o remueve campos, los errores aparecerán hasta el render del siguiente componente.

### 2.4 Código legacy / lógica espagueti en el register

**Respuesta corta:** el componente hace demasiadas cosas que deberían vivir en `AuthService` + un `RegisterRequest` tipado + una capa única de mapeo. Hay mínimo 7 olores distintos.

**Olores detectados:**

1. **Tres fuentes de verdad para "qué significa `retail` en URL":**
   - `GIRO_BADGE_MAP` (líneas 16-24) — UI
   - `giroMap` inline (líneas 108-116) — URL→enum
   - `businessTypeOptions` (líneas 62-69) — dropdown fallback
   - `BUSINESS_TYPE_LABELS` en [config.enum.ts](src/app/core/enums/config.enum.ts) — labels globales
   
   Cuatro lugares que mantener sincronizados. Ya divergieron.

2. **`pendingPlan` como `string | null` (no como enum).** Se guarda en una propiedad privada stringificada y se convierte a `PlanTypeId` solo en `submit()`. El tipo se pierde entre `ngOnInit` y `submit` — cualquier refactor perdería el mapping silenciosamente.

3. **`HttpClient` inyectado directo.** El resto del proyecto usa `ApiService` como wrapper de HttpClient para agregar interceptores, baseUrl y headers comunes. Este componente bypassea esa capa.

4. **`environment.apiUrl` hardcoded** en el string del endpoint. Si el `ApiService` cambia la URL base, este componente no se entera.

5. **Error handling basado en `err?.status === 409`** con string match en el mensaje para decidir si mostrar el link "¿Iniciar sesión?" ([register.component.html:113](src/app/modules/register/register.component.html#L113)):
   ```html
   @if (errorMessage().includes('ya tiene')) {
     <a routerLink="/login">...</a>
   }
   ```
   La UI depende de la SUBSTRING exacta del mensaje de error que el propio componente genera. Cualquier cambio al texto del error rompe el link silenciosamente. Debería ser un `signal<'taken' | 'generic' | null>()`.

6. **Form definition con default hardcoded en `BusinessTypeId.Restaurant`** ([register.component.ts:77](src/app/modules/register/register.component.ts#L77)) — sin relación con lo que venga del URL. Si el patch por giroMap falla, el usuario ve "Restaurante" sin saber por qué.

7. **`submit()` mezcla tres responsabilidades:** validación del form, mapeo de plan, llamada HTTP, persistencia de side-channel en localStorage, manejo de errores, y navegación. Es el anti-patrón del "god method" — debería ser `authService.register(payload)` que devuelva `LoginResponse` o lanza `RegistrationError`.

8. **Duplicación del mapa `giroMap` con el de `onboarding.component.ts`.** El wizard de onboarding tiene su propio `GIRO_INFO_MAP`, `RETAIL_SUB_OPTIONS`, `PRICING_GROUP_MAP`, etc. Los dos componentes mantienen mapas paralelos. Cuando alguien agrega un nuevo giro (ej. Farmacia), tiene que actualizar dos componentes + un enum + un catálogo.

9. **`country: 'MX'` hardcodeado como default** en una propiedad privada inicializada en la declaración. No reactivo, no parametrizable, no testeable aisladamente.

10. **No limpia los query params después de leerlos.** Si el usuario regresa a `/register` por back-button, los query params siguen ahí — pero si editó el dropdown mientras tanto, la siguiente visita re-aplicará el URL. No hay conflict resolution.

---

## 3. Matriz de mismatches frontend ⇄ backend

| Concepto | Landing / URL | Register (frontend) | Register (payload) | Onboarding (frontend) | Endpoint onboarding | Backend (esperado) |
|---|---|---|---|---|---|---|
| Giro | `?giro=retail` (string) | `giroMap[str]` → `BusinessTypeId` | `businessTypeId: number` (singular) | `selectedGiros: BusinessTypeId[]` | `PUT /business/type` con `businessTypes: BusinessTypeId[]` | Probablemente `businessTypes: number[]` en el register también |
| Giro custom | ❌ no soportado | ❌ no capturado | ❌ no enviado | `customGiroText` | `customGiroDescription: string \| null` | Falta en register |
| Plan | `?plan=basic` (string) | `planMap[str]` → `PlanTypeId` | `planTypeId: number` | `pendingPlan: signal<string>` (re-leído de localStorage) | stripe checkout en step 4 | OK pero acoplado vía localStorage |
| Country | `?country=MX` | `countryCode: string = 'MX'` | `countryCode: 'MX'` | — | — | OK (si backend valida) |
| Giros no mapeados | `taqueria, abarrotes, ferreteria, papeleria, farmacia, servicios` | Silent default a Restaurant | Wrong giro en payload | — | — | **Bug crítico** — 50% del catálogo de giros no llega al backend |

---

## 4. Riesgos inmediatos

| ID | Severidad | Descripción |
|---|---|---|
| R1 | **Alta** | 6 de 12 `BusinessTypeId` (Taqueria, Abarrotes, Ferreteria, Papeleria, Farmacia, Servicios) no están en el `giroMap`. Cualquier usuario que venga de la landing con alguno de esos giros termina registrado como Restaurant. |
| R2 | **Alta** | El payload manda `businessTypeId` singular. Si el nuevo backend de Feature Gating exige un array `businessTypes` (como hace `PUT /business/type`), el register rompe con un 400. |
| R3 | Media | `planMap` case-sensitive lowercase, no maneja `free`. Si la landing manda `?plan=PRO`, cae a Free sin toast. |
| R4 | Media | `pendingPlan` se pierde si `currentBranchId === 0` (caso de regresar un response sin branch). El usuario nunca llega al checkout. |
| R5 | Media | No hay interface `RegisterRequest` tipada. Un cambio de contrato en el backend es silent TypeScript-pass. |
| R6 | Baja | Error handling por substring match (`errorMessage.includes('ya tiene')`). Cualquier cambio de i18n rompe el link "iniciar sesión". |
| R7 | Baja | Double mapas (`GIRO_BADGE_MAP` vs `giroMap` vs `businessTypeOptions`) ya divergieron. |
| R8 | Baja | Query params solo se leen en `ngOnInit` (snapshot). No reactivos. |

---

## 5. Preguntas abiertas antes de proponer solución

1. **¿Cuál es el contrato exacto del nuevo `POST /auth/register` en el backend?** Específicamente: ¿espera `businessTypeId: number` o `businessTypes: number[]`? ¿Acepta `customGiroDescription` en el register o solo en el PUT posterior?
2. **¿El backend devuelve `features: string[]` en la `LoginResponse` del register?** Ya lo agregamos a `AuthUser`/`LoginResponse` en la fase 6.2, pero no sé si el backend lo emite en el endpoint de register (solo en login).
3. **¿La landing puede mandar un array de giros?** Ej. `?giros=retail,papeleria`. Si sí, necesitamos un parser CSV en el frontend. Si no, podemos mantener `giro` singular en URL y convertir a array en el payload (`[BusinessTypeId.Retail]`).
4. **¿Cuál es la lista canónica de strings válidos para `?giro=` y `?plan=`?** ¿Está documentada en la landing? Necesito una fuente para validar en el frontend antes de hacer el request.
5. **¿El endpoint `/auth/register` debe existir como método en `AuthService` (simetría con `pinLogin`/`emailLogin`)?** Mi recomendación es sí, pero quiero confirmarlo antes de refactorizar.
6. **¿Queremos manejar un parámetro `?ref=` (referral)** para tracking? No está en el scope de esta auditoría pero sería el momento de incluirlo si lo planeas agregar.
7. **¿El `ownerName` se persiste en `AuthUser`?** Si sí, necesito agregarlo a la interface. Si no, ¿por qué lo mandamos?

---

## 6. Próximo paso

**Esperando confirmación** antes de proponer la solución. Una vez tenga respuestas a las preguntas de §5, voy a diseñar:

1. Un `RegisterRequest` interface tipado en `auth.model.ts`.
2. Un método `AuthService.register(payload: RegisterRequest): Promise<AuthUser>` simétrico a `emailLogin`.
3. Una capa de parseo de query params centralizada (un `RegistrationIntent` value object con factory `fromQueryParams(params)`) que maneje los 12 giros y 4 planes con validación y logging.
4. Eliminación de los mapas duplicados, consolidándolos en un único helper que lea del `CatalogService` o de una constante en `enums/`.
5. Refactor del `submit()` a ~10 líneas: valida form → construye `RegisterRequest` → llama `authService.register` → maneja typed error → navega.
6. Decisión documentada sobre si el payload manda `businessTypeId` o `businessTypes` (dependiendo de la respuesta a la pregunta 1).

---

*Generated by Claude Code — AUDIT-024*
