import { Injectable, computed, inject } from '@angular/core';

import { FeatureKey, MacroCategoryCode, SubCategoryType } from '../enums';
import { AuthService } from './auth.service';
import { CashRegisterService } from './cash-register.service';
import { PrinterService } from './printer.service';
import { ProductService } from './product.service';
import { TenantContextService } from './tenant-context.service';

/**
 * Single suggested step. Each step is derived from the tenant's
 * vertical (macro), plan-enabled features, and the latest snapshot of
 * business state — so the list always reflects what the user has left
 * to do, not a hard-coded checklist.
 *
 * Two consumers:
 *   - Welcome screen renders only `!isCompleted` (the suggestions).
 *   - Dashboard FTUE checklist renders ALL applicable steps with check
 *     marks for the completed ones — same source of truth.
 */
export interface WelcomeStep {
  /** Stable identifier — used as `*ngFor` track key and analytics tag. */
  id: string;
  title: string;
  description: string;
  ctaText: string;
  /** Absolute router path that the CTA navigates to. */
  ctaLink: string;
  /** PrimeIcons class, e.g. `pi pi-tag`. */
  icon: string;
  /**
   * Whether this step is already satisfied. Optional steps with no live
   * signal (e.g. "Configurar KDS") default to `false` and remain visible
   * until the tenant dismisses the checklist or the feature gains a
   * dedicated state hook.
   */
  isCompleted: boolean;
  /**
   * Items marked optional are excluded from the dashboard progress
   * percentage so a tenant can reach 100% without setting up hardware
   * or advanced features. Defaults to `false` (required).
   */
  isOptional?: boolean;
}

/**
 * Computes the full applicable-step list for the current tenant and
 * the filtered "suggestions" view consumed by the Welcome screen.
 *
 * Layered rules of inclusion:
 *   1. Universal steps — apply to every vertical when the corresponding
 *      capability is enabled (CoreHardware, etc.) and the state needs it.
 *   2. Vertical-specific steps — apply only when the macro matches AND
 *      the feature is in the active feature set for the tenant's plan.
 *      A tenant on Free won't see "Activa KDS" because the feature
 *      isn't in their JWT claim, not because we hardcoded a price tier.
 *   3. Optional multi-branch / multi-till — surfaced only when the
 *      feature exists AND the snapshot says the tenant has exactly one
 *      branch / cash register.
 */
@Injectable({ providedIn: 'root' })
export class WelcomeStepsService {

  //#region Injections

  private readonly tenantContext = inject(TenantContextService);
  private readonly authService = inject(AuthService);
  private readonly productService = inject(ProductService);
  private readonly printerService = inject(PrinterService);
  private readonly cashRegisterService = inject(CashRegisterService);

  //#endregion

  //#region Public API

