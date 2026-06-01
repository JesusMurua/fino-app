import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs/operators';

import { ButtonModule } from 'primeng/button';

import { FeatureKey, MacroCategoryCode } from '../../core/enums';
import { AuthService } from '../../core/services/auth.service';
import { BusinessService } from '../../core/services/business.service';
import { CashRegisterService } from '../../core/services/cash-register.service';
import { ConfigService } from '../../core/services/config.service';
import { TenantContextService } from '../../core/services/tenant-context.service';
import { WelcomeStep, WelcomeStepsService } from '../../core/services/welcome-steps.service';
import { FinoMascotComponent, FinoSkin } from '../onboarding/fino-mascot/fino-mascot.component';

/**
 * Macro → human label for the "Tu cuenta está lista" chip.
 */
const MACRO_LABELS: Record<MacroCategoryCode, string> = {
  [MacroCategoryCode.FoodBeverage]: 'Restaurante / Bar',
  [MacroCategoryCode.QuickService]: 'Cafetería / Comida rápida',
  [MacroCategoryCode.Retail]:       'Tienda / Retail',
  [MacroCategoryCode.Services]:     'Servicios especializados',
};

/**
 * Plan code → human label. Backend emits PlanTypeCode in PascalCase
 * ("Free", "Basic", "Pro", "Enterprise") via the JWT — we translate
 * here for display only.
 */
const PLAN_LABELS: Record<number, string> = {
  1: 'Gratis',
  2: 'Básico',
  3: 'Profesional',
  4: 'Enterprise',
};

/**
 * Macro → mascot skin. Mirrors the mapping the onboarding wizard uses
 * so the same character carries the brand across both flows.
 */
const MACRO_TO_SKIN: Record<MacroCategoryCode, FinoSkin> = {
  [MacroCategoryCode.FoodBeverage]: 'restaurant',
  [MacroCategoryCode.QuickService]: 'cafe',
  [MacroCategoryCode.Retail]:       'retail',
  [MacroCategoryCode.Services]:     'services',
};

/**
 * First-Run Experience screen. Shown exactly once per user after the
 * first authenticated navigation that follows onboarding completion
 * (either via the wizard or the super-admin "alta directa" flow).
 *
 * Composition:
 *   - Hero: Fino logo + tagline, mascot, personalized greeting, business
 *     name when ConfigService has it.
 *   - "Tu cuenta está lista" chips: macro+sub-giro, plan+trial, branch,
 *     team count. Fiscal / tax chips appear only when configured.
 *   - "Primeros pasos sugeridos": derived from plan + vertical + state
 *     via `WelcomeStepsService.suggestedSteps`.
 *   - Footer CTA: primary "Abrir mi negocio" + secondary text link.
 *
 * On close (either CTA), calls `BusinessService.markWelcomeShown` which
 * sets the backend timestamp, regenerates the JWT, and the FE hydrates
 * the fresh AuthResponse so this screen never shows again for this user.
 */
