import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { InputTextModule } from 'primeng/inputtext';
import { PasswordModule } from 'primeng/password';

import { DeviceConfig } from '../../core/models';
import { ApiService } from '../../core/services/api.service';
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

/** Response from POST /api/device/setup */
interface SetupResponse {
  businessId: number;
  businessName: string;
  branches: BranchOption[];
}

/** Response from POST /api/device/activate */
interface ActivateResponse {
  businessId: number;
  businessName: string;
  branchId: number;
  branchName: string;
  mode: DeviceConfig['mode'];
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
  private readonly configService = inject(ConfigService);
  private readonly deviceService = inject(DeviceService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  //#endregion

  //#region Properties

  /** Current step: 'choose' | 'email' | 'code' | 'branch' | 'mode' | 'code-name' */
  readonly step = signal<string>('choose');

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
    { value: 'tables',  icon: '🪑', label: 'Mesas',             description: 'Servicio a mesas (restaurante, bar)' },
    { value: 'kitchen', icon: '👨‍🍳', label: 'Pantalla de Cocina', description: 'Vista de pedidos para cocina' },
    { value: 'kiosk',   icon: '📱', label: 'Kiosko',            description: 'Autoservicio para clientes' },
  ];

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

  goToEmail(): void {
    this.error.set('');
    this.step.set('email');
  }

  goToCode(): void {
    this.error.set('');
    this.codeDigits.set(['', '', '', '', '', '']);
    this.step.set('code');
  }

  goBack(): void {
    this.error.set('');
    this.step.set('choose');
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
      this.step.set('code-name');
    } catch {
      this.error.set('Código inválido o expirado.');
    } finally {
      this.isLoading.set(false);
    }
  }

  /**
   * Step 2B final: Register device in the backend, persist the device
   * token, and only then navigate. The fire-and-forget pattern used to
   * race `router.navigate` against the async `registerDevice` call —
   * on slow networks the guard on `/kitchen` / `/kiosk` would rebound
   * the user back here because the device token was not yet in
   * localStorage. Awaiting the registration fixes the race at the cost
   * of a spinner; a failed call is surfaced as an error so the user can
   * retry instead of being stranded in a half-provisioned state.
   */
  async saveCodeSetup(): Promise<void> {
    if (!this.activateData) return;
    if (this.isLoading()) return;

    const name = this.deviceName.trim() || 'POS Principal';

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
