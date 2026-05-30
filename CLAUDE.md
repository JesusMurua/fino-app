# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.
Always read the `.claude/` folder standards before implementing anything.

---

## Project Overview

**Fino** — Plataforma de gestión y operación para negocios.

Touch-first web platform for small businesses in Mexico — fondas, food trucks,
cafeterías, abarrotes, refaccionarias, estéticas, talleres, gimnasios.
Point-of-sale, reception, and vertical modules.

This repository (`fino-app`) is the Angular 18 frontend. Sibling repos:
`fino-api` (.NET backend), `fino-bridge` (Windows hardware service),
`fino-landing` (public landing + registration), `fino-admin` (super admin).

**Core philosophy:** Simple, fast, offline-first. Show products → add to cart → charge.
No unnecessary complexity. Features are added incrementally based on real user feedback.

**Target users:** Small business owners and their staff. Non-technical users.
Prioritize large touch targets, clear visual hierarchy, and forgiving UX.

---

## Standards & Guidelines

All coding decisions must follow these documents in order of precedence:

| File | Purpose |
|------|---------|
| `.claude/response-guidelines.md` | How to analyze, confirm, and implement |
| `.claude/coding-standards.md` | Angular 18 patterns, observables, regions |
| `.claude/html-standards.md` | HTML structure, PrimeNG components, forms |
| `.claude/dotnet-api-standards.md` | .NET 9 API, repositories, services |

> **Language rule:** All code, variables, methods, comments, and JSDoc in **English**.
> Explanations and chat responses in **Spanish**.

---

## Tech Stack

### Frontend
- **Angular 18** (standalone components, signals)
- **PrimeNG 17** — UI component library (replaces Angular Material)
- **PrimeFlex** — CSS utility grid (replaces FlexLayout)
- **Dexie.js** — IndexedDB wrapper for offline-first storage
- **RxJS** — Reactive state management
- **PWA** — Service Worker for offline support and installability

### Backend
- **.NET 9** — REST API
- **Entity Framework Core** — ORM
- **PostgreSQL** — Database (relational tax engine + multi-tenant schemas)
- **JWT** — Authentication

### Infrastructure
- **Azure Static Web Apps** — Frontend hosting
- **Azure App Service B1** — Backend hosting (~$13 USD/month)
- **PostgreSQL** — Database (managed)

---

## Project Structure

```
src/
├── app/
│   ├── core/
│   │   ├── models/          # TypeScript interfaces and classes
│   │   ├── services/        # Singleton services (cart, products, sync)
│   │   └── guards/          # Route guards (auth)
│   ├── modules/
│   │   └── pos/             # Main POS feature module (lazy-loaded)
│   │       ├── components/
│   │       │   ├── unified-pos/         # Chameleon shell (Retail/Counter/Quick/Services)
│   │       │   ├── keypad-stage/        # Free-form calculator stage of the chameleon
│   │       │   ├── product-grid-inner/  # Catalog stage of the chameleon (no shell)
│   │       │   ├── product-grid/        # Legacy full shell — used by RestaurantHub takeout
│   │       │   ├── product-card/        # Single product tile
│   │       │   ├── product-detail/      # Size + extras customization
│   │       │   ├── cart-panel/          # Shared order sidebar (F&B branched, opt-in glass)
│   │       │   ├── quick-pay/           # Inline cash dialog for non-F&B verticals
│   │       │   └── checkout/            # Full payment page (F&B flow)
│   │       ├── pages/
│   │       │   └── restaurant-hub/      # F&B omni-channel shell (tables/takeout/delivery)
│   │       └── pos.routes.ts
│   ├── shared/
│   │   └── components/      # Reusable UI components
│   └── app.routes.ts
├── environments/
└── styles/
    └── _variables.scss      # Design tokens
```

---

## Architecture Decisions

### Offline-First (Critical)
All orders must work without internet. Flow:

```
User action → IndexedDB (Dexie.js) → UI update
                    ↓
            Background Sync Service
                    ↓
            Backend API (when online)
```

- Products/catalog: cached in IndexedDB on first load
- Orders: saved locally first, synced when connection is available
- Never block the UI waiting for network

### State Management
No NgRx. Keep it simple:
- **Cart state:** `CartService` with `signal<CartItem[]>` (single source of truth, persisted to IndexedDB)
- **Product catalog:** `ProductService` with signals
- **Sync state:** `SyncService` tracks pending offline orders
- **Auth state:** `AuthService` with JWT in localStorage
- **POS view mode:** `PosViewModeService` toggles keypad ↔ grid in the Chameleon shell

