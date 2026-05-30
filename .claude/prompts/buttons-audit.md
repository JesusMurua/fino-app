# Plan: Prompts reutilizables de UI/UX para botones (POS Táctil)

## Context

La pantalla `/admin/settings` (tab Negocio) muestra tres botones primarios verdes con copy distinto ("Guardar cambios", "+ Nueva sucursal", "Guardar configuración"), anchos heterogéneos y alineaciones diferentes. La auditoría confirmó que el problema es **sistémico**, no aislado:

- **65 templates HTML** con botones bajo `src/app/`.
- **30 clases `.btn-*` únicas** definidas en **15 archivos SCSS** distintos, sin una fuente central.
- Coexisten dos paradigmas: `<button class="btn-*">` HTML nativo y `<p-button>` de PrimeNG, sin criterio.
- Tres copys distintos para la misma acción: *Guardar cambios* / *Guardar configuración* / *Guardar datos fiscales*.
- Alturas dispersas: 32, 36, 40, 44 y 56 px. Border-radius 8 vs 12 px. Padding y alineación caso por caso.
- `src/styles/_touch.scss` ya impone `min-height: 64px` en `.p-button`, pero los `.btn-*` custom no respetan ese mínimo.

**Outcome buscado:** un set de prompts/checklist que cualquier dev (o agente) pueda pegar para auditar, diseñar y corregir botones en *cualquier* pantalla del proyecto, anclados en los estándares reales del repo (`.claude/*.md`, `src/styles/_variables.scss`, reglas de Touch UX de `CLAUDE.md`).

---

## Archivos críticos referenciados por los prompts

| Ruta | Por qué |
|---|---|
| `/home/user/fino-app/CLAUDE.md` | Reglas de Touch UX, design tokens, idioma (código en inglés / chat en español). |
| `/home/user/fino-app/.claude/response-guidelines.md` | "Analizar antes de codear, esperar confirmación, no agregar features extra". |
| `/home/user/fino-app/.claude/html-standards.md` | Orden de atributos, convenciones HTML/PrimeNG. |
| `/home/user/fino-app/.claude/coding-standards.md` | Naming, observables, regions. |
| `/home/user/fino-app/src/styles/_variables.scss` | Tokens: `$color-primary #16A34A`, `$radius-button 12px`, `$touch-target-min 64px`, `$touch-target-pos 48px`, `$font-size-base 16px`. |
| `/home/user/fino-app/src/styles/_touch.scss` | Override global `.p-button { min-height: 64px }`. |
| `/home/user/fino-app/src/styles.scss` | Override de tema PrimeNG `lara-light-indigo` con `--primary-color: #16A34A`. |
| `/home/user/fino-app/angular.json` (líneas 37-43) | Tema base de PrimeNG cargado. |

**Componente con la patología más visible:**
- `src/app/modules/admin/components/settings/admin-settings.component.html` (640 líneas, 8 botones, 5 patrones distintos).
- `src/app/modules/admin/components/settings/admin-settings.component.scss` (977 líneas, define `.btn-primary`, `.btn-outline-green`, `.btn-secondary--sm`, `.btn-danger-link`).

---

## Deliverable: 4 prompts reutilizables

> Idioma: prompts redactados en español (siguiendo `response-guidelines.md`). El **código** generado por estos prompts debe permanecer en inglés.

---

### Prompt 1 — AUDIT (auditar una pantalla)

**Cuándo usarlo:** quieres un diagnóstico de los botones de una vista concreta antes de tocar nada.

```
Eres un auditor de UI/UX para una app POS Angular 18 + PrimeNG 17 ubicada en
/home/user/fino-app. Antes de responder, lee:
- CLAUDE.md (sección "Touch UX" y "Design System")
- .claude/html-standards.md
- src/styles/_variables.scss
- src/styles/_touch.scss

Tu tarea: auditar TODOS los botones de la pantalla/componente que te indique
el usuario. NO modifiques código. Solo lectura y reporte.

Pasos obligatorios:
1. Localiza el .html, .scss y .ts del componente.
2. Para CADA botón (`<button>`, `<p-button>`, `pButton`) lista:
   - Línea y archivo
   - Texto / label
   - Método (HTML nativo vs PrimeNG)
   - Clases (`.btn-*`, `styleClass`, severity, [outlined], [text], [rounded], size)
   - Ícono (PrimeIcons class)
   - Ancho/alto resueltos por SCSS (resuelve cascada hasta `_variables.scss`)
   - Estado disabled/loading y handler (click)
3. Detecta inconsistencias contra estas reglas del proyecto:
   a. Touch target ≥ 64×64 px (`$touch-target-min`); en POS ≥ 48px (`$touch-target-pos`).
   b. Color primario sólido reservado a UNA acción primaria por card/sección.
   c. Copy de guardado unificado a la palabra "Guardar" (sin sufijos como
      "cambios", "configuración", "datos fiscales").
   d. Border-radius = `$radius-button` (12px) salvo justificación.
   e. Padding consistente (rama interna del design system, ver Prompt 2).
   f. Alineación: botón primario al pie del card, alineado a la derecha en
      desktop, full-width en mobile (<768px).
   g. Íconos: o todos los botones primarios de la pantalla los llevan, o
      ninguno. Sin criterio mixto.
4. Devuelve una tabla resumen con columnas:
   `# | Botón | Archivo:línea | Problema | Severidad (🔴🟡🟢) | Regla violada`