  /**
   * ALL applicable steps for the current tenant — each with its live
   * `isCompleted` flag. Use this for the dashboard FTUE checklist
   * (which renders both done and pending items) or any analytics that
   * needs the full picture.
   */
  readonly allApplicableSteps = computed<WelcomeStep[]>(() => {
    const macro = this.tenantContext.currentMacro();
    if (macro === null) return [];

    const features = this.tenantContext.activeFeatures();
    const business = this.tenantContext.business();
    const snapshot = this.authService.businessSnapshot();
    const products = this.productService.products();
    const printerConnected = this.printerService.printerConnected();
    const hasOpenSession = this.cashRegisterService.hasOpenSession();

    const steps: WelcomeStep[] = [];

    // Universal — apply to every macro.
    steps.push({
      id: 'products',
      title: 'Agrega tu primer producto',
      description: 'El catálogo es el corazón de tus ventas. Sin productos no hay cobro.',
      ctaText: 'Ir al catálogo',
      ctaLink: '/admin/products',
      icon: 'pi pi-tag',
      isCompleted: products.length > 0,
    });

    steps.push({
      id: 'taxes',
      title: 'Configura tus impuestos',
      description: 'Define el IVA por defecto o si eres exento. Necesario para operar.',
      ctaText: 'Configurar impuestos',
      ctaLink: '/admin/settings',
      icon: 'pi pi-percentage',
      isCompleted: business?.defaultTaxId != null,
    });

    if (features.has(FeatureKey.CfdiInvoicing)) {
      steps.push({
        id: 'fiscal',
        title: 'Completa tus datos fiscales',
        description: 'RFC, razón social y régimen para emitir CFDI al momento del cobro.',
        ctaText: 'Completar datos',
        ctaLink: '/admin/settings',
        icon: 'pi pi-file',
        isCompleted: false,
        isOptional: true,
      });
    }

    if (features.has(FeatureKey.CoreHardware)) {
      steps.push({
        id: 'printer',
        title: 'Conecta tu impresora',
        description: 'Imprime tickets directo al cliente o a la cocina. Mejora mucho la experiencia.',
        ctaText: 'Configurar impresora',
        ctaLink: '/admin/settings',
        icon: 'pi pi-print',
        isCompleted: printerConnected,
        isOptional: true,
      });
    }

    steps.push({
      id: 'register',
      title: 'Abre tu primera caja',
      description: 'Inicia un turno para registrar ventas y hacer cortes al cierre.',
      ctaText: 'Abrir turno',
      ctaLink: '/admin/registers',
      icon: 'pi pi-wallet',
      isCompleted: hasOpenSession,
    });

    if ((snapshot?.userCount ?? 1) <= 1) {
      steps.push({
        id: 'team',
        title: 'Suma a tu equipo',
        description: 'Cada cajero o administrador con su propio acceso.',
        ctaText: 'Invitar usuarios',
        ctaLink: '/admin/users',
        icon: 'pi pi-users',
        isCompleted: false,
        isOptional: true,
      });
    }

    // Vertical-specific.
    if (macro === MacroCategoryCode.FoodBeverage) {
      if (features.has(FeatureKey.TableMap)) {
        steps.push({
          id: 'tables',
          title: 'Dibuja tu salón',
          description: 'Mapea zonas y mesas para tomar pedidos por mesa o mover comensales.',
          ctaText: 'Configurar mesas',
          ctaLink: '/admin/tables',
          icon: 'pi pi-table',
          isCompleted: (snapshot?.tableCount ?? 0) > 0,
        });
      }
      if (features.has(FeatureKey.RealtimeKds)) {
        steps.push({
          id: 'kds-fb',
          title: 'Activa la pantalla de cocina',
          description: 'KDS en tiempo real: los pedidos llegan a cocina sin papel.',
          ctaText: 'Configurar KDS',
          ctaLink: '/admin/devices',
          icon: 'pi pi-desktop',
          isCompleted: false,
          isOptional: true,
        });
      }
      if (features.has(FeatureKey.DeliveryPlatforms)) {
        steps.push({
          id: 'delivery',
          title: 'Conecta delivery',
          description: 'Recibe pedidos de UberEats, Rappi y DidiFood directo en Fino.',
          ctaText: 'Conectar delivery',
          ctaLink: '/admin/settings',
          icon: 'pi pi-send',
          isCompleted: false,
          isOptional: true,
        });
      }
      if (features.has(FeatureKey.WaiterApp)) {
        steps.push({
          id: 'waiter',
          title: 'Habilita meseros móviles',
          description: 'Tus meseros toman pedidos desde el celular en la mesa.',
          ctaText: 'Configurar meseros',
          ctaLink: '/admin/users',
          icon: 'pi pi-mobile',
          isCompleted: false,
          isOptional: true,
        });
      }
    }

    if (macro === MacroCategoryCode.QuickService) {
      if (features.has(FeatureKey.RealtimeKds)) {
        steps.push({
          id: 'kds-qsr',
          title: 'Activa la pantalla de cocina',
          description: 'Pedidos en pantalla, sin tickets de papel.',
          ctaText: 'Configurar KDS',
          ctaLink: '/admin/devices',
          icon: 'pi pi-desktop',
          isCompleted: false,
          isOptional: true,
        });
      }
      if (features.has(FeatureKey.MaxKiosks)) {
        steps.push({
          id: 'kiosk',
          title: 'Activa autoservicio',
          description: 'Tus clientes ordenan solos. Menos filas, más velocidad.',
          ctaText: 'Configurar kiosko',
          ctaLink: '/admin/devices',
          icon: 'pi pi-shop',
          isCompleted: false,
          isOptional: true,
        });
      }
      if (features.has(FeatureKey.LoyaltyCrm)) {
        steps.push({
          id: 'loyalty',
          title: 'Lanza tu programa de lealtad',
          description: 'Premia a tus clientes frecuentes con puntos.',
          ctaText: 'Configurar lealtad',
          ctaLink: '/admin/customers',
          icon: 'pi pi-star',
          isCompleted: false,
          isOptional: true,
        });
      }
    }

    if (macro === MacroCategoryCode.Retail) {
      if (features.has(FeatureKey.StockAlerts)) {
        steps.push({
          id: 'stock',
          title: 'Carga tu inventario',
          description: 'Lleva control de stock. Alertas cuando algo se acaba.',
          ctaText: 'Cargar inventario',
          ctaLink: '/admin/inventory',
          icon: 'pi pi-box',
          isCompleted: false,
          isOptional: true,
        });
      }
      if (features.has(FeatureKey.CustomerCredit)) {
        steps.push({
          id: 'credit',
          title: 'Activa fiado',
          description: 'Clientes de confianza pagan después con saldo a su nombre.',
          ctaText: 'Configurar fiado',
          ctaLink: '/admin/customers',
          icon: 'pi pi-credit-card',
          isCompleted: false,
          isOptional: true,
        });
      }
      if (features.has(FeatureKey.ComparativeReports)) {
        steps.push({
          id: 'reports',
          title: 'Compara periodos',
          description: 'Ventas de esta semana vs la pasada, este mes vs el anterior.',
          ctaText: 'Ver reportes',
          ctaLink: '/admin/reports',
          icon: 'pi pi-chart-line',
          isCompleted: false,
          isOptional: true,
        });
      }
    }

    if (macro === MacroCategoryCode.Services) {
      if (features.has(FeatureKey.CustomFolios)) {
        steps.push({
          id: 'folios',
          title: 'Personaliza tus folios',
          description: 'Prefijo y formato propio para tus tickets.',
          ctaText: 'Configurar folios',
          ctaLink: '/admin/settings',
          icon: 'pi pi-hashtag',
          isCompleted: false,
          isOptional: true,
        });
      }
      if (features.has(FeatureKey.CustomerHistory)) {
        steps.push({
          id: 'history',
          title: 'Lleva historial de clientes',
          description: 'Cada servicio y cita queda registrado por cliente.',
          ctaText: 'Activar historial',
          ctaLink: '/admin/customers',
          icon: 'pi pi-history',
          isCompleted: false,
          isOptional: true,
        });
      }
      if (features.has(FeatureKey.Reminders)) {
        steps.push({
          id: 'reminders',
          title: 'Activa recordatorios',
          description: 'Avisa a tus clientes antes de su cita.',
          ctaText: 'Configurar recordatorios',
          ctaLink: '/admin/customers',
          icon: 'pi pi-bell',
          isCompleted: false,
          isOptional: true,
        });
      }
      // Access control is gated by sub-category, not just the macro.
      // The feature flag (`RealtimeAccessControl`) tells us the plan
      // includes it, but a nail salon or barber shop never needs
      // fingerprint / QR entry — only gym-type tenants do. Without
      // this second gate the step shows up for every Services tenant
      // on a plan that bundles the feature, which is exactly the
      // category of "irrelevant suggestion" the welcome screen is
      // supposed to avoid.
      if (
        features.has(FeatureKey.RealtimeAccessControl)
        && this.tenantContext.currentSubCategory() === SubCategoryType.Gym
      ) {
        steps.push({
          id: 'access',
          title: 'Configura control de acceso',
          description: 'Lectura de huella o QR a la entrada del gimnasio.',
          ctaText: 'Configurar acceso',
          ctaLink: '/admin/access-dashboard',
          icon: 'pi pi-id-card',
          isCompleted: false,
          isOptional: true,
        });
      }
    }

    // Multi-branch / multi-till — surfaced only when the snapshot says
    // the tenant has just one branch / register and the feature exists.
    if (features.has(FeatureKey.MultiBranch) && (snapshot?.branchCount ?? 1) === 1) {
      steps.push({
        id: 'branches',
        title: 'Suma sucursales',
        description: 'Si tienes más de una ubicación, agrégalas y compáralas.',
        ctaText: 'Agregar sucursal',
        ctaLink: '/admin/branches',
        icon: 'pi pi-building',
        isCompleted: false,
        isOptional: true,
      });
    }

    if (features.has(FeatureKey.MultiTill) && (snapshot?.cashRegisterCount ?? 1) <= 1) {
      steps.push({
        id: 'multitill',
        title: 'Suma cajas',
        description: 'Más de una caja por sucursal, cada una con su turno.',
        ctaText: 'Agregar caja',
        ctaLink: '/admin/registers',
        icon: 'pi pi-plus-circle',
        isCompleted: false,
        isOptional: true,
      });
    }

    return steps;
  });

  /**
   * Welcome screen view: only pending items (the "Primeros pasos
   * sugeridos" list). Filtered subset of `allApplicableSteps`.
   */
  readonly suggestedSteps = computed<WelcomeStep[]>(() =>
    this.allApplicableSteps().filter(s => !s.isCompleted),
  );

  //#endregion
}
