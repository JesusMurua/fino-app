import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { InputTextModule } from 'primeng/inputtext';
import { PasswordModule } from 'primeng/password';

import { DeviceConfig } from '../../core/models';
import { MacroCategoryType } from '../../core/enums';
import { ApiService } from '../../core/services/api.service';
import { AuthService } from '../../core/services/auth.service';
import { ConfigService } from '../../core/services/config.service';
import { DeviceService } from '../../core/services/device.service';
import { firstValueFrom } from 'rxjs';

/** Operating mode option for the mode selector */
interface ModeOption {
  value: DeviceConfig['mode'];
  icon: string;
  label: string;
  description: string;
}

/** Branch returned by the setup/activate API */
interface BranchOption {
  id: number;
  name: string;
}

/**
 * Tenant-vertical hints carried by both setup and activate responses so
 * the UI can filter the mode selector without a second round-trip.
 * All three are optional for backwards compatibility — older backends
 * that haven't shipped the enrichment yet will simply skip filtering.
 */
interface VerticalHints {
  primaryMacroCategoryId?: MacroCategoryType;
  hasKitchen?: boolean;
  hasTables?: boolean;
}

/** Response from POST /api/device/setup */
interface SetupResponse extends VerticalHints {
  businessId: number;
  businessName: string;
  branches: BranchOption[];
}

/** Response from POST /api/device/activate */
interface ActivateResponse extends VerticalHints {
  businessId: number;
  businessName: string;
  branchId: number;
  branchName: string;
  mode: DeviceConfig['mode'];
  /**
   * Human-readable name pre-configured by the admin when generating the
   * code. Optional to stay backwards compatible with codes issued before
   * this field shipped; the UI falls back to 'POS Principal'.
   */
  deviceName?: string;
}

@Component({
  selector: 'app-setup',
  standalone: true,
  imports: [FormsModule, InputTextModule, PasswordModule],
  templateUrl: './setup.component.html',
  styleUrl: './setup.component.scss',
})
export class SetupComponent implements OnInit {

  //#region Injections

