# PROMPT — POS API · Sub-giro taxonomy expansion + cross-macro acceptance

> Pegar en la ventana de VS Code con Claude Code del repo del backend (POS API).
> Workflow: **audita primero, propone, espera confirmación, luego ejecuta** —
> no implementar nada hasta que el usuario apruebe el plan.

---

## CONTEXT

Fino is a Mexican POS SaaS for SMB (food trucks, fondas, salones, talleres,
abarrotes, etc.). The frontend onboarding wizard asks the merchant to pick ONE
**macro category** (1 of 4) and then check applicable **sub-giros** (N:M). The
catalog is hosted in `BusinessTypeCatalog` (sequential 1-based IDs); the join
table is `BusinessGiro`; the public endpoints are `PUT /business/giro` and
`GET /business/giro` with `subGiroIds: BusinessTypeId[]`.

The current 20 sub-giros are insufficient for the Mexican SMB reality. A real
upcoming demo: a merchant who does **nail services (manicura/uñas)** AND
**sells boutique-style clothing and accessories** (services+retail hybrid,
extremely common in Mexico). She fits **no** current sub-giro cleanly.

Frontend research (SCIAN INEGI + competitor analysis Square / Loyverse / Toast /
Clip / Shopify POS LATAM) produced an expanded taxonomy of ~120 sub-giros across
the 4 macros, with **24 of the new Services sub-giros being hybrid services+retail
by default** in Mexico (salones que venden producto, vets con alimento, talleres
con refacciones, ópticas con armazones, etc.).