5. Cierra con un resumen de "Top 3 cambios de mayor impacto".

Salida: SOLO el reporte. Sin proponer código todavía. Sin tocar archivos.
Idioma del reporte: español.

Pantalla a auditar: <RUTA_O_NOMBRE_DEL_COMPONENTE>
```

---

### Prompt 2 — DESIGN SYSTEM DE BOTONES (one-time, transversal)

**Cuándo usarlo:** una sola vez para definir el set canónico de variantes que reemplazará las 30 clases dispersas. Es prerequisito de Prompt 3.

```
Eres un Senior Frontend Architect (Angular 18 + PrimeNG 17). Tu tarea es
DEFINIR (no implementar) el sistema canónico de botones para
/home/user/fino-app.

Contexto obligatorio a leer antes de proponer:
- CLAUDE.md (secciones "Design System" y "Touch UX")
- src/styles/_variables.scss (tokens existentes)
- src/styles/_touch.scss (override global de .p-button)
- src/styles.scss (override del tema lara-light-indigo)
- Reporte de auditoría adjunto con las 30 clases existentes.

Restricciones del proyecto:
- Touch target mínimo: 64×64 px (admin) / 48×48 px (POS).
- Color primario: #16A34A; danger #DC2626; warning #D97706; secondary #6B7280.
- Spacing scale estricto múltiplo de 8px: 8/16/24/32/48/64.
- Border-radius cards 12px, modales 16px.
- No introducir librerías nuevas.
- Mantener compatibilidad con PrimeNG `<p-button>` (el resto del proyecto
  ya lo usa en diálogos).

Entregable (en español, sin código todavía):

1. **Variantes canónicas** — máximo 5 variantes funcionales:
   - primary-save     (guardar formulario)
   - primary-create   (crear nuevo / abrir modal de creación)
   - secondary        (cancelar, descartar)
   - danger           (eliminar, cancelar suscripción)
   - icon             (acciones inline en tablas)
   Para cada una define:
   - Cuándo usarla (regla de uso, máximo 2 líneas)
   - Color de fondo / texto / borde / hover / focus / disabled
   - Tamaños permitidos: sm (40px), md (48px), lg (56px), touch (64px)
   - Padding por tamaño
   - Ícono: opcional / obligatorio / prohibido
   - Posición típica en el layout

2. **Reglas globales:**
   - Una sola acción primaria visible por card o por modal footer.
   - Copy de guardado: SIEMPRE "Guardar" (no "Guardar cambios", no
     "Guardar configuración"). Excepción: cuando el botón guarda y avanza,
     usar "Guardar y continuar".
   - Copy de creación: "Nueva <entidad>" (ej. "Nueva sucursal",
     "Nuevo producto").
   - Copy de borrado: "Eliminar". Confirmaciones destructivas en p-dialog.

3. **Estrategia de migración:**
   - Mapping: cada una de las 30 clases existentes → variante canónica.
   - Orden de migración por módulo (admin/settings primero, POS al final).
   - Plan de coexistencia: clases legacy se mantienen 1 sprint con `@deprecated`.

4. **Estructura de archivos propuesta** (rutas absolutas, sin código):
   - src/styles/_buttons.scss   (definiciones de variantes)
   - src/styles/_buttons.tokens.scss   (extensiones de _variables.scss)
   - Importación desde src/styles.scss

5. **Criterios de aceptación verificables:**
   - 0 clases `.btn-*` huérfanas fuera de _buttons.scss.
   - Todos los botones cumplen `min-height >= $touch-target-min` en admin.
   - Lighthouse a11y ≥ 95 en /admin/settings.

Devuélvelo como un Design Doc de máximo 2 páginas. Sin TypeScript, sin SCSS
final. Solo arquitectura, reglas y mapping.
```

---

### Prompt 3 — FIX (aplicar el sistema a una pantalla)

**Cuándo usarlo:** después de aprobar el Design Doc del Prompt 2, para migrar una pantalla concreta. Pegar el Design Doc aprobado dentro del bloque `<<<DESIGN_DOC>>>`.

```
Eres un Senior Angular 18 dev. Vas a MIGRAR los botones de UNA pantalla al
sistema canónico de botones definido más abajo.

Reglas estrictas (de .claude/response-guidelines.md):
- Implementa SOLO lo solicitado. No agregues features.
- Espera confirmación antes de codear.
- Código en inglés (clases, métodos, vars, JSDoc). Chat en español.
- Sigue .claude/html-standards.md para orden de atributos.
- No introduzcas librerías nuevas.

Pasos:
1. Lee la pantalla destino (.html, .scss, .ts).
2. Para cada botón mapea:
   `clase actual → variante canónica` según el mapping del Design Doc.
