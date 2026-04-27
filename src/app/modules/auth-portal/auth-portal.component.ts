import { Component, computed, inject } from '@angular/core';
import { Router } from '@angular/router';

import { MacroCategoryType } from '../../core/enums';
import { AuthService } from '../../core/services/auth.service';
import { ConfigService } from '../../core/services/config.service';

/**
 * Visual descriptor for the Operational entry card. Picked dynamically
 * from the tenant's macro category so the wording matches the user's
 * mental model — a Gym sees "Recepción y Membresías", a restaurant sees
 * "Punto de Venta y Comandas", etc.
 */
interface OperationalCardDescriptor {
  icon: string;
  title: string;
  subtitle: string;
}

const DEFAULT_OPERATIONAL_CARD: OperationalCardDescriptor = {
  icon: 'pi pi-desktop',
  title: 'Terminal de Operación',
  subtitle: 'Continuar a la pantalla operativa',
};

const OPERATIONAL_CARD_BY_MACRO: Record<MacroCategoryType, OperationalCardDescriptor> = {
  [MacroCategoryType.FoodBeverage]: {
    icon: 'pi pi-shopping-cart',
    title: 'Punto de Venta y Comandas',
    subtitle: 'Cobros, mesas y comandas a cocina',
  },
  [MacroCategoryType.QuickService]: {
    icon: 'pi pi-shopping-cart',
    title: 'Punto de Venta y Comandas',
    subtitle: 'Cobros y comandas rápidas',
  },
  [MacroCategoryType.Retail]: {
    icon: 'pi pi-tag',
    title: 'Punto de Venta y Caja',
    subtitle: 'Cobros, código de barras y stock',
  },
  [MacroCategoryType.Services]: {
    icon: 'pi pi-id-card',
    title: 'Recepción y Membresías',
    subtitle: 'Check-in, vigencias y cobros',
  },
};

/**
 * Inverse of `posExperienceForMacro`. Lets the Portal recover the macro
 * from the cached PosExperience when no live user session is available
 * (e.g. browser was logged out but the device was paired previously).
 */
function macroFromPosExperience(experience: string | undefined): MacroCategoryType | null {
  switch (experience) {
    case 'Restaurant': return MacroCategoryType.FoodBeverage;
    case 'Counter':    return MacroCategoryType.QuickService;
    case 'Retail':     return MacroCategoryType.Retail;
    case 'Quick':      return MacroCategoryType.Services;
    default:           return null;
  }
}

/**
 * Two-card landing surface — the dual entry point of the app:
 *
 *   - Card A "Back Office": always routes to `/login` for Owner/Manager
 *     email authentication.
 *   - Card B "Operational": vertical-aware label. Routes to `/pin` when
 *     the device has been paired (configured) or to `/setup` otherwise
 *     so a fresh device can be activated by 6-digit code.
 *
 * Replaces the dual-button `'choose'` step that used to live inside
 * `SetupComponent`. See AUDIT-043 for the migration rationale.
 */
@Component({
  selector: 'app-auth-portal',
  standalone: true,
  templateUrl: './auth-portal.component.html',
  styleUrl: './auth-portal.component.scss',
})
export class AuthPortalComponent {

  private readonly authService = inject(AuthService);
  private readonly configService = inject(ConfigService);
  private readonly router = inject(Router);

  /**
   * Resolves the active macro for label rendering.
   *
   * Lookup order:
   *   1. Live signed-in session (`AuthService.primaryMacroCategoryId`).
   *   2. Cached device config (`ConfigService.posExperience` → macro).
   *   3. None — falls back to the generic "Terminal de Operación" card.
   */
  private readonly currentMacro = computed<MacroCategoryType | null>(() => {
    const fromSession = this.authService.primaryMacroCategoryId();
    if (fromSession !== null) return fromSession;
    return macroFromPosExperience(this.configService.posExperience());
  });

  /** Card B descriptor — vertical-aware. */
  readonly operationalCard = computed<OperationalCardDescriptor>(() => {
    const macro = this.currentMacro();
    if (macro === null) return DEFAULT_OPERATIONAL_CARD;
    return OPERATIONAL_CARD_BY_MACRO[macro];
  });

  /**
   * Card A handler — always sends the user to the email login screen,
   * regardless of device or session state. Back Office surface.
   */
  goToBackOffice(): void {
    this.router.navigateByUrl('/login');
  }

  /**
   * Card B handler — picks the operational entry based on whether this
   * browser has a paired device. Configured devices have a stored device
   * token + DeviceConfig in IndexedDB; fresh devices need to enter an
   * activation code at `/setup`.
   */
  goToOperational(): void {
    if (this.configService.isDeviceConfigured()) {
      this.router.navigateByUrl('/pin');
    } else {
      this.router.navigateByUrl('/setup');
    }
  }
}
