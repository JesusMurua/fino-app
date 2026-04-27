import { Component, computed, inject } from '@angular/core';
import { Router } from '@angular/router';

import { MacroCategoryType } from '../../core/enums';
import { LAST_AUTH_ENTRY_KEY, LastAuthEntry } from '../../core/models';
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
  subtitle: 'Ventas, inventarios y caja.',
};

/**
 * Vertical-specific card descriptors.
 *
 * Spec (only the listed verticals get bespoke copy; everything else,
 * including Retail and QuickService, falls back to `DEFAULT_OPERATIONAL_CARD`):
 *   - Services     → Recepción y Membresías (gym/spa/services)
 *   - FoodBeverage → Punto de Venta (caja + comandas + mesas)
 */
const OPERATIONAL_CARD_BY_MACRO: Partial<Record<MacroCategoryType, OperationalCardDescriptor>> = {
  [MacroCategoryType.Services]: {
    icon: 'pi pi-id-card',
    title: 'Recepción y Membresías',
    subtitle: 'Gestión de socios, accesos y vigencias.',
  },
  [MacroCategoryType.FoodBeverage]: {
    icon: 'pi pi-shopping-cart',
    title: 'Punto de Venta',
    subtitle: 'Caja, comanderas y servicio a mesas.',
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
    return OPERATIONAL_CARD_BY_MACRO[macro] ?? DEFAULT_OPERATIONAL_CARD;
  });

  /**
   * Card A — "Panel de Control". Always routes to `/login` and records
   * the email entry so future redirects (catch-all, post-logout) re-enter
   * via the Back Office surface.
   */
  goToBackOffice(): void {
    this.rememberEntry('email');
    this.router.navigateByUrl('/login');
  }

  /**
   * Card B — vertical-aware operational entry. Records the PIN entry and
   * routes to `/pin` when the device is paired, otherwise `/setup` so a
   * fresh device can enter its 6-digit activation code.
   */
  goToOperational(): void {
    this.rememberEntry('pin');
    if (this.configService.isDeviceConfigured()) {
      this.router.navigateByUrl('/pin');
    } else {
      this.router.navigateByUrl('/setup');
    }
  }

  /** Persists which entry the user chose so guards / catch-all redirects
   *  can re-enter via the same surface after logout or a stale session. */
  private rememberEntry(entry: LastAuthEntry): void {
    localStorage.setItem(LAST_AUTH_ENTRY_KEY, entry);
  }
}
