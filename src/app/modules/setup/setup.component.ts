import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { InputTextModule } from 'primeng/inputtext';
import { PasswordModule } from 'primeng/password';

import { DeviceConfig } from '../../core/models';
import { ApiService } from '../../core/services/api.service';
import { ConfigService } from '../../core/services/config.service';
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
export class SetupComponent {

  //#region Injections

  private readonly api = inject(ApiService);
  private readonly configService = inject(ConfigService);
  private readonly router = inject(Router);

  //#endregion

  //#region Properties

  /** Current step: 'choose' | 'email' | 'code' | 'branch' | 'mode' | 'code-name' */
  readonly step = signal<string>('choose');

  /** Error message displayed to the user */
  readonly error = signal('');

  /** Loading state for API calls */
  readonly isLoading = signal(false);

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
    { value: 'cashier', icon: '💳', label: 'Cajero',  description: 'POS estándar de cobro' },
    { value: 'tables',  icon: '🪑', label: 'Mesas',   description: 'Vista de mesas para meseros' },
    { value: 'kitchen', icon: '👨‍🍳', label: 'Cocina',  description: 'Pantalla de cocina KDS' },
    { value: 'kiosk',   icon: '📱', label: 'Kiosko',  description: 'Autoservicio para clientes' },
  ];

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

  /** Step 2A final: Save device config and redirect to /pin */
  saveEmailSetup(): void {
    const config: DeviceConfig = {
      businessId:   this.businessId,
      branchId:     this.selectedBranchId,
      businessName: this.businessName,
      branchName:   this.selectedBranchName,
      mode:         this.selectedMode,
      deviceName:   this.deviceName.trim() || 'POS Principal',
      configuredAt: new Date().toISOString(),
    };

    this.configService.saveDeviceConfig(config);
    this.router.navigate(['/pin']);
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

  /** Step 2B final: Save device config from activation code and redirect */
  saveCodeSetup(): void {
    if (!this.activateData) return;

    const config: DeviceConfig = {
      businessId:   this.activateData.businessId,
      branchId:     this.activateData.branchId,
      businessName: this.activateData.businessName,
      branchName:   this.activateData.branchName,
      mode:         this.activateData.mode,
      deviceName:   this.deviceName.trim() || 'POS Principal',
      configuredAt: new Date().toISOString(),
    };

    this.configService.saveDeviceConfig(config);
    this.router.navigate(['/pin']);
  }

  //#endregion
}
