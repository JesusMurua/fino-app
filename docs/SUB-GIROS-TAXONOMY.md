# Sub-giros — Taxonomía canónica (post-expansión)

> Lista final de los 123 sub-giros que existirán en `BusinessTypeCatalog`
> después de la migración propuesta. Fuente: SCIAN INEGI sector 81 + análisis
> de competidores (Square / Loyverse / Toast / Clip) + frecuencias DENUE.
>
> **Convenciones:**
> - `[E]` = entrada existente (IDs 1-20), label y macro byte-identical.
> - `[N]` = entrada nueva (IDs 21-123).
> - `[H]` = giro híbrido servicio+retail típico en México (24 de 62 nuevos en Services).
>
> Total: **123 entries** = 4 existing + 119 new. IDs 1-123, contiguos.
> Distribución por macro: F&B 15 · QS 18 · Retail 24 · Services 66.

---

## Macro 4 — Servicios Especializados (4 existing + 62 new = 66 total)

Organizado en **10 clusters** (`ClusterCode` en backend). El wizard muestra los
5 primeros clusters por default y los 5 restantes bajo "Ver más".

### CLUSTERS POR DEFAULT

#### Cluster `beauty` — Belleza y Cuidado Personal · 12 chips

| ID | Label | Tag |
|----|-------|-----|
| 17 | Estética / Barbería | [E] |
| 21 | Salón de belleza | [N][H] |
| 22 | Peluquería | [N] |
| 23 | Barbería | [N][H] |
| 24 | Salón de uñas / Manicura y pedicura | [N][H] **demo** |
| 25 | Estudio de pestañas y cejas | [N][H] |
| 26 | Spa / Masajes | [N][H] |
| 27 | Depilación / Cera / Láser | [N] |
| 28 | Maquillaje profesional | [N][H] |
| 29 | Estudio de tatuajes y perforaciones | [N] |
| 30 | Micropigmentación / PMU | [N] |
| 31 | Bronceado / Sunless | [N] |

#### Cluster `health` — Salud y Bienestar · 9 chips

| ID | Label | Tag |
|----|-------|-----|
| 19 | Consultorio / Clínica | [E] |
| 32 | Dentista / Consultorio dental | [N][H] |
| 33 | Nutriología | [N][H] |
| 34 | Psicología / Terapia | [N] |
| 35 | Fisioterapia / Rehabilitación | [N] |
| 36 | Optometría / Óptica | [N][H] |
| 37 | Quiropráctico | [N] |
| 38 | Podología | [N] |
| 39 | Acupuntura / Medicina alternativa | [N] |

#### Cluster `automotive` — Automotriz · 7 chips

| ID | Label | Tag |
|----|-------|-----|
| 18 | Taller Mecánico | [E] |
| 40 | Hojalatería y pintura | [N] |
| 41 | Vulcanizadora / Llantera | [N][H] |
| 42 | Auto lavado / Detailing | [N][H] |
| 43 | Servicio eléctrico automotriz | [N] |
| 44 | Verificación / Afinación | [N] |
| 45 | Taller de motos | [N][H] |

#### Cluster `pets` — Mascotas · 4 chips

| ID | Label | Tag |
|----|-------|-----|
| 46 | Veterinaria / Clínica veterinaria | [N][H] |
| 47 | Estética canina / Pet grooming | [N][H] |
| 48 | Pensión / Guardería de mascotas | [N] |
| 49 | Adiestramiento canino | [N] |

#### Cluster `repair` — Reparación y Tecnología · 8 chips

| ID | Label | Tag |
|----|-------|-----|
| 50 | Reparación de celulares | [N][H] |
| 51 | Reparación de computadoras / Soporte técnico | [N][H] |
| 52 | Cyber / Renta de equipo e impresiones | [N][H] |
| 53 | Reparación de electrodomésticos | [N] |
| 54 | Reparación de calzado | [N] |
| 55 | Sastrería / Arreglos de ropa | [N] |
| 56 | Cerrajería | [N] |
| 57 | Joyería y reparación | [N][H] |

### CLUSTERS BAJO "VER MÁS"

#### Cluster `fitness` — Fitness y Deportes · 5 chips

| ID | Label | Tag |
|----|-------|-----|
| 20 | Gimnasio / Deportes | [E] |
| 58 | Estudio de yoga / pilates | [N][H] |
| 59 | Academia de baile / Zumba | [N] |
| 60 | Artes marciales / Box | [N] |
| 61 | Spinning | [N] |

#### Cluster `education` — Educación y Academias · 5 chips

| ID | Label | Tag |
|----|-------|-----|
| 62 | Escuela de idiomas | [N] |
| 63 | Regularización / Tutorías escolares | [N] |
| 64 | Academia de música | [N][H] |
| 65 | Cursos y talleres (manualidades, repostería) | [N][H] |
| 66 | Guardería / Estancia infantil | [N] |

#### Cluster `home` — Hogar y Servicios Técnicos · 5 chips

| ID | Label | Tag |
|----|-------|-----|
| 67 | Tintorería / Lavandería | [N][H] |
| 68 | Plomería / Electricista (con taller) | [N] |
| 69 | Jardinería / Vivero | [N][H] |
| 70 | Limpieza a domicilio | [N] |
| 71 | Carpintería / Tapicería | [N][H] |

