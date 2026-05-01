import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { InputTextModule } from 'primeng/inputtext';
import { PasswordModule } from 'primeng/password';

import { ActivateDeviceResponse, DeviceConfig } from '../../core/models';
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
   *   code         → enter 6-character alphanumeric code (default landing —
   *                  the upstream Auth Portal is the dual-entry surface;
   *                  pairing only happens via codes issued from
   *                  `/admin/devices`).
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

  /** Activation code form — 6 individual cells, each holding either an
   *  empty string or one uppercase char from the secure alphabet. */
  readonly codeDigits = signal<string[]>(['', '', '', '', '', '']);

  /**
   * Pattern matching characters that fall OUTSIDE the secure activation
   * alphabet `[A-HJKMNP-TV-Z2-9]` — Crockford-like, with the visually
   * ambiguous chars `I`, `L`, `O`, `U`, `0` and `1` excluded to prevent
   * dictation errors. Used as a global strip pattern by both the typing
   * sanitizer (`sanitizeChar`) and the paste sanitizer
   * (`sanitizePastedCode`) so both routes share identical filtering.
   */
  private readonly SECURE_ALPHABET_REGEX = /[^A-HJKMNP-TV-Z2-9]/g;

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
  private activateData: ActivateDeviceResponse | null = null;

  readonly modes: ModeOption[] = [
    { value: 'cashier',   icon: '💳', label: 'Caja Registradora',           description: 'Cobro y venta directa' },
    { value: 'tables',    icon: '🪑', label: 'Gestión de Mesas',            description: 'Servicio a mesas (restaurante, bar)' },
    { value: 'kitchen',   icon: '👨‍🍳', label: 'Pantalla de Cocina',         description: 'Vista de pedidos para cocina' },
    { value: 'kiosk',     icon: '📱', label: 'Kiosko',                      description: 'Autoservicio para clientes' },
    { value: 'reception', icon: '🪪', label: 'Pantalla de Recepción',       description: 'Check-in y control de acceso (gimnasios, servicios)' },
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
        case 'reception':
          // Member check-in is a Services-vertical screen (gym today,
          // generic Services tomorrow). Hide it for Food/Quick/Retail.
          // Degrade open when the macro hint hasn't shipped yet.
          if (macro === null) return true;
          return macro === MacroCategoryType.Services;
        default:
          return true;
      }
    });
  });

  /** Human-readable labels for device modes — used in code flow badge */
  private readonly modeLabels: Record<string, string> = {
    cashier:   '💳 Cajero',
    tables:    '🪑 Mesas',
    kitchen:   '👨‍🍳 Cocina',
    kiosk:     '📱 Kiosko',
    reception: '🪪 Recepción',
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
   * `deviceAuthGuard` on `/kitchen` / `/kiosk` / `/reception` will
   * immediately rebound back to `/setup` and create a navigation loop.
   */
  private canAutoRedirect(): boolean {
    const mode = this.configService.deviceConfig$.getValue().mode;
    const needsDeviceToken = mode === 'kitchen' || mode === 'kiosk' || mode === 'reception';
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
      case 'reception':
        this.router.navigate(['/reception/access-control']);
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

  /**
   * Sanitizes a single user-typed character: uppercases it, strips any
   * char outside the secure alphabet, and returns at most one valid char
   * (or `''` when the input is invalid). Shared with the paste sanitizer
   * so manual-typing and paste-distribution routes apply identical rules.
   *
   * @param raw Raw value just written to the input by the browser
   */
  private sanitizeChar(raw: string): string {
    return raw.toUpperCase().replace(this.SECURE_ALPHABET_REGEX, '').slice(0, 1);
  }

  /**
   * Sanitizes a full clipboard payload pasted by the user: uppercases the
   * string, strips noise (whitespace, quotes, ambiguous chars) and clamps
   * the result to 6 chars. Returns the chars to distribute across the
   * cells; an empty string means the paste contained nothing valid.
   *
   * @param raw Raw clipboard payload from `ClipboardEvent.clipboardData`
   */
  private sanitizePastedCode(raw: string): string {
    return raw.toUpperCase().replace(this.SECURE_ALPHABET_REGEX, '').slice(0, 6);
  }

  /**
   * Handles a single keystroke on a code cell. Valid chars from the
   * secure alphabet are written to the signal (uppercased) and focus
   * advances to the next cell; auto-submit fires when all 6 cells are
   * filled. Invalid chars are silently dropped — to prevent the input
   * from appearing frozen with the rejected char visible, the DOM value
   * is forcibly resynced from the signal because a no-op signal update
   * would not re-run the `[value]` property binding.
   *
   * @param index Zero-based index of the cell receiving the input
   * @param event Native `input` event from the cell's `<input>` element
   */
  onCodeInput(index: number, event: Event): void {
    const input = event.target as HTMLInputElement;
    const sanitised = this.sanitizeChar(input.value);

    if (!sanitised) {
      // Silent drop — restore the previous cell value so the rejected
      // char does not stay visible in the DOM and the input does not
      // appear frozen. No state change, no focus change.
      input.value = this.codeDigits()[index];
      return;
    }

    this.codeDigits.update(d => {
      const updated = [...d];
      updated[index] = sanitised;
      return updated;
    });

    // Auto-focus next input
    if (index < 5) {
      const next = input.parentElement?.querySelectorAll('input')[index + 1];
      (next as HTMLInputElement)?.focus();
    }

    // Auto-submit when all 6 cells are filled
    if (this.codeDigits().every(d => d !== '')) {
      this.submitCode();
    }
  }

  /**
   * Implements the two-step Backspace UX on the code cells:
   *   1. Cell with a value → clear the cell and keep focus.
   *   2. Cell already empty → move focus to the previous cell and select
   *      its content so the user can immediately overwrite it.
   * Other keys fall through to native handling.
   *
   * @param index Zero-based index of the cell receiving the keydown
   * @param event Native `keydown` event from the cell's `<input>` element
   */
  onCodeKeydown(index: number, event: KeyboardEvent): void {
    if (event.key !== 'Backspace') return;
    const input = event.target as HTMLInputElement;

    if (this.codeDigits()[index]) {
      // Step 1: cell has a value → clear and stay focused.
      event.preventDefault();
      this.codeDigits.update(d => {
        const updated = [...d];
        updated[index] = '';
        return updated;
      });
      input.value = '';
      return;
    }

    if (index > 0) {
      // Step 2: cell already empty → jump back and select previous content.
      event.preventDefault();
      const prev = input.parentElement?.querySelectorAll('input')[index - 1] as HTMLInputElement | undefined;
      if (prev) {
        prev.focus();
        prev.select();
      }
    }
  }

  /**
   * Selects the cell content on focus so the user can overwrite an
   * existing char with a single keystroke — standard PIN-input UX.
   *
   * @param _index Unused, kept for handler-signature symmetry with siblings
   * @param event Native `focus` event from the cell's `<input>` element
   */
  onCodeFocus(_index: number, event: FocusEvent): void {
    const input = event.target as HTMLInputElement;
    input.select();
  }

  /**
   * Distributes a pasted code across the cells starting at the focused
   * cell. Sanitizes the clipboard payload against the secure alphabet,
   * writes the valid chars into consecutive cells (truncating at cell 5
   * so we never overflow), moves focus to the first remaining empty cell
   * (or the last cell if the paste filled all six), and triggers
   * auto-submit only when the resulting code is exactly 6 chars long.
   * Calls `event.preventDefault()` to suppress the native paste so the
   * per-cell `maxlength="1"` does not interfere with the distribution.
   *
   * @param index Zero-based index of the cell where the paste was issued
   * @param event Native `paste` event from the cell's `<input>` element
   */
  onCodePaste(index: number, event: ClipboardEvent): void {
    event.preventDefault();
    const raw = event.clipboardData?.getData('text') ?? '';
    const sanitised = this.sanitizePastedCode(raw);
    if (!sanitised) return;

    // Distribute the sanitized chars across cells starting at `index`,
    // truncating at the cell boundary so we never write past cell 5.
    this.codeDigits.update(d => {
      const updated = [...d];
      for (let i = 0; i < sanitised.length && index + i < 6; i++) {
        updated[index + i] = sanitised[i];
      }
      return updated;
    });

    // Move focus to the first remaining empty cell, or to the last cell
    // if the paste filled everything.
    const input = event.target as HTMLInputElement;
    const cells = input.parentElement?.querySelectorAll('input');
    if (cells) {
      const nextEmptyIdx = this.codeDigits().findIndex(d => d === '');
      const focusIdx = nextEmptyIdx === -1 ? 5 : nextEmptyIdx;
      (cells[focusIdx] as HTMLInputElement | undefined)?.focus();
    }

    // Auto-submit only when the full code is exactly 6 valid chars.
    if (this.codeDigits().every(d => d !== '')) {
      this.submitCode();
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
    } catch (error) {
      console.error('[SetupComponent] Email-flow device registration failed:', error);
      this.error.set(this.resolveActivationError(
        error,
        'No se pudo vincular el dispositivo. Verifica tu conexión e intenta de nuevo.',
      ));
    } finally {
      this.isLoading.set(false);
    }
  }

  //#endregion

  //#region Code Flow

  /**
   * Step 2B: Activate device with the 6-character alphanumeric code. The atomic
   * `/device/activate` endpoint provisions the device, persists the
   * local config, and stores the long-lived device token in a single
   * round-trip — by the time we land on `code-review` the device is
   * fully bound and the user only confirms before navigating away.
   */
  async submitCode(): Promise<void> {
    const code = this.codeDigits().join('');
    if (code.length !== 6) return;

    this.error.set('');
    this.isLoading.set(true);

    try {
      const response = await this.deviceService.activateDevice(code);
      this.activateData = response;
      this.captureVerticalHints(response);
      this.step.set('code-review');
    } catch (error) {
      this.error.set(this.resolveActivationError(error, 'Código inválido o expirado.'));
    } finally {
      this.isLoading.set(false);
    }
  }

  /**
   * Maps an activation/registration error to the message shown in the
   * red banner. A 403 from the backend means the tenant has hit its
   * device quota — we surface its `message` / `detail` verbatim so the
   * user sees the actionable upgrade hint instead of a misleading
   * "código inválido" or "verifica tu conexión". Anything else falls
   * through to the caller-supplied generic message.
   */
  private resolveActivationError(error: unknown, fallback: string): string {
    if (error instanceof HttpErrorResponse && error.status === 403) {
      const body = error.error as { message?: string; detail?: string } | null;
      return body?.message
        ?? body?.detail
        ?? 'Has alcanzado el límite de dispositivos de tu plan.';
    }
    return fallback;
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
   * Code flow confirmation: the device was already provisioned atomically
   * by `submitCode` via `/device/activate`, so this step only routes the
   * user to the mode-specific entry point. No network call, no token
   * write — all of that happened before we reached `code-review`.
   */
  saveCodeSetup(): void {
    if (!this.activateData) return;
    this.navigateByMode();
  }

  //#endregion
}
