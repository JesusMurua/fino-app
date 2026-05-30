import { Injectable, computed, effect, inject, signal } from '@angular/core';

import { CashRegisterService } from './cash-register.service';
import { PrinterService } from './printer.service';
import { ProductService } from './product.service';
import { TenantContextService } from './tenant-context.service';

/**
 * Single step of the "Getting Started" checklist rendered on the
 * dashboard. `isOptional` items are excluded from `progressPercentage`
 * and from `isChecklistComplete`, so a tenant can reach 100% even
 * without completing them (useful for hardware peripherals that not
 * every giro needs).
 */
export interface ChecklistItem {
  id: string;
  title: string;
  description: string;
  ctaText: string;
  /** Absolute router path, e.g. `/admin/products` */
  ctaLink: string;
  /** PrimeIcons class, e.g. `pi pi-tag` */
  icon: string;
  isCompleted: boolean;
  isOptional?: boolean;
}

/**
 * localStorage key used to remember that the tenant has opened at least
 * one cash register session. We need a sticky flag because
 * `CashRegisterService.hasOpenSession()` flips back to `false` every time
 * the current shift is closed — without pinning we would uncheck the
 * step right after the tenant's first successful close.
 */
const FIRST_SESSION_OPENED_KEY = 'fino.checklist.firstSessionOpened';
const HIDDEN_BY_USER_KEY = 'fino.checklist.hidden';

/**
 * Reactive source of truth for the FTUE checklist shown on the dashboard.
 *
 * Every item is a `computed` slice over signals already exposed by the
 * existing services (product catalog, printer state, cash register
 * status, tenant context), so the checklist updates in real time as the
 * user performs the actions — no manual refresh required.
 */
@Injectable({ providedIn: 'root' })
export class OnboardingChecklistService {

  //#region Injections

  private readonly tenantContext = inject(TenantContextService);
  private readonly productService = inject(ProductService);
  private readonly printerService = inject(PrinterService);
  private readonly cashRegisterService = inject(CashRegisterService);

  //#endregion

  //#region Sticky state

  /** Hydrated from localStorage so page refreshes don't uncheck the step. */
  private readonly _firstSessionOpened = signal<boolean>(
    localStorage.getItem(FIRST_SESSION_OPENED_KEY) === 'true',
  );

  /**
   * Sticky dismiss flag — the tenant clicked "Ocultar guía" and doesn't
   * want the checklist block anymore. Separate from completion so the
   * dashboard can distinguish "all done" from "user hid it mid-setup".
   */
  readonly hiddenByUser = signal<boolean>(
    localStorage.getItem(HIDDEN_BY_USER_KEY) === 'true',
  );

  //#endregion

  //#region Lifecycle

  constructor() {
    // Pin the "first session opened" flag the moment an open session is
    // observed. Guarded by `!already-pinned` so we don't write to
    // localStorage on every signal read.
    effect(() => {
      if (this.cashRegisterService.hasOpenSession() && !this._firstSessionOpened()) {
        this._firstSessionOpened.set(true);
        localStorage.setItem(FIRST_SESSION_OPENED_KEY, 'true');
      }
    }, { allowSignalWrites: true });
  }

  //#endregion

  //#region Public API

  /**
   * Full list of checklist items with live completion state. Consumers
   * read this signal directly — it recomputes whenever any upstream
   * signal changes (products added, printer connected, shift opened).
   */
  readonly checklist = computed<ChecklistItem[]>(() => [
    {
      id: 'business',
      title: 'Configura tu negocio',
      description: 'Datos del negocio guardados durante el registro.',
      ctaText: 'Ver configuración',
      ctaLink: '/admin/settings',
      icon: 'pi pi-building',
      isCompleted: this.tenantContext.currentMacro() !== null,
    },
    {
      // Inserted before "products" because the cart preview math and
      // the POS guard both depend on this. A tenant CANNOT operate
      // without a default tax (`taxConfigGuard` blocks `/pos`, `/tables`,
      // `/kiosk` until this is set). See `project_tax_authority.md`.
      id: 'taxes',
      title: 'Configura tus impuestos',
      description: 'Define el IVA por defecto o si tu negocio es exento. Requisito para operar.',
      ctaText: 'Ir a Configuración Fiscal',
      ctaLink: '/admin/settings',
      icon: 'pi pi-percentage',
      isCompleted: this.tenantContext.business()?.defaultTaxId != null,
    },
    {
      id: 'products',
      title: 'Agrega tu primer producto',
      description: 'El catálogo es el corazón de tus ventas. Sin productos no puedes cobrar.',
      ctaText: 'Ir a Catálogo',
      ctaLink: '/admin/products',
      icon: 'pi pi-tag',
      isCompleted: this.productService.products().length > 0,
    },
    {
      id: 'hardware',
      title: 'Conecta tu hardware',
      description: 'Impresora térmica, lector de código de barras o cajón de dinero.',
      ctaText: 'Configurar impresora',
      ctaLink: '/admin/settings',
      icon: 'pi pi-print',
      isCompleted: this.printerService.printerConnected(),
      isOptional: true,
    },
    {
      id: 'register',
      title: 'Abre tu primera caja',
      description: 'Inicia un turno para empezar a registrar ventas y hacer cortes.',
      ctaText: 'Abrir turno',
      ctaLink: '/admin/registers',
      icon: 'pi pi-wallet',
      isCompleted: this.cashRegisterService.hasOpenSession() || this._firstSessionOpened(),
    },
  ]);

  /** Required steps only — excludes items marked `isOptional: true`. */
  readonly requiredSteps = computed(() =>
    this.checklist().filter(item => !item.isOptional),
  );

  /** 0–100 integer percentage of required steps completed. */
  readonly progressPercentage = computed(() => {
    const required = this.requiredSteps();
    if (required.length === 0) return 100;
    const done = required.filter(item => item.isCompleted).length;
    return Math.round((done / required.length) * 100);
  });

  /** True when every required step is done (optional steps ignored). */
  readonly isChecklistComplete = computed(() =>
    this.requiredSteps().every(item => item.isCompleted),
  );

  /**
   * Master visibility flag for the dashboard FTUE block. Hidden once the
   * tenant finishes all required steps OR explicitly dismisses it.
   */
  readonly showChecklist = computed(() =>
    !this.isChecklistComplete() && !this.hiddenByUser(),
  );

  /** `<done> / <total>` string used by the progress bar label. */
  readonly progressLabel = computed(() => {
    const required = this.requiredSteps();
    const done = required.filter(item => item.isCompleted).length;
    return `${done} / ${required.length} pasos`;
  });

  /**
   * Persists the dismiss decision and updates the reactive flag so the
   * FTUE block disappears immediately without a page refresh.
   */
  dismissChecklist(): void {
    localStorage.setItem(HIDDEN_BY_USER_KEY, 'true');
    this.hiddenByUser.set(true);
  }

  /**
   * Clears the sticky dismiss flag and re-exposes the FTUE block. Called
   * from the "Ver guía de inicio" affordance on the legacy dashboard so
   * a user who hid the guide prematurely can bring it back.
   */
  resetDismiss(): void {
    localStorage.removeItem(HIDDEN_BY_USER_KEY);
    this.hiddenByUser.set(false);
  }

  //#endregion

}