The frontend will adopt **Option 1 from the research**: catalog/POS is universal
by design (UnlimitedProducts feature is in all 4 macros' GIRO_FEATURE_MAP) and
the wizard will allow the merchant to multi-check sub-giros **across macros**
(e.g. primary `Services` + a `Retail` sub-giro like Boutique). No "are you a
hybrid?" question, no `-with-products` parallel labels.

---

## CURRENT STATE (verify against your code first)

Frontend canonical sources of truth (in the FE repo):

- `src/app/core/enums/config.enum.ts` — `BusinessTypeId` enum (IDs 1-20),
  `BUSINESS_TYPE_LABELS`, `MacroCategoryCode` (1=FoodBeverage, 2=QuickService,
  3=Retail, 4=Services), `SubCategoryType` derivation.
- `src/app/core/enums/feature-key.enum.ts` — `GIRO_FEATURE_MAP`, including
  `UnlimitedProducts` universal across all 4 macros.
- `src/app/core/models/business-giro.model.ts` — `UpdateBusinessGiroRequest` /
  `BusinessGiroResponse` (`primaryMacroCategoryId` + `subGiroIds[]`).

Backend code comment (in `BusinessTypeId` enum) reads:

> *"IDs are 1-based and contiguous; do not insert new entries without a
> coordinated backend migration."*

This prompt **is** that coordinated migration ask.

---

## REQUEST

### A. Seed expansion — add ~101 new sub-giros (IDs 21-121, sequential, contiguous)

Existing 1-20 stay **byte-identical** (label, macro mapping, ordinals). New
entries append after id 20. Idempotent migration (re-running does not duplicate).

#### Macro 4 — Servicios Especializados (62 new entries, IDs 21-82)

Grouped by cluster for FE UX (cluster name is FE-only — backend stores only
the ID + label + primaryMacroCategoryId).

| ID | Slug | Label | Macro | Notes |
|----|------|-------|-------|-------|
| 21 | SalonBelleza | Salón de belleza | 4 | high-frequency, hybrid (vende productos) |
| 22 | Peluqueria | Peluquería | 4 | |
| 23 | Barberia | Barbería | 4 | hybrid |
| 24 | SalonUnas | Salón de uñas / Manicura y pedicura | 4 | **DEMO CRITICAL** — hybrid |
| 25 | EstudioLashes | Estudio de pestañas y cejas | 4 | hybrid |
| 26 | SpaMasajes | Spa / Masajes | 4 | hybrid |
| 27 | Depilacion | Depilación / Cera / Láser | 4 | |
| 28 | Maquillaje | Maquillaje profesional | 4 | hybrid |
| 29 | EstudioTatuajes | Estudio de tatuajes y perforaciones | 4 | |
| 30 | Micropigmentacion | Micropigmentación / PMU | 4 | |
| 31 | Bronceado | Bronceado / Sunless | 4 | |
| 32 | Dentista | Dentista / Consultorio dental | 4 | hybrid |
| 33 | Nutriologia | Nutriología | 4 | hybrid (suplementos) |
| 34 | Psicologia | Psicología / Terapia | 4 | |
| 35 | Fisioterapia | Fisioterapia / Rehabilitación | 4 | |
| 36 | Optica | Optometría / Óptica | 4 | hybrid (armazones, lentes) |
| 37 | Quiropractico | Quiropráctico | 4 | |
| 38 | Podologia | Podología | 4 | |
| 39 | MedicinaAlternativa | Acupuntura / Medicina alternativa | 4 | |
| 40 | HojalateriaPintura | Hojalatería y pintura | 4 | |
| 41 | Vulcanizadora | Vulcanizadora / Llantera | 4 | hybrid |
| 42 | AutoLavado | Auto lavado / Detailing | 4 | hybrid (ceras, fragancias) |
| 43 | ElectricoAuto | Servicio eléctrico automotriz | 4 | |
| 44 | VerificacionAfinacion | Verificación / Afinación | 4 | |
| 45 | TallerMotos | Taller de motos | 4 | hybrid |
| 46 | Veterinaria | Veterinaria / Clínica veterinaria | 4 | hybrid (alimento, accesorios) |
| 47 | EsteticaCanina | Estética canina / Pet grooming | 4 | hybrid |
| 48 | PensionMascotas | Pensión / Guardería de mascotas | 4 | |
| 49 | AdiestramientoCanino | Adiestramiento canino | 4 | |
| 50 | ReparacionCelulares | Reparación de celulares | 4 | hybrid (fundas, micas) |
| 51 | ReparacionComputadoras | Reparación de computadoras / Soporte técnico | 4 | hybrid |
| 52 | Cyber | Cyber / Renta de equipo e impresiones | 4 | hybrid |
| 53 | ReparacionElectrodomesticos | Reparación de electrodomésticos | 4 | |
| 54 | ReparacionCalzado | Reparación de calzado | 4 | |
| 55 | Sastreria | Sastrería / Arreglos de ropa | 4 | |
| 56 | Cerrajeria | Cerrajería | 4 | |
| 57 | JoyeriaReparacion | Joyería y reparación | 4 | hybrid |
| 58 | YogaPilates | Estudio de yoga / pilates | 4 | hybrid |
| 59 | AcademiaBaile | Academia de baile / Zumba | 4 | |
| 60 | ArtesMarciales | Artes marciales / Box | 4 | |
| 61 | Spinning | Spinning | 4 | |
| 62 | EscuelaIdiomas | Escuela de idiomas | 4 | |
| 63 | TutoriasRegularizacion | Regularización / Tutorías escolares | 4 | |
| 64 | AcademiaMusica | Academia de música | 4 | hybrid (accesorios) |
| 65 | CursosTalleres | Cursos y talleres (manualidades, repostería) | 4 | hybrid |
| 66 | Guarderia | Guardería / Estancia infantil | 4 | |
| 67 | TintoreriaLavanderia | Tintorería / Lavandería | 4 | hybrid |
| 68 | PlomeriaElectricista | Plomería / Electricista (con taller) | 4 | |
| 69 | JardineriaVivero | Jardinería / Vivero | 4 | hybrid |
| 70 | LimpiezaDomicilio | Limpieza a domicilio | 4 | |
| 71 | CarpinteriaTapiceria | Carpintería / Tapicería | 4 | hybrid |
| 72 | RentaMobiliarioEventos | Renta de mobiliario para eventos | 4 | |
| 73 | SalonFiestasBanquetes | Salón de fiestas / Banquetes | 4 | hybrid |
| 74 | EstudioFotografico | Fotografía / Estudio fotográfico | 4 | hybrid |
| 75 | FloristeriaDecoracion | Floristería y decoración de eventos | 4 | hybrid |
| 76 | EstudioGrabacionDj | Estudio de grabación / DJ | 4 | |
| 77 | DisenoImprenta | Diseño gráfico / Imprenta | 4 | hybrid |
| 78 | DespachoContable | Contador / Despacho contable | 4 | |
| 79 | AsesoriaLegalNotaria | Asesoría legal / Notaría | 4 | |
| 80 | Inmobiliaria | Inmobiliaria | 4 | |
| 81 | AgenciaViajes | Agencia de viajes | 4 | |
| 82 | CoachingConsultoria | Coaching / Consultoría empresarial | 4 | |

#### Macro 3 — Tiendas y Comercios (17 new entries, IDs 83-99)

| ID | Slug | Label | Macro |
|----|------|-------|-------|
| 83 | TiendaConveniencia | Tienda de conveniencia / Minisúper | 3 |
| 84 | Vinateria | Vinatería / Cervecería | 3 |
| 85 | Zapateria | Zapatería | 3 |
| 86 | MascotasPetShop | Mascotas / Pet shop | 3 |
| 87 | RegalosNovedades | Regalos y novedades | 3 |
| 88 | Joyeria | Joyería | 3 |
| 89 | Muebleria | Mueblería | 3 |
| 90 | ElectronicaCelulares | Electrónica y celulares | 3 |
| 91 | CarniceriaPolleria | Carnicería / Pollería | 3 |
| 92 | FruteriaVerdureria | Frutería / Verdulería | 3 |
| 93 | Tortilleria | Tortillería | 3 |
| 94 | SemillasCremeria | Semillas / Cremería | 3 |
| 95 | Merceria | Mercería | 3 |
| 96 | Floreria | Florería | 3 |
| 97 | Jugueteria | Juguetería | 3 |
| 98 | TiendaNaturista | Tienda naturista | 3 |
| 99 | TiendaDeportiva | Tienda deportiva | 3 |

#### Macro 1 — Restaurantes y Bares (11 new entries, IDs 100-110)

| ID | Slug | Label | Macro |
|----|------|-------|-------|
| 100 | Marisqueria | Marisquería | 1 |
| 101 | TaqueriaFormal | Taquería formal (con mesas) | 1 |
| 102 | ParrillaAsador | Parrilla / Asador / Carnes | 1 |
| 103 | PozoleriaBirreria | Pozolería / Birriería | 1 |
| 104 | CocinaEconomicaFonda | Cocina económica / Fonda | 1 |
| 105 | RestauranteItaliano | Restaurante italiano / Pizzería de mesa | 1 |
| 106 | RestauranteJapones | Restaurante japonés / Sushi | 1 |
| 107 | RestauranteInternacional | Restaurante internacional | 1 |
| 108 | Buffet | Buffet | 1 |
| 109 | BarCocteles | Bar de cocteles / Mixología | 1 |
| 110 | PulqueriaMezcaleria | Pulquería / Mezcalería | 1 |
| 111 | CerveceriaArtesanal | Cervecería artesanal / Taproom | 1 |

#### Macro 2 — Comida Rápida y Cafés (11 new entries, IDs 112-122)

(`Hamburguesas`=6 and `Dogos`=5 already exist — not duplicated. `Cafetería`=7
covers cafetería; `Panadería`=9 covers panadería/pastelería.)

| ID | Slug | Label | Macro |
|----|------|-------|-------|
| 112 | PizzeriaExpress | Pizzería express / Slice | 2 |
| 113 | TortasLonches | Tortas y lonches | 2 |
| 114 | AntojitosMexicanos | Antojitos mexicanos (callejeros) | 2 |
| 115 | JugueriaSmoothies | Juguería / Smoothies | 2 |
| 116 | CrepasWaffles | Crepería / Wafflería | 2 |
| 117 | PolloRostizado | Pollo rostizado / Asadero | 2 |
| 118 | FoodTruck | Food truck | 2 |
| 119 | SushiExpress | Sushi express / Rolls | 2 |
| 120 | BobaTeaBubble | Bubble tea / Boba | 2 |
| 121 | DonasPostres | Donas / Postres | 2 |
| 122 | ComidaAsiaticaRapida | Comida coreana / Asiática rápida | 2 |
| 123 | AcaiBowls | Açaí / Bowls saludables | 2 |

> Re-totals: Services 62 + Retail 17 + Restaurants 12 + QuickService 12 =
> **103 new entries**, IDs 21-123. Confirm the count when you generate the
> seed; the table above is the source of truth.

### B. Validator audit — cross-macro `subGiroIds`

Verify whether `PUT /business/giro` (and the backing repository / domain
layer) currently enforces `subGiroIds[i].primaryMacroCategoryId ==
request.primaryMacroCategoryId`. The frontend will start sending mixed-macro
selections (e.g. primary=Services with a Retail sub-giro like Boutique). If
the validator is restrictive:

1. Relax to accept any valid `BusinessTypeId` regardless of its declared
   primary macro.
2. Preserve the existing FK that each id exists in `BusinessTypeCatalog`.
3. No new domain rule is introduced — the join table already supports the
   cross-macro shape.

If the validator is already permissive, document that in the audit and skip
the relax step.

### C. Migration safety

- Idempotent (`IF NOT EXISTS` per id).
- Existing 1-20 untouched (no label edits, no macro reassignment).
- Sequential IDs 21-123 (contiguous, no gaps).
- Verify FE-side comment block (`config.enum.ts` BusinessTypeId enum, IDs
  1-based and contiguous) stays accurate after the migration.

---

## OPEN QUESTIONS for the backend

1. **Validator scope:** is there a check constraint or domain validator
   forcing `subGiroIds` to share `primaryMacroCategoryId`? Confirm + relax if so.
2. **Feature gating:** are any `FeatureKey` activations keyed on specific
   `BusinessTypeId` values (beyond the FE's `subCategoryOfBusinessType` derivation,
   which only maps `Gimnasio → Gym`)? If yes, document which new IDs should
   activate which features (e.g. `SalonUnas` → maybe `LoyaltyCrm` default-on?
   `Veterinaria` → `RecipeInventory` for ingredient-style stock?).
3. **Pricing groups:** does `PRICING_GROUP_BY_MACRO` need adjusting? Sub-giros
   that change pricing should be flagged here, not silently inherit macro defaults.
4. **Catalog endpoints:** does `GET /catalog/business-types` (or equivalent)
   page the response? If it returns the full list and the FE caches it, no
   change needed beyond growing the payload.
5. **Existing tenants with old IDs:** any consumer that hardcodes the old 1-20
   range (e.g. analytics, reports, JWT claims)? Audit grep before seeding.
6. **Cluster metadata:** the FE wants to group sub-giros into UX clusters
   (Belleza, Salud, Automotriz, etc.) — should this live in the catalog (new
   `clusterCode` column) or stay FE-only? Backend recommendation requested.

---

## ACCEPTANCE CRITERIA

- 103 new entries seeded with IDs 21-123, sequential, contiguous.
- Existing 1-20 byte-identical (label, macro, ordinal).
- `PUT /business/giro` accepts `subGiroIds` from any macro (verified via
  integration test: primary=4 + subGiroId=16 Boutique).
- `GET /business/giro` returns cross-macro selection intact.
- Migration idempotent (re-run does not duplicate).
- Audit report covers the 6 open questions above.

---

## VERIFICATION

```bash
# After migration:
# 1. Count check
psql -c "SELECT COUNT(*) FROM business_type_catalog;"   # expect 123

# 2. Existing 1-20 unchanged
psql -c "SELECT id, label, primary_macro_category_id FROM business_type_catalog WHERE id <= 20 ORDER BY id;"

# 3. Cross-macro acceptance contract
curl -X PUT $API/business/giro -H "Content-Type: application/json" \
  -d '{"primaryMacroCategoryId":4,"subGiroIds":[24,16]}'   # Services primary + Boutique cross-macro
# Expect: 200 OK
```

---

## SOURCES (research basis)

- INEGI SCIAN 2023 — sector 81 (Otros servicios), subsector 812 (Servicios personales)
  · <https://www.inegi.org.mx/scian/>
- Data México — Personal Care Services
  · <https://www.economia.gob.mx/datamexico/es/profile/industry/personal-care-services>
- SEDECO CDMX / SIAPEM — Catálogo de Giros de Bajo Impacto
  · <https://www.sedeco.cdmx.gob.mx/storage/app/media/Siapem/catalogo-de-giros-comerciales-y-de-servicios-de-bajo-impacto-del-siapem.pdf>
- AgendaPro México — Categorías por giro
  · <https://ayuda.agendapro.com/es/articles/8412031>
- Square for Salons / Appointments — unified retail+services
  · <https://squareup.com/us/en/beauty/salons>
- Loyverse — agnostic items+categories model
  · <https://loyverse.com/>
- Toast — explicit Hybrid POS for retail + food service
  · <https://pos.toasttab.com/restaurant-pos/hybrid-restaurant>
- Clip México — onboarding minimalist payment-first model
  · <https://onboarding.clip.mx/>

---

## WORKFLOW REQUEST

1. **Audit** the current state against this prompt — verify counts, validator
   behavior, FK constraints, feature gating, pricing implications.
2. **Propose** the migration + validator change + answers to the 6 open
   questions. Do NOT execute yet.
3. **Wait** for the user to approve the plan.
4. **Execute** in a single atomic migration (or one migration per concern —
   your call, justify).
5. **Report** with verification queries and the answers to the open questions.

No time/day estimates anywhere. Bound by file-scope + verification gate.