3. Presenta un PLAN antes de tocar archivos:
   - Lista de archivos que modificarás (rutas absolutas).
   - Diff conceptual por botón (texto antes/después, clase antes/después,
     posición/alineación si cambia).
   - Riesgos: si la pantalla tiene tests E2E que dependen del texto del
     botón, márcalo y propón actualizar el selector.
4. ESPERA aprobación explícita del usuario.
5. Tras aprobación:
   - Modifica solo la pantalla indicada.
   - Si una clase legacy queda sin uso global, NO la borres aún (eso es
     sprint de cleanup posterior).
   - Si el copy cambia (ej. "Guardar cambios" → "Guardar"), actualiza
     también selectores en e2e/*.spec.ts si existen.
6. Verifica:
   - `npm run lint` pasa.
   - `npm test` pasa.
   - `npm run build` compila.
   - Tap targets ≥ 64px en admin / 48px en POS (mide en SCSS resuelto).
7. Resume cambios y pregunta si quiere proceder con la siguiente pantalla.

DESIGN_DOC:
<<<
[PEGAR AQUÍ EL DESIGN DOC APROBADO DEL PROMPT 2]
>>>

Pantalla a migrar: <RUTA_O_NOMBRE_DEL_COMPONENTE>
```

---

### Prompt 4 — CHECKLIST (self-review antes de commit)

**Cuándo usarlo:** justo antes de `git commit` cuando tocaste botones en cualquier PR.

```
Revisa el diff actual de la rama. Para cada botón añadido o modificado en
los archivos cambiados, verifica esta checklist y devuélvela marcada:

[ ] Texto sigue convención: "Guardar" / "Nueva <entidad>" / "Eliminar" /
    "Cancelar" — sin sufijos arbitrarios.
[ ] Variante usada existe en src/styles/_buttons.scss (primary-save,
    primary-create, secondary, danger, icon).
[ ] Tamaño elegido cumple touch target del contexto:
    - Admin: ≥ 64×64 px
    - POS: ≥ 48×48 px
    - Iconos en tabla: ≥ 40×40 px y con `aria-label` o `pTooltip`.
[ ] Una sola acción primaria visible por card / por modal footer.
[ ] Botón primario al pie del card, alineado a la derecha en desktop,
    full-width en mobile (<768px).
[ ] Íconos: criterio uniforme con el resto de botones primarios de la
    misma pantalla (todos o ninguno).
[ ] Atributos en orden: structural directives → bindings → component
    inputs → HTML attrs → directive selectors → styling → events
    (ver .claude/html-standards.md).
[ ] Si el botón es destructivo, confirma con p-confirmDialog antes de
    ejecutar.
[ ] Estados manejados: disabled mientras `isSaving()`, loading visible
    si la acción es async > 300ms.
[ ] Accesibilidad: botones solo-ícono llevan `aria-label`.
[ ] Si cambiaste copy, actualizaste selectores de tests E2E que lo usan.
[ ] No introdujiste una clase `.btn-*` nueva fuera de
    src/styles/_buttons.scss.

Reporta solo los ítems que NO se cumplen, con archivo:línea y cómo
corregirlos. Si todo pasa, responde "✓ Checklist OK".
```

---

## Verificación end-to-end del deliverable

Para validar que estos prompts cumplen el objetivo:

1. **Smoke-test del Prompt 1 (AUDIT):**
   - Pasar `admin-settings.component` y verificar que el reporte mencione:
     - 3 copys distintos de "Guardar"
     - Botón "+ Nueva sucursal" con ancho/alineación divergente
     - Mezcla `.btn-primary` + `<p-button>` en el mismo componente
     - Footer del card "Giro del negocio" sin botón (asimetría visual)
   - Si lo detecta, el prompt funciona.

2. **Smoke-test del Prompt 2 (DESIGN):**
   - Verificar que el output incluya el mapping completo de las 30 clases
     listadas en la auditoría → 5 variantes canónicas, sin huérfanas.

3. **Smoke-test del Prompt 3 (FIX):**
   - Aplicarlo sobre `admin-settings` con un Design Doc aprobado y
     comprobar que el plan previo enumere los 8 botones detectados y
     mencione actualizar tests E2E si hay selectores por texto.

4. **Smoke-test del Prompt 4 (CHECKLIST):**
   - Correrlo sobre un commit ficticio que introduzca `<button class="btn-foo">Guardar cambios</button>` y verificar que rechace por copy y por clase fuera de `_buttons.scss`.

5. **Verificación de coherencia con estándares:**
   - Cada prompt referencia explícitamente los archivos canónicos del repo.
   - Ningún prompt instruye violar `response-guidelines.md` (todos exigen
     "espera confirmación" en pasos destructivos o de modificación).
   - Idioma: prompts en español, código generado en inglés.

---

## Notas operativas

- Los prompts viven en este plan; cuando se apruebe, se pueden mover a
  `.claude/prompts/buttons-*.md` (4 archivos) para reusarlos como skills
  o copy-paste.
- Prompt 2 debería correrse UNA vez y su output guardarse en
  `docs/design-system/buttons.md` como fuente de verdad.
- Prompts 1, 3 y 4 son recurrentes (por pantalla / por PR).