  private readonly api = inject(ApiService);
  private readonly authService = inject(AuthService);
  private readonly configService = inject(ConfigService);
  private readonly deviceService = inject(DeviceService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  //#endregion

  //#region Properties

  /**
   * Current step of the setup state machine:
   *   code         → enter 6-digit code (default landing — the upstream
   *                  Auth Portal is the dual-entry surface; pairing only
   *                  happens via codes issued from `/admin/devices`).
   *   code-review  → read-only summary of the pre-configured assignment;
   *                  a single "Confirmar" runs registerDevice and routes
   *                  away.
   *   email/branch/mode → legacy email-pairing flow, kept available via
   *                  deep-link only (`/setup?flow=email`) for tenants who
   *                  prefer browser-side pairing. Not surfaced in default
   *                  navigation since the Portal owns the entry choice.
   */
  readonly step = signal<string>('code');

  /** Error message displayed to the user */
  readonly error = signal('');

  /** Loading state for API calls */
  readonly isLoading = signal(false);

  /**
   * True while the auto-recovery `validateDevice()` call is in flight at
   * boot. Used to hide the main UI so the user does not see a flash of
   * the choose-method screen before we decide whether to redirect away.
   */
  readonly isValidating = signal(true);

  /**
   * True when the setup screen was reached because the `deviceAuthGuard`
   * rebounced an unauthenticated infrastructure device. The template
   * swaps the header to a distinctive "Dispositivo no vinculado" state.
   */
  readonly isUnbound = signal(false);

  /** Email login form */
  email = '';
  password = '';

  /** Activation code form — 6 individual digits */
  readonly codeDigits = signal<string[]>(['', '', '', '', '', '']);

  /** Data from setup/activate API */
  readonly branches = signal<BranchOption[]>([]);
  private businessId = 0;
  private businessName = '';
  selectedBranchId = 0;
  selectedBranchName = '';

  /** Mode + device name selection */
  selectedMode: DeviceConfig['mode'] = 'cashier';
  deviceName = 'POS Principal';

  /** Activate response data (code flow) */
  private activateData: ActivateResponse | null = null;

  readonly modes: ModeOption[] = [
    { value: 'cashier', icon: '💳', label: 'Caja Registradora',  description: 'Cobro y venta directa' },
    { value: 'tables',  icon: '🪑', label: 'Gestión de Mesas',  description: 'Servicio a mesas (restaurante, bar)' },
    { value: 'kitchen', icon: '👨‍🍳', label: 'Pantalla de Cocina', description: 'Vista de pedidos para cocina' },
    { value: 'kiosk',   icon: '📱', label: 'Kiosko',            description: 'Autoservicio para clientes' },
  ];

  /**
   * Tenant-vertical hints captured from the setup/activate response.
   * Populated by `submitEmail` and `submitCode` so `availableModes`
   * can filter the picker before the user gets to it.
   */
  private readonly tenantMacro = signal<MacroCategoryType | null>(null);
  private readonly tenantHasKitchen = signal<boolean | null>(null);
  private readonly tenantHasTables = signal<boolean | null>(null);

  /**
   * Modes presented to the user, filtered by the tenant's vertical:
   *   - `tables`  and `kitchen` → only tenants in the food-prep verticals
   *     (FoodBeverage or QuickService). Each mode also respects its own
   *     operational flag (`hasTables` / `hasKitchen`) when present.
   *   - `cashier` and `kiosk` → universal.
   *
   * When the backend hasn't shipped the vertical hints yet (`macro` is
   * `null`), the filter degrades open — all four modes are shown so
   * existing flows keep working until the backend enrichment ships.
   */
  readonly availableModes = computed<readonly ModeOption[]>(() => {
    const macro = this.tenantMacro();
    const hasKitchen = this.tenantHasKitchen();
    const hasTables = this.tenantHasTables();

    const isFoodPrepVertical = macro === MacroCategoryType.FoodBeverage
      || macro === MacroCategoryType.QuickService;

    return this.modes.filter(mode => {
      switch (mode.value) {
        case 'cashier':
        case 'kiosk':
          return true;
        case 'tables':
          if (macro === null) return true;
          return isFoodPrepVertical && hasTables !== false;
        case 'kitchen':
          if (macro === null) return true;
          return isFoodPrepVertical && hasKitchen !== false;
        default:
          return true;
      }
    });
  });

  /** Human-readable labels for device modes — used in code flow badge */
  private readonly modeLabels: Record<string, string> = {
    cashier: '💳 Cajero',
    tables:  '🪑 Mesas',
    kitchen: '👨‍🍳 Cocina',
    kiosk:   '📱 Kiosko',
  };

  /** Returns the display label for the activation code's pre-assigned mode */
  getActivateModeBadge(): string {
    if (!this.activateData) return '';
    return this.modeLabels[this.activateData.mode] ?? this.activateData.mode;
  }

  //#endregion

  //#region Lifecycle

  /**
   * Runs a silent auto-recovery on boot:
   *
   *   1. Read `?reason=unbound` to switch the header to the "device not
   *      linked" variant when the guard rebounced us here.
   *   2. Call `DeviceService.validateDevice()` — if the backend still
   *      recognizes our stable UUID, the local config + device token are
   *      hydrated in place. Navigate straight to the mode-specific entry
   *      point so the user never has to re-enter an activation code.
   *   3. Otherwise, reveal the normal choose-method UI.
   *
   * For infrastructure modes (`kitchen`, `kiosk`) the auto-redirect is
   * only honored when a valid device token was actually persisted by
   * `validateDevice()` — otherwise `deviceAuthGuard` would rebound the
   * user back here in an infinite loop.
   */
  async ngOnInit(): Promise<void> {
    if (this.route.snapshot.queryParamMap.get('reason') === 'unbound') {
      this.isUnbound.set(true);
    }

    // Fresh incognito / first-time boot: neither a user JWT nor a device
    // token exists, so calling /devices/validate would bounce with a
    // 401 and pollute observability. Skip straight to the choose-method
    // screen. A device is considered "known" only when at least one
    // token is present.
    if (!this.hasAnyLocalToken()) {
      this.isValidating.set(false);
      return;
    }

    try {
      const recovered = await this.deviceService.validateDevice();
      if (recovered && this.canAutoRedirect()) {
        this.navigateByMode();
        return;
      }
    } catch {
      // Silent — fall through to the normal setup UI
    } finally {
      this.isValidating.set(false);
    }
  }

  /**
   * True when the browser already holds a user JWT or a long-lived
   * device token. Used to gate the auto-recovery `validateDevice()`
   * call so a fresh incognito window never fires an unauthenticated
   * request to a protected endpoint.
   */
  private hasAnyLocalToken(): boolean {
    return this.authService.getToken() !== null
      || this.deviceService.getDeviceToken() !== null;
  }

  /**
   * Returns true when the recovered config is safe to auto-redirect.
   * Infrastructure modes MUST have a valid device token, otherwise the
   * `deviceAuthGuard` on `/kitchen` / `/kiosk` will immediately rebound
   * back to `/setup` and create a navigation loop.
   */
  private canAutoRedirect(): boolean {
    const mode = this.configService.deviceConfig$.getValue().mode;
    const needsDeviceToken = mode === 'kitchen' || mode === 'kiosk';
    if (needsDeviceToken) {
      return this.deviceService.hasValidDeviceToken();
    }
    return true;
  }

  /** Navigates to the mode-specific entry point after successful recovery */
  private navigateByMode(): void {
    const mode = this.configService.deviceConfig$.getValue().mode;
    switch (mode) {
      case 'kiosk':
        this.router.navigate(['/kiosk/welcome']);
        break;
      case 'kitchen':
        this.router.navigate(['/kitchen']);
        break;
      default:
        this.router.navigate(['/pin']);
        break;
    }
  }

  //#endregion

  //#region Navigation

  /** Switches to the legacy email-pairing flow. Reachable via deep-link
   *  / `?flow=email` only — the default UI does not offer this path. */
  goToEmail(): void {
    this.error.set('');
    this.step.set('email');
  }

  /** Returns to the activation-code step. Used after the email flow
   *  navigates forward and the user wants to back out. */
  goToCode(): void {
    this.error.set('');
    this.codeDigits.set(['', '', '', '', '', '']);
    this.step.set('code');
  }

  /**
   * "Back" action — leaves the setup flow entirely and returns to the
   * dual-entry Portal so the user can re-pick Back Office vs Operational.
   * Replaces the old `step.set('choose')` since the choose step lives in
   * the Portal now.
   */
  goBack(): void {
    this.error.set('');
    this.router.navigateByUrl('/');
  }

  //#endregion

  //#region Code Input Handling

  /** Handles input on a single code digit box */
  onCodeInput(index: number, event: Event): void {
    const input = event.target as HTMLInputElement;
    const value = input.value.replace(/\D/g, '').slice(0, 1);

    this.codeDigits.update(d => {
      const updated = [...d];
      updated[index] = value;
      return updated;
    });

    // Auto-focus next input
    if (value && index < 5) {
      const next = input.parentElement?.querySelectorAll('input')[index + 1];
      (next as HTMLInputElement)?.focus();
    }

    // Auto-submit when all 6 digits are entered
    if (this.codeDigits().every(d => d !== '')) {
      this.submitCode();
    }
  }

  /** Handles backspace on code digit boxes */
  onCodeKeydown(index: number, event: KeyboardEvent): void {
    if (event.key === 'Backspace' && !this.codeDigits()[index] && index > 0) {
      const prev = (event.target as HTMLElement).parentElement?.querySelectorAll('input')[index - 1];
      (prev as HTMLInputElement)?.focus();
    }
  }

  //#endregion

  //#region Email Flow

  /** Step 2A: Authenticate with email + password and get branches */
  async submitEmail(): Promise<void> {
    if (!this.email.trim() || !this.password) return;

    this.error.set('');
    this.isLoading.set(true);

    try {
      const response = await firstValueFrom(
        this.api.post<SetupResponse>('/device/setup', {
          email: this.email.trim(),
          password: this.password,
        }),
      );

      this.businessId = response.businessId;
      this.businessName = response.businessName;
      this.branches.set(response.branches);
      this.captureVerticalHints(response);
      this.step.set('branch');
    } catch {
      this.error.set('Email o contraseña incorrectos.');
    } finally {
      this.isLoading.set(false);
    }
  }

  /** Step 2A continued: Select branch then go to mode selection */
  selectBranch(branch: BranchOption): void {
    this.selectedBranchId = branch.id;
    this.selectedBranchName = branch.name;
    this.step.set('mode');
  }

  /**
   * Step 2A final: Register device in the backend, persist the device
   * token, and only then navigate. `registerDevice` writes the local
   * config AND the device token atomically on success, so we no longer
   * pre-save anything here — a half-provisioned state is a worse outcome
   * than making the user retry.
   */
  async saveEmailSetup(): Promise<void> {
    if (this.isLoading()) return;

    const name = this.deviceName.trim() || 'POS Principal';

    this.error.set('');
    this.isLoading.set(true);
    try {
      await this.deviceService.registerDevice(
        this.selectedBranchId,
        this.selectedMode,
        name,
      );
      this.navigateByMode();
    } catch (err) {
      console.error('[SetupComponent] Email-flow device registration failed:', err);
      this.error.set('No se pudo vincular el dispositivo. Verifica tu conexión e intenta de nuevo.');
    } finally {
      this.isLoading.set(false);
    }
  }

  //#endregion

  //#region Code Flow

  /** Step 2B: Activate device with 6-digit code */
  async submitCode(): Promise<void> {
    const code = this.codeDigits().join('');
    if (code.length !== 6) return;

    this.error.set('');
    this.isLoading.set(true);

    try {
      const response = await firstValueFrom(
        this.api.post<ActivateResponse>('/device/activate', { code }),
      );

      this.activateData = response;
      this.captureVerticalHints(response);
      this.step.set('code-review');
    } catch {
      this.error.set('Código inválido o expirado.');
    } finally {
      this.isLoading.set(false);
    }
  }

  /**
   * Records the tenant's macro and operational flags so `availableModes`
   * can filter the picker. Tolerant of older backends that don't ship the
   * fields yet — leaves the signals at `null` and the filter degrades open.
   */
  private captureVerticalHints(hints: VerticalHints): void {
    if (hints.primaryMacroCategoryId !== undefined) {
      this.tenantMacro.set(hints.primaryMacroCategoryId);
    }
    if (hints.hasKitchen !== undefined) {
      this.tenantHasKitchen.set(hints.hasKitchen);
    }
    if (hints.hasTables !== undefined) {
      this.tenantHasTables.set(hints.hasTables);
    }
  }

  /**
   * Code flow confirmation: registers the device using the name, branch
   * and mode the admin pre-configured when issuing the code. The user
   * does not type anything here — they only confirm.
   *
   * Awaits `registerDevice` before navigating so the device token is in
   * localStorage before `deviceAuthGuard` on /kitchen or /kiosk can
   * rebound us to /setup.
   */
  async saveCodeSetup(): Promise<void> {
    if (!this.activateData) return;
    if (this.isLoading()) return;

    // Defensive fallback: codes issued before the admin deviceName field
    // shipped won't carry a name — keep a sensible default so the
    // activation does not fail.
    const name = this.activateData.deviceName?.trim() || 'POS Principal';

    this.error.set('');
    this.isLoading.set(true);
    try {
      await this.deviceService.registerDevice(
        this.activateData.branchId,
        this.activateData.mode,
        name,
      );
      this.navigateByMode();
    } catch (err) {
      console.error('[SetupComponent] Code-flow device registration failed:', err);
      this.error.set('No se pudo vincular el dispositivo. Verifica tu conexión e intenta de nuevo.');
    } finally {
      this.isLoading.set(false);
    }
  }

  //#endregion
}
