import { Category, Product } from '../../../core/models';

/** Seed categories — replace with API data when backend is ready */
export const SEED_CATEGORIES: Category[] = [
  { id: 1, name: 'Comida',     icon: 'pi-box',       sortOrder: 1, isActive: true },
  { id: 2, name: 'Antojitos',  icon: 'pi-star',      sortOrder: 2, isActive: true },
  { id: 3, name: 'Bebidas',    icon: 'pi-filter',    sortOrder: 3, isActive: true },
  { id: 4, name: 'Postres',    icon: 'pi-heart',     sortOrder: 4, isActive: true },
];

/** Seed products — all prices in cents (MXN) */
export const SEED_PRODUCTS: Product[] = [
  // Comida
  {
    id: 1, name: 'Torta de Milanesa', priceCents: 8500, categoryId: 1,
    isAvailable: true,
    sizes: [
      { id: 1, label: 'Chica',  priceDeltaCents:     0 },
      { id: 2, label: 'Grande', priceDeltaCents: 2000 },
    ],
    modifierGroups: [
      {
        id: 1, name: 'Extras', sortOrder: 0,
        isRequired: false, minSelectable: 0, maxSelectable: 0,
        extras: [
          { id: 1, label: 'Aguacate',  priceCents: 1000 },
          { id: 2, label: 'Queso',     priceCents:  500 },
          { id: 3, label: 'Jalapeños', priceCents:    0 },
        ],
      },
    ],
  },
  {
    id: 2, name: 'Quesadilla', priceCents: 5500, categoryId: 1,
    isAvailable: true,
    sizes: [],
    modifierGroups: [
      {
        id: 2, name: 'Extras', sortOrder: 0,
        isRequired: false, minSelectable: 0, maxSelectable: 0,
        extras: [
          { id: 4, label: 'Flor de calabaza', priceCents: 1500 },
          { id: 5, label: 'Huitlacoche',      priceCents: 2000 },
          { id: 6, label: 'Chicharrón',       priceCents: 1000 },
        ],
      },
    ],
  },
  {
    id: 3, name: 'Enchiladas Verdes', priceCents: 7500, categoryId: 1,
    isAvailable: true, sizes: [],
  },
  {
    id: 4, name: 'Pozole Rojo', priceCents: 9000, categoryId: 1,
    isAvailable: true,
    sizes: [
      { id: 3, label: 'Chico',  priceDeltaCents:     0 },
      { id: 4, label: 'Mediano', priceDeltaCents: 3000 },
      { id: 5, label: 'Grande',  priceDeltaCents: 6000 },
    ],
    modifierGroups: [
      {
        id: 3, name: 'Extras', sortOrder: 0,
        isRequired: false, minSelectable: 0, maxSelectable: 0,
        extras: [
          { id: 7, label: 'Extra chile', priceCents:    0 },
          { id: 8, label: 'Tostadas',    priceCents:  500 },
        ],
      },
    ],
  },

  // Antojitos
  {
    id: 5, name: 'Taco de Canasta', priceCents: 2000, categoryId: 2,
    isAvailable: true, sizes: [],
  },
  {
    id: 6, name: 'Gordita', priceCents: 3500, categoryId: 2,
    isAvailable: true,
    sizes: [],
    modifierGroups: [
      {
        id: 4, name: 'Extras', sortOrder: 0,
        isRequired: false, minSelectable: 0, maxSelectable: 0,
        extras: [
          { id: 9,  label: 'Chicharrón prensado', priceCents:    0 },
          { id: 10, label: 'Requesón',            priceCents: 1000 },
          { id: 11, label: 'Picadillo',           priceCents:    0 },
        ],
      },
    ],
  },
  {
    id: 7, name: 'Tostada de Tinga', priceCents: 3000, categoryId: 2,
    isAvailable: true, sizes: [],
  },

  // Bebidas
  {
    id: 8, name: 'Agua de Jamaica', priceCents: 2500, categoryId: 3,
    isAvailable: true,
    sizes: [
      { id: 6, label: 'Chico',  priceDeltaCents:    0 },
      { id: 7, label: 'Grande', priceDeltaCents: 500 },
    ],
  },
  {
    id: 9, name: 'Café de Olla', priceCents: 3000, categoryId: 3,
    isAvailable: true, sizes: [],
  },
  {
    id: 10, name: 'Refresco', priceCents: 2500, categoryId: 3,
    isAvailable: true, sizes: [],
  },

  // Postres
  {
    id: 11, name: 'Arroz con Leche', priceCents: 4000, categoryId: 4,
    isAvailable: true, sizes: [],
  },
  {
    id: 12, name: 'Gelatina', priceCents: 2500, categoryId: 4,
    isAvailable: true, sizes: [],
  },
];