@Component({
  selector: 'app-welcome',
  standalone: true,
  imports: [CommonModule, RouterLink, ButtonModule, FinoMascotComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './welcome.component.html',
  styleUrl: './welcome.component.scss',
})
export class WelcomeComponent {

  //#region Injections

  private readonly authService = inject(AuthService);
  private readonly businessService = inject(BusinessService);
  private readonly tenantContext = inject(TenantContextService);
  private readonly cashRegisterService = inject(CashRegisterService);
  private readonly configService = inject(ConfigService);
  private readonly welcomeStepsService = inject(WelcomeStepsService);
  private readonly router = inject(Router);

  //#endregion

  //#region View state

  /** Submitting flag for the primary CTA — disables both buttons. */
  readonly isClosing = signal(false);

  /** Optional error message when the welcome-shown POST fails. */
  readonly error = signal<string | null>(null);

  /** Live business config — provides businessName once ConfigService hydrates. */
  private readonly config = toSignal(this.configService.config$, { requireSync: true });

  /** Owner display name from the JWT — always available post-login. */
  readonly ownerName = computed(() => this.authService.currentUser()?.name ?? '');

  /** Business display name — empty string until ConfigService loads. */
  readonly businessName = computed(() => this.config().businessName ?? '');

  /** Mascot skin matched to the tenant's vertical, falls back to default. */
  readonly mascotSkin = computed<FinoSkin>(() => {
    const macro = this.tenantContext.currentMacro();
    return macro !== null ? MACRO_TO_SKIN[macro] : 'default';
  });

  //#endregion

  //#region "Tu cuenta está lista" chips

  /** Human label of the macro vertical (e.g. "Servicios especializados"). */
  readonly macroLabel = computed(() => {
    const macro = this.tenantContext.currentMacro();
    return macro !== null ? MACRO_LABELS[macro] : '';
  });

  /**
   * Sub-giro display name for the current tenant, or empty when it
   * has not yet hydrated (the sub-giro fetch lags the macro claim
   * from the JWT). Falls back to just the macro label in that window.
   */
  readonly subGiroLabel = computed(() => {
    const bt = this.tenantContext.currentBusinessType();
    return bt?.name ?? '';
  });

  /** Combined "Macro · Sub-giro" — falls back to macro alone. */
  readonly giroChipText = computed(() => {
    const macro = this.macroLabel();
    const sub = this.subGiroLabel();
    return sub ? `${macro} · ${sub}` : macro;
  });

  /** Plan label + optional trial expiry date. */
  readonly planChipText = computed(() => {
    const planId = this.authService.planTypeId();
    const planLabel = PLAN_LABELS[planId] ?? 'Plan';
    const trial = this.authService.trialEndsAt();
    if (!trial) return planLabel;
    const formatted = this.formatDate(trial);
    return formatted ? `${planLabel} · prueba hasta ${formatted}` : planLabel;
  });

  /** Branch name from the current user's branch list. */
  readonly branchChipText = computed(() => {
    const user = this.authService.currentUser();
    if (!user) return '';
    const current = user.branches?.find(b => b.id === user.currentBranchId);
    return current?.name ? `Sucursal ${current.name}` : 'Sucursal Principal';
  });

  /** User count chip — singular vs plural based on the snapshot. */
  readonly teamChipText = computed(() => {
    const count = this.authService.businessSnapshot()?.userCount ?? 1;
    return count === 1 ? '1 usuario' : `${count} usuarios`;
  });

  /**
   * Whether the tenant has configured a default tax — if so, we surface
   * it as a "Tu cuenta está lista" chip; otherwise the same item shows
   * up in "Primeros pasos sugeridos".
   */
  readonly hasTaxConfigured = computed(() =>
    this.tenantContext.business()?.defaultTaxId != null,
  );

  /** Whether the tenant has any RFC on file — drives the fiscal chip. */
  readonly hasFiscalConfigured = computed(() => {
    const fiscal = this.config().fiscalConfig;
    return !!fiscal?.rfc && fiscal.rfc.length > 0;
  });

  /** Fiscal chip text: RFC + régimen, or empty if not configured. */
  readonly fiscalChipText = computed(() => {
    const fiscal = this.config().fiscalConfig;
    if (!fiscal?.rfc) return '';
    const parts: string[] = [fiscal.rfc];
    if (fiscal.regimenFiscal) parts.push(fiscal.regimenFiscal);
    return parts.join(' · ');
  });

  //#endregion

  //#region Suggested steps

  /** Suggested next actions — fully derived from plan + vertical + state. */
  readonly suggestedSteps = computed<readonly WelcomeStep[]>(() =>
    this.welcomeStepsService.suggestedSteps(),
  );

  //#endregion

  //#region CTA handlers

  /**
   * Primary CTA: marks welcome shown, then navigates the user to the
   * caja shell route appropriate for their vertical. Disabled during
   * the round-trip to prevent double-submission.
   */
  async enterBusiness(): Promise<void> {
    await this.markShownAndNavigate(this.primaryRouteForMacro());
  }

  /**
   * Secondary CTA: same backend call, but lands on /admin/products so
   * the user can start setting up before opening caja.
   */
  async configureFirst(): Promise<void> {
    await this.markShownAndNavigate('/admin/products');
  }

  //#endregion

  //#region Helpers

  private async markShownAndNavigate(target: string): Promise<void> {
    if (this.isClosing()) return;
    this.isClosing.set(true);
    this.error.set(null);
    try {
      // Backend sets WelcomeShownAt + regenerates JWT with the new claim.
      // We pipe the response back through handleLoginSuccess so the
      // AuthService state stays atomically consistent with the new token.
      this.businessService.markWelcomeShown().subscribe({
        next: (response) => {
          this.authService.handleLoginSuccess(response);
          this.router.navigate([target]);
        },
        error: () => {
          // Surface the failure but don't block the user — they have a
          // valid session, the welcome flag is just sticky for next time.
          this.isClosing.set(false);
          this.error.set('No pudimos guardar tu progreso. Intenta de nuevo.');
        },
      });
    } catch {
      this.isClosing.set(false);
      this.error.set('No pudimos guardar tu progreso. Intenta de nuevo.');
    }
  }

  /**
   * Resolves the entry route into the caja shell based on the tenant's
   * vertical. F&B tenants land on the omni-channel hub (`/pos`) which
   * exposes mesas / takeout / delivery selectors; everyone else enters
   * the Fast-Lane chameleon (`/pos/sell`).
   */
  private primaryRouteForMacro(): string {
    return this.tenantContext.currentMacro() === MacroCategoryCode.FoodBeverage
      ? '/pos'
      : '/pos/sell';
  }

  /**
   * Formats an ISO 8601 string to a friendly Spanish date like
   * "12 jun 2026". Uses `Intl.DateTimeFormat` with es-MX locale so it
   * works offline and avoids dependencies on any pipe.
   */
  private formatDate(iso: string): string | null {
    try {
      const date = new Date(iso);
      if (Number.isNaN(date.getTime())) return null;
      return new Intl.DateTimeFormat('es-MX', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      })
        .format(date)
        .replace(/\.$/, '')
        .toLowerCase();
    } catch {
      return null;
    }
  }

  //#endregion
}