#### Cluster `events` — Eventos y Creativos · 6 chips

| ID | Label | Tag |
|----|-------|-----|
| 72 | Renta de mobiliario para eventos | [N] |
| 73 | Salón de fiestas / Banquetes | [N][H] |
| 74 | Fotografía / Estudio fotográfico | [N][H] |
| 75 | Floristería y decoración de eventos | [N][H] |
| 76 | Estudio de grabación / DJ | [N] |
| 77 | Diseño gráfico / Imprenta | [N][H] |

#### Cluster `professional` — Profesionales Independientes · 5 chips

| ID | Label | Tag |
|----|-------|-----|
| 78 | Contador / Despacho contable | [N] |
| 79 | Asesoría legal / Notaría | [N] |
| 80 | Inmobiliaria | [N] |
| 81 | Agencia de viajes | [N] |
| 82 | Coaching / Consultoría empresarial | [N] |

---

## Macro 3 — Tiendas y Comercios (7 existing + 17 new = 24 total)

Lista plana, sin clusters (cantidad manejable).

| ID | Label | Tag |
|----|-------|-----|
| 10 | Abarrotes / Miscelánea | [E] |
| 11 | Expendio / Depósito de Cerveza | [E] |
| 12 | Refaccionaria / Autopartes | [E] |
| 13 | Ferretería | [E] |
| 14 | Papelería | [E] |
| 15 | Farmacia | [E] |
| 16 | Boutique / Ropa y Calzado | [E] **demo cross-macro** |
| 83 | Tienda de conveniencia / Minisúper | [N] |
| 84 | Vinatería / Cervecería | [N] |
| 85 | Zapatería | [N] |
| 86 | Mascotas / Pet shop | [N] |
| 87 | Regalos y novedades | [N] |
| 88 | Joyería | [N] |
| 89 | Mueblería | [N] |
| 90 | Electrónica y celulares | [N] |
| 91 | Carnicería / Pollería | [N] |
| 92 | Frutería / Verdulería | [N] |
| 93 | Tortillería | [N] |
| 94 | Semillas / Cremería | [N] |
| 95 | Mercería | [N] |
| 96 | Florería | [N] |
| 97 | Juguetería | [N] |
| 98 | Tienda naturista | [N] |
| 99 | Tienda deportiva | [N] |

---

## Macro 2 — Comida Rápida y Cafés (6 existing + 12 new = 18 total)

| ID | Label | Tag |
|----|-------|-----|
| 4 | Taquería | [E] |
| 5 | Dogos | [E] |
| 6 | Hamburguesas | [E] |
| 7 | Cafetería | [E] |
| 8 | Paletería / Nevería | [E] |
| 9 | Panadería / Repostería | [E] |
| 112 | Pizzería express / Slice | [N] |
| 113 | Tortas y lonches | [N] |
| 114 | Antojitos mexicanos | [N] |
| 115 | Juguería / Smoothies | [N] |
| 116 | Crepería / Wafflería | [N] |
| 117 | Pollo rostizado / Asadero | [N] |
| 118 | Food truck | [N] |
| 119 | Sushi express / Rolls | [N] |
| 120 | Bubble tea / Boba | [N] |
| 121 | Donas / Postres | [N] |
| 122 | Comida coreana / Asiática rápida | [N] |
| 123 | Açaí / Bowls saludables | [N] |

---

## Macro 1 — Restaurantes y Bares (3 existing + 12 new = 15 total)

| ID | Label | Tag |
|----|-------|-----|
| 1 | Restaurante | [E] |
| 2 | Bar / Cantina | [E] |
| 3 | Sports Bar / Wings | [E] |
| 100 | Marisquería | [N] |
| 101 | Taquería formal (con mesas) | [N] |
| 102 | Parrilla / Asador / Carnes | [N] |
| 103 | Pozolería / Birriería | [N] |
| 104 | Cocina económica / Fonda | [N] |
| 105 | Restaurante italiano / Pizzería de mesa | [N] |
| 106 | Restaurante japonés / Sushi | [N] |
| 107 | Restaurante internacional | [N] |
| 108 | Buffet | [N] |
| 109 | Bar de cocteles / Mixología | [N] |
| 110 | Pulquería / Mezcalería | [N] |
| 111 | Cervecería artesanal / Taproom | [N] |

---

## "Otra" (synthetic, FE-only)

Cada macro mantiene el chip "Otra" que NO consume un ID del catálogo — es
un sentinel FE-only (`OTRA_SUB_ID = -1`) que mapea a
`customGiroDescription` en el payload `UpdateBusinessGiroRequest`. Sin cambio.

---

## Cross-macro hybrid — comportamiento UX

Cuando la persona elige macro primario **Servicios** y marca sub-giros como
"Salón de uñas" (24), aparece **debajo** una sección colapsable:

> ¿También vendes productos?

Que muestra chips del macro **Tiendas y Comercios** (los 24 sub-giros de
arriba). Marcar p.ej. "Boutique / Ropa y Calzado" (16) agrega el ID 16
al array `subGiroIds`. El backend ya acepta cross-macro sin cambios.

> Decisión: por ahora **solo Tiendas y Comercios** como cross-macro (caso típico
> servicio+producto). Cross con Restaurantes/Comida Rápida es nicho — se puede
> abrir después.