### POS Shells (Bounded Contexts)
The POS module contains **two distinct shells by design** — never fuse them:
- **Fast-Lane POS** at `/pos/sell` (`UnifiedPosComponent`) — Chameleon for **Retail / Counter / Quick / Services**. Single transient cart, view mode toggles between keypad calculator and product grid.
- **Full-Service F&B** at `/pos` (`RestaurantHubComponent`) — F&B omni-channel hub with mesas / takeout / delivery. N concurrent open orders with kitchen lifecycle.

Rationale and invariants documented in [docs/AUDIT-052-restaurant-hub-chameleon.md](docs/AUDIT-052-restaurant-hub-chameleon.md).

### Component Pattern
All new components must be **standalone**:
```typescript
@Component({
  selector: 'app-product-card',
  standalone: true,
  imports: [CommonModule, PrimeNGModule],
  templateUrl: './product-card.component.html',
  styleUrl: './product-card.component.scss'
})
```

### Signals vs Observables
- Use **signals** for local component state
- Use **observables** (BehaviorSubject) for shared service state
- Use **async pipe** in templates when possible

---

## Development Commands

```bash
npm start           # Dev server at http://localhost:4200/ with hot reload
npm run build       # Production build to dist/
npm test            # Unit tests via Karma/Jasmine
npm run lint        # ESLint
```

---

## Key Domain Models

```typescript
// Product shown in the catalog
interface Product {
  id: number;
  name: string;
  price: number;
  categoryId: number;
  imageUrl?: string;
  isAvailable: boolean;
}

// Item added to the cart (with customizations)
interface CartItem {
  id: string;              // UUID generated client-side
  product: Product;
  quantity: number;
  size?: ProductSize;
  extras: ProductExtra[];
  unitPrice: number;       // Base price + size + extras
  totalPrice: number;      // unitPrice × quantity
  notes?: string;
}

// A completed order
interface Order {
  id: string;              // UUID generated client-side
  items: CartItem[];
  total: number;
  paymentMethod: 'cash' | 'card';
  createdAt: Date;
  syncedAt?: Date;         // null = pending sync
  businessId: number;
}
```

---

## POS-Specific Rules

### Touch UX (Non-negotiable)
- Minimum touch target: **64px × 64px** for all interactive elements
- Product cards: minimum **120px × 120px**
- Font sizes: minimum **16px** for body, **20px** for prices
- No hover-only interactions — everything must work on touch

### Cart Logic
- Quantities never go below 1 (remove item instead)
- Total recalculates reactively on every change
- Cart persists in IndexedDB — survives page refresh
- Clear cart only after successful order completion

### Pricing
- Always display prices in MXN with `currency` pipe
- Round totals to 2 decimal places
- Never do floating point math directly — use cents internally

```typescript
// Wrong
total = 10.1 + 20.2; // 30.299999...

// Right  
totalCents = 1010 + 2020; // 3030
total = totalCents / 100;  // 30.30
```

---

## Migration Notes (from Angular 10)

This project is a **full rewrite** of the original Angular 10 POS.
The original code in `src/app/modules/punto-venta/` serves as UX reference only.

**Do NOT carry over:**
- Angular Material (replaced by PrimeNG)
- `@angular/flex-layout` (replaced by PrimeFlex)
- `@syncfusion/ej2-angular-inputs` (replaced by PrimeNG InputNumber)
- Spanish variable/method names in TypeScript
- `debugger` statements
- Hardcoded mock data in services

**DO carry over:**
- Cart logic flow (category → product → detail → cart)
- Size and extras customization UX
- `BehaviorSubject` cart pattern from `CartService`

---

## Design System

Style: modern minimalist (Linear / Notion / Stripe feel)

### Accent color
- Primary: #16A34A (green) — primary buttons, confirmations, totals, success states
- Error / cancel: #DC2626
- Warning: #D97706
- Neutral / secondary: #6B7280

### Spacing scale (8px strict)
8px · 16px · 24px · 32px · 48px · 64px

### Typography
- Headings: font-weight 700, color #111827
- Subheadings: font-weight 500, color #6B7280
- Body: font-weight 400, color #374151
- Prices and totals: font-size min 20px, font-weight 700
- Absolute minimum font-size: 16px

### Containers
- Cards: box-shadow 0 1px 3px rgba(0,0,0,0.1), no border, border-radius 12px
- Modals: border-radius 16px
- No pure black — darkest allowed: #111827

### Touch targets
- All interactive elements: min 64×64px
- Product cards: min 120×120px

---

## Implementation Process

Always follow `.claude/response-guidelines.md`. In summary:

1. **Analyze first** — understand the context before proposing code
2. **Wait for confirmation** — do not implement without explicit approval
3. **Implement only what was requested** — no extra features
4. **Summarize** — explain what was done and ask for feedback

> When in doubt, do less and ask. Never assume scope.

