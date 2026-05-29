# FDD-034 — Design System Sweep (F4)

> **Estado:** EJECUTADO. Bloque value-preserving (tokens + hex + spacing on-scale + fonts exactos) y Sweep 2 (off-scale spacing → escala) aplicados; `ng build` verde. Fonts <16px small-text conservados por decisión §6.
> **Predecesor:** [FDD-033](FDD-033-design-system-extension.md) (F3 — vocabulario de tokens + consolidación `.btn-primary` + tokenización `styles.scss`).
> **Origen:** AUDIT-059 §6 F4 — "The Sweep".
> **Naturaleza:** capa de presentación. **Impacto en specs/tests: NINGUNO.**

---

## 1. Executive Summary

### 1.1 Problema

FDD-033 (F3) completó el vocabulario base de tokens y barrió **un solo archivo** (`src/styles.scss`). Los **85 component `.scss` files** (bajo `src/app`) restantes siguen con color, spacing y tipografía hardcodeados. El inventario verificado contra producción:

- **Hex:** 105 literales únicos / ~1,600 ocurrencias en componentes. *(Conteos por color ±1–6 según definiciones en `_variables.scss`; no alteran la clasificación.)*
- **Spacing off-scale:** valores fuera de la escala `$space-*` en `margin`/`padding`/`gap`.
- **Font-size <16px:** 608 ocurrencias en px + varias en `rem`.

### 1.2 El hallazgo central (por qué F4 no es "un codemod")

Un "mass codemod para reemplazar todo hex por token" es **imposible tal cual**: de 105 hex únicos, solo ~30 (las escalas semánticas de alta frecuencia) merecen token global. Los ~75 restantes son **colores feature-local de baja frecuencia** (gradientes del panel de delivery, verdes de WhatsApp, escalas violet/pink/teal de badges específicos) — la mayoría con **1–2 ocurrencias**. Tokenizar un color usado una vez **viola NF-4** (no crear tokens especulativos); además globaliza lo que debería ser local.

Y los tres sweeps **no son equivalentes**:

| Sweep | Naturaleza | Riesgo | Método |
|-------|-----------|--------|--------|
| **1 — Hex** | value-**preserving** (token == literal exacto) | cero regresión visual | codemod automático + revisión de diff |
| **2 — Spacing** | value-**changing** (`10px→8px` mueve layout) | regresión visual real | audit por instancia + revisión visual |
| **3 — Typography** | juicio semántico (no mecánico) | regresión visual alta | clasificación + audit; excluir iconos |

### 1.3 Solución y fronteras

1. **Expandir el vocabulario** (Sweep 0, prerequisito): promover a tokens globales las 4 escalas semánticas que faltan (**red/error, amber/warning, blue/info, slate**), value-preserving. La escala **gray** y la **primary/green** ya están completas en F3.
2. **Sweep 1 (Hex):** codemod value-preserving que mapea cada literal tokenizado → token. Los feature-local quedan como `// intentional literal: <reason>` (clasificados exhaustivamente en §4.3 — **nada suelto**).
3. **Sweep 2 (Spacing):** audit value-changing con tabla de decisión por valor + reglas "leave".
4. **Sweep 3 (Typography):** audit con clasificación body/label/icon + manejo de `rem`.

**Explícitamente FUERA de F4** (porque serían value-**changing** sin revisión de diseño, no porque se difieran por tiempo):
- Unificar las familias **gray** y **slate** (dos familias neutras Tailwind distintas que coexisten) — colapsarlas cambia colores.
- Unificar **primary-green** (#16a34a) con **emerald** (#10b981) usados como "success" — cambia color.
- Unificar gray/slate y primary/emerald (líneas arriba). *(El supuesto indigo `#6366f1` resultó falso positivo — solo en comentarios de `styles.scss`, ver §4.4.)*

Estas se registran como **decisiones tomadas (no OQs)**: se posponen a un pass value-changing separado con revisión visual. F4 es estrictamente value-preserving para hex.

---

## 2. Scope & Exclusions

### 2.1 Universo de archivos

**Target = 85 archivos** = `src/app/**/*.scss` (todos los component styles) EXCEPTO los ya cubiertos:

| Excluido | Razón |
|----------|-------|
| `src/styles/_variables.scss` | definiciones de token (no consumidor) |
| `src/styles/_components.scss` | partial ya canónico (F3 P2) |
| `src/styles/_layout.scss`, `_touch.scss` | partials de sistema |
| `src/styles.scss` | ya barrido en F3 P3 |

### 2.2 Exclusiones dentro de los archivos target

- **Selectores de icono** (`i`, `.pi`, `[class*="icon"]`, `svg`): `font-size` ahí dimensiona glifos, **no es texto** → fuera del audit tipográfico.
- **Micro-spacing `1px`/`2px`**: hairlines y ajustes ópticos intencionales → no tocar.
- **Dimensiones fijas** (`width`/`height`/`min-*`/`max-*`): fuera del spacing sweep (solo `margin`/`padding`/`gap`).
- **Literales feature-local** clasificados en §4.3: no se tokenizan; se documentan in-place.

---

## 3. Sweep 0 — Token Vocabulary Expansion (prerequisito, value-preserving)

Se añaden a `_variables.scss` las 4 escalas que faltan. **Cada token == hex exacto presente en el código** (cero color nuevo, cero valor cambiado). Naming: ramp estilo Tailwind (`-50..900`), anclado en los tokens semánticos ya existentes (que se conservan como aliases del shade correspondiente).

### 3.1 Red / Error scale

| Shade | Hex | Occ. | Token | Estado |
|-------|-----|------|-------|--------|
| 50 | `#fef2f2` | 48 | `$color-error-50` | **NEW** |
| 100 | `#fee2e2` | 10 | `$color-error-bg` | existe (alias 100) |
| 200 | `#fecaca` | 12 | `$color-error-200` | **NEW** |
| 300 | `#fca5a5` | 3 | `$color-error-300` | **NEW** |
| 500 | `#ef4444` | 9 | `$color-error-500` | **NEW** |
| 600 | `#dc2626` | 110 | `$color-error` | existe (alias 600) |
| 700 | `#b91c1c` | 9 | `$color-error-700` | **NEW** |
| 800 | `#991b1b` | 5 | `$color-error-800` | **NEW** |
| 900 | `#7f1d1d` | 3 | `$color-error-900` | **NEW** |

### 3.2 Amber / Warning scale

| Shade | Hex | Occ. | Token | Estado |
|-------|-----|------|-------|--------|
| 50 | `#fffbeb` | 13 | `$color-warning-50` | **NEW** |
| 100 | `#fef3c7` | 27 | `$color-warning-100` | **NEW** |
| 200 | `#fde68a` | 12 | `$color-warning-200` | **NEW** |
| 300 | `#fcd34d` | 3 | `$color-warning-300` | **NEW** |
| 400 | `#fbbf24` | 1 | `$color-warning-400` | **NEW** |
| 500 | `#f59e0b` | 7 | `$color-warning-500` | **NEW** |
| 600 | `#d97706` | 62 | `$color-warning` | existe (alias 600) |
| 700 | `#b45309` | 8 | `$color-warning-700` | **NEW** |
| 800 | `#92400e` | 17 | `$color-warning-800` | **NEW** |
| 900 | `#78350f` | 1 | `$color-warning-900` | **NEW** |

### 3.3 Blue / Info scale

| Shade | Hex | Occ. | Token | Estado |
|-------|-----|------|-------|--------|
| 50 | `#eff6ff` | 19 | `$color-info-50` | **NEW** |
| 100 | `#dbeafe` | 13 | `$color-info-100` | **NEW** |
| 200 | `#bfdbfe` | 4 | `$color-info-200` | **NEW** |
| 300 | `#93c5fd` | 2 | `$color-info-300` | **NEW** |
| 500 | `#3b82f6` | 13 | `$color-info-500` | **NEW** |
| 600 | `#2563eb` | 24 | `$color-info` | existe (alias 600) |
| 700 | `#1d4ed8` | 13 | `$color-info-700` | **NEW** |
| 800 | `#1e40af` | 3 | `$color-info-800` | **NEW** |
| 900 | `#1e3a8a` | 1 | `$color-info-900` | **NEW** |

### 3.4 Slate scale

| Shade | Hex | Occ. | Token | Estado |
|-------|-----|------|-------|--------|
| 50 | `#f8fafc` | 24 | `$color-bg-page` | existe (alias 50) |
| 100 | `#f1f5f9` | 19 | `$color-border-soft` | existe (alias 100) |
| 200 | `#e2e8f0` | 12 | `$color-slate-200` | **NEW** |
| 300 | `#cbd5e1` | 5 | `$color-slate-300` | **NEW** |
| 400 | `#94a3b8` | 11 | `$color-slate-400` | **NEW** |
| 500 | `#64748b` | 13 | `$color-slate-500` | **NEW** |
| 600 | `#475569` | 4 | `$color-slate-600` | **NEW** |
| 700 | `#334155` | 1 | `$color-slate-700` | **NEW** |
| 800 | `#1e293b` | 5 | `$color-slate-800` | **NEW** |
| 900 | `#0f172a` | 11 | `$color-slate-900` | **NEW** |

> **Nota gray vs slate:** el repo usa AMBAS familias neutras de Tailwind (gray: `#e5e7eb`…`#111827`; slate: `#f8fafc`…`#0f172a`). Son hues distintos. F4 las conserva separadas (value-preserving). Unificarlas es un pass value-changing futuro (§1.3).

### 3.5 Total Sweep 0

**32 tokens nuevos** (7 red + 9 amber + 8 blue + 8 slate; los shades 600/bg/50/100 ya existían como semánticos y se conservan como alias). Pura adición a `_variables.scss`: cero consumidores tocados, cero cambio visual. Es prerequisito de Sweep 1.

---

## 4. Sweep 1 — Hex Codemod (value-preserving)

### 4.1 Familias ya completas (referencia — tokens de F3)

| Gray | Hex | Token |  | Primary/Green | Hex | Token |
|------|-----|-------|--|---------------|-----|-------|
| 50 | `#f9fafb` | `$color-surface-muted` |  | 50 | `#f0fdf4` | `var(--primary-50)` / `$color-primary-light` |
| 100 | `#f3f4f6` | `$color-surface-hover` |  | 100 | `#dcfce7` | `var(--primary-100)` |
| 200 | `#e5e7eb` | `$color-border` |  | 200 | `#bbf7d0` | `var(--primary-200)` |
| 300 | `#d1d5db` | `$color-border-strong` |  | 300 | `#86efac` | `var(--primary-300)` |
| 400 | `#9ca3af` | `$color-text-muted` |  | 400 | `#4ade80` | `var(--primary-400)` |
| 500 | `#6b7280` | `$color-text-sub` |  | 500 | `#22c55e` | `var(--primary-500)` |
| 700 | `#374151` | `$color-text-body` |  | 600 | `#16a34a` | `var(--primary-color)` / `$color-primary` |
| 800 | `#1f2937` | `$color-delivery-card` |  | 700 | `#15803d` | `var(--primary-700)` |
| 900 | `#111827` | `$color-text-title` |  | 800 | `#166534` | `var(--primary-800)` |
|  |  |  |  | 900 | `#14532d` | `var(--primary-900)` |

`#16a34a`/`#15803d`/`#166534` → `var(--primary-*)` en contexto CSS (consistente con F3); `$color-*` solo en cálculo SCSS.

### 4.2 Regla del codemod

- **Case-insensitive** (`#E5E7EB` == `#e5e7eb`); cubrir formas `#fff` y `#ffffff`.
- **Solo valor de propiedad**, nunca dentro de comentarios.
- Reemplazo **exacto 1:1** literal→token (value-identical). **Prohibido aproximar** un hex a un token "parecido" (p.ej. `#3b82f6` ≠ `$color-info` #2563eb → sería regresión; por eso `#3b82f6` es `$color-info-500`, su token exacto).

### 4.3 Tier 2 — Feature-local colors (disposición por familia)

Colores de baja frecuencia, semántica feature-específica. **Disposición por familia:** las que tienen token exacto se **tokenizan** (Sweep 1); el resto quedan como `// intentional literal: <reason>`. **Clasificación completa (nada suelto):**

| Familia | Hex | Disposición |
|---------|-----|-------------|
| **Emerald/teal** (success accents) | `#ecfdf5` `#d1fae5` `#6ee7b7` `#10b981` `#059669` `#047857` `#065f46` `#ccfbf1` `#99f6e4` `#0f766e` | literal local; candidato a unificar con primary en pass value-changing |
| **Violet/purple** (premium/membership) | `#f5f3ff` `#ede9fe` `#f3e8ff` `#8b5cf6` `#7c3aed` `#6d28d9` `#5b21b6` `#7e22ce` | literal local |
| **Pink** | `#db2777` `#f9a8d4` | literal local |
| **Sky** | `#f0f9ff` `#0369a1` | literal local |
| **Orange** (≠ amber) | `#fff7ed` `#fed7aa` `#ea580c` `#9a3412` | literal local |
| **Yellow / green extra** | `#a16207` `#052e16` `#0f5132` `#f0fff4` | literal local |
| **Delivery dark-panel gradient** | `#1e3a5f` `#1e3450` `#1e2d42` `#2d4a6a` `#263548` `#131e30` `#0d1f36` `#0d1625` `#3d6080` `#3d5a72` `#4d7caa` `#2d2000` `#1a1200` | gradiente del hub de delivery; component-local |
| **WhatsApp brand** | `#25d366` `#075e54` | brand-local |
| **Delivery brand (ya tokenizado)** | `#06c167`→`$color-uber-eats` · `#ff441b`→`$color-rappi` · `#ff6b00`→`$color-didi-food` · `#fff1ee`→`$color-rappi-bg` · `#fff4ee`→`$color-didi-food-bg` · `#000000`→`$color-uber-eats-bg` | **tokenizar** (Sweep 1) |
| **Off-white/neutral** | `#fafafa` `#fafbfc` `#f8f9fa` | literal local (o → `$color-surface-muted` solo si exacto — NO lo son) |
| **White / black primitives** | `#ffffff` `#fff` `#000` | dejar como primitivo (sin token) |
| **Out-of-stock** | `#9e9e9e` | `$color-out-of-stock` (existe) → **tokenizar** |

### 4.4 Falso positivo descartado (post-ejecución)

`#6366f1` (indigo default de lara) NO existe en código de componentes — sus 2 ocurrencias están solo en **comentarios de `src/styles.scss`** que documentan qué color reemplazó F3. Verificado contra producción durante la ejecución: `grep #6366f1 src/app` → 0 matches. No hay bug que arreglar; P4 queda sin contenido.

---

## 5. Sweep 2 — Spacing Audit (value-changing)

`$space-1..8` = **{4, 8, 12, 16, 24, 32, 48, 64}px** = escala on-scale.

> **Decisión 4/12px:** CLAUDE.md dice "8px strict (8·16·24·32·48·64)" pero `$space-1`=4px y `$space-3`=12px existen y se usan ampliamente. **F4 considera 4 y 12 ON-scale** (la realidad de los tokens manda). El "strict" de CLAUDE.md se interpreta como "múltiplos de 4 sobre base 8", no literal.

### 5.1 Tabla de decisión por valor (solo `margin`/`padding`/`gap`)

| Valor | Occ. | Decisión | Nota |
|-------|------|----------|------|
| `1px` | 23 | **LEAVE** | hairline/óptico |
| `2px` | 92 | **LEAVE** | micro/óptico |
| `3px` | 13 | **LEAVE** (review) | óptico |
| `5px` | 13 | → `$space-1` (4) o `$space-2` (8) | per-instance |
| `6px` | 71 | → `$space-2` (8) | review (gaps pequeños) |
| `7px` | 5 | → `$space-2` (8) | |
| `9px` | 1 | → `$space-2` (8) | |
| `10px` | 62 | → `$space-2` (8) **por defecto** | equidistante 8/12 → visual review |
| `11px` | 1 | → `$space-3` (12) | |
| `13px` | 2 | → `$space-3` (12) | |
| `14px` | 20 | → `$space-4` (16) **por defecto** | equidistante 12/16 → visual review |
| `18px` | 6 | → `$space-4` (16) | review |
| `20px` | 13 | → `$space-5` (24) **por defecto** | equidistante 16/24 → visual review |
| `22px` | 1 | → `$space-5` (24) | |
| `28px` | 3 | → `$space-6` (32) | review |
| `30px` | 1 | → `$space-6` (32) | |
| `36px` | 3 | → `$space-6` (32) | review |
| `44px` | 2 | **LEAVE** | touch-target conocido, no spacing |
| `60px` | 2 | → `$space-8` (64) | review |
| `80px`, `100px` | 4,1 | **LEAVE** | dimensión fija de layout |

**Toda sustitución es un cambio visual** → gate de revisión visual obligatorio por archivo (§8). No es un regex ciego.

---

## 6. Sweep 3 — Typography Audit (judgment)

Regla CLAUDE.md: **body ≥ 16px**. Pero 430/608 de los <16px son small-text legítimo.

### 6.1 Reglas de clasificación

| Uso | Tamaño actual | Acción |
|-----|---------------|--------|
| **Icono** (`i`, `.pi`, `svg`, `[class*="icon"]`) | cualquiera | **EXCLUIR** (no es texto) |
| **Body copy** | `<16px` (típ. 15px) | **bump → `$font-size-base` (16)** |
| **Label/caption/meta** | `14px` | → `$font-size-label` (14) (tokenizar, sin cambio) |
| **Label/caption** | `13px`/`15px` | → `$font-size-label` (14) (review; cambio menor) |
| **Micro-badge** | `10–12px` | **KEEP** documentado (`// intentional: dense badge`) |
| **rem pequeñas** | `0.8125`/`0.875`/`0.9375rem` (=13/14/15px) | convertir igual que su equivalente px |

### 6.2 Distribución verificada (608 px <16px)

`12px`×165 · `13px`×153 · `14px`×112 · `11px`×74 · `15px`×55 · `10px`×38 · `9px`×6 · `8px`×5. La mayoría son label/caption/badge → **el subset "body <16px que viola la regla" es pequeño** y se identifica por contexto semántico, no por el número.

---

## 7. Detection Queries (corregidas — definition of done)

> Scope `src/app` (excluye de forma fiable los partials de `src/styles` y el ya-barrido `styles.scss`). NO usar `grep -v "src/styles/"` tras `-h`: sin nombre de archivo en la salida, no filtra por path.

```bash
# --- HEX --- universo de componentes:
grep -rEoh "#[0-9a-fA-F]{3,6}\b" src/app --include="*.scss" | tr 'A-F' 'a-f' | sort | uniq -c | sort -rn
# DoD Sweep 1: todo hex restante es Tier-2 documentado (// intentional literal) o primitivo (white/black).

# --- SPACING --- distribución de px en margin/padding/gap (robusto, sin regex frágil):
grep -rEoh "(margin|padding|gap)[^:;{}]*:[^;]*px" src/app --include="*.scss" | grep -oE "[0-9]+px" | sort -n | uniq -c
# Compara contra la escala {4,8,12,16,24,32,48,64}; §5.1 decide cada valor off-scale.
# (Reemplaza el proxy dígito-impar de FDD-033 §7, que omitía 6/10/14/18/20px.)
# DoD Sweep 2: los únicos off-scale restantes son los LEAVE de §5.1 (1,2,3,44,80,100px).

# --- FONT --- <16px (px) + rem pequeñas:
grep -rEn "font-size:\s*([0-9]|1[0-5])px" src/app --include="*.scss" | grep -viE "\bi\b|\.pi|icon|svg"
grep -rEn "font-size:\s*0\.[0-9]+rem" src/app --include="*.scss"
# El filtro de icono es GRUESO (selector e font-size suelen ir en líneas distintas);
# la clasificación final body/label/icon es manual por contexto (§6).
```

**DoD F4:**
- Sweep 0: las ~32 escalas existen en `_variables.scss`.
- Sweep 1: query hex → solo Tier-2 documentado + primitivos.
- Sweep 2: query spacing → solo valores `LEAVE` de §5.1.
- Sweep 3: query font → solo label/caption tokenizados o micro-badges documentados; cero body <16px.

---

## 8. Implementation Phases

Ordenadas por riesgo. Cada fase: file-scope + método + gate + rollback. **Sin estimaciones de duración.**

| Fase | Contenido | Riesgo | Método | Gate |
|------|-----------|--------|--------|------|
| **P0** | Sweep 0 — añadir ~32 tokens a `_variables.scss` | bajo | edición manual | `ng build` + grep tokens; cero consumidores → cero visual |
| **P1** | Sweep 1 — hex codemod (mappings §3 + §4.1 + delivery brand + out-of-stock) + documentar Tier-2 | bajo | codemod automático + diff review | `ng build` + query hex DoD; value-preserving → cero visual |
| **P2** | Sweep 2 — spacing audit | medio | **manual por instancia** + revisión visual | `ng build` + diff por archivo + screenshot review (es value-changing) |
| **P3** | Sweep 3 — typography audit | alto | **manual por instancia** (clasificación) | `ng build` + diff + revisión visual |
| ~~P4~~ | ~~Bug fix `#6366f1`~~ — descartado (falso positivo, §4.4) | — | — | — |

**Orden:** P0 → P1 (seguros, automatizables) ANTES de P2/P3 (juicio, visual). P2/P3 pueden batcharse por carpeta de feature para acotar la revisión visual.

---

## 9. Safety & Rollback

- **Batching:** P1 por familia de color; P2/P3 por carpeta de componente (1 PR-equivalente por batch para que el diff visual sea revisable).
- **Gate por batch:** `ng build` verde + `git diff` revisado + (P2/P3) verificación visual en navegador del/los componente(s) afectados.
- **Rollback:** cada batch es atómico; revertir = descartar el batch sin afectar a los demás.
- **Por qué hex se puede aplicar masivo y spacing/font NO:** hex es value-preserving (el render no cambia, basta `ng build`); spacing/font cambian píxeles → requieren ojo humano antes de consolidar.

---

## 10. Decisiones registradas (no Open Questions)

Todas resueltas en este doc — **nada queda abierto**:

1. **Hex sin token (~75 one-offs):** tiered — escalas→token global (§3), feature-local→literal documentado (§4.3).
2. **4px/12px:** ON-scale (§5, la realidad de `$space-*` manda sobre el "strict" textual de CLAUDE.md).
3. **Ramp small-text:** 13/14/15px → `$font-size-label` (14); 10–12px micro-badge se conservan documentados (§6).
4. **Expansión de vocabulario:** es prerequisito (P0), no FDD aparte — su naturaleza value-preserving lo permite.
5. **gray vs slate / primary vs emerald:** unificaciones son value-changing → fuera de F4; registrado como frontera explícita para un pass futuro con revisión visual. *(El indigo `#6366f1` resultó falso positivo, §4.4.)*

---

## 11. Spec / Test Impact

**Ninguno.** F4 es 100% capa de presentación (SCSS). No toca `.ts`, `.html`, modelos, ni el spec total (88 de FDD-032). Igual que FDD-033.
