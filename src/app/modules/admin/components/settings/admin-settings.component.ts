import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { InputTextModule } from 'primeng/inputtext';
import { PasswordModule } from 'primeng/password';
import { RadioButtonModule } from 'primeng/radiobutton';

import { AppConfig, DEFAULT_APP_CONFIG, DEFAULT_DEVICE_CONFIG, DeviceConfig } from '../../../../core/models';
import { ConfigService } from '../../../../core/services/config.service';

type DeviceMode = DeviceConfig['mode'];

@Component({
  selector: 'app-admin-settings',
  standalone: true,
  imports: [
    FormsModule,
    InputTextModule,
    PasswordModule,
    RadioButtonModule,
  ],
  templateUrl: './admin-settings.component.html',
  styleUrl: './admin-settings.component.scss',
})
export class AdminSettingsComponent implements OnInit {

  //#region Properties

  /** Business config — stored in IndexedDB, shared across all devices */
  config = signal<AppConfig>({ ...DEFAULT_APP_CONFIG });

  /** Device config — stored in localStorage, local to this screen only */
  deviceConfig = signal<DeviceConfig>({ ...DEFAULT_DEVICE_CONFIG });

  /** PIN change fields */
  currentPin = '';
  newPin     = '';
  confirmPin = '';

  readonly isSaving        = signal(false);
  readonly saveSuccess      = signal(false);
  readonly isSavingDevice  = signal(false);
  readonly saveDeviceSuccess = signal(false);
  readonly pinError         = signal('');
  readonly pinSuccess       = signal(false);

  readonly modes: { value: DeviceMode; label: string; icon: string; description: string; badge?: string }[] = [
    { value: 'counter', icon: '🏪', label: 'Mostrador', description: 'Cobra inmediato. Ideal para fondas' },
    { value: 'cashier', icon: '💳', label: 'Cajero',    description: 'Caja rápida sin selector de mesa' },
    { value: 'tables',  icon: '🪑', label: 'Mesas',     description: 'Pantalla fija de mesas compartida' },
    { value: 'waiter',  icon: '🍽️', label: 'Mesero',    description: 'Tablet personal del mesero' },
    { value: 'kitchen', icon: '👨‍🍳', label: 'Cocina',    description: 'Pantalla KDS para la cocina' },
    { value: 'kiosk',   icon: '📱', label: 'Kiosko',    description: 'Autoservicio para el cliente', badge: 'Beta' },
  ];

  //#endregion

  //#region Constructor
  constructor(
    private readonly configService: ConfigService,
    private readonly router: Router,
  ) {}
  //#endregion

  //#region Lifecycle

  async ngOnInit(): Promise<void> {
    const [appConfig] = await Promise.all([
      this.configService.load(),
    ]);
    this.config.set(appConfig);
    this.deviceConfig.set(this.configService.loadDeviceConfig());
  }

  //#endregion

  //#region Business config save

  async saveBusinessConfig(): Promise<void> {
    this.isSaving.set(true);
    this.saveSuccess.set(false);
    await this.configService.save(this.config());
    this.isSaving.set(false);
    this.saveSuccess.set(true);
    setTimeout(() => this.saveSuccess.set(false), 3000);
  }

  /** Updates a field on the business config signal */
  updateConfig<K extends keyof AppConfig>(key: K, value: AppConfig[K]): void {
    this.config.update(c => ({ ...c, [key]: value }));
  }

  //#endregion

  //#region Device config save

  saveAndRedirect(): void {
    this.isSavingDevice.set(true);
    this.configService.saveDeviceConfig(this.deviceConfig());

    const mode = this.deviceConfig().mode;

    switch (mode) {
      case 'tables':
      case 'waiter':
        this.router.navigate(['/tables']);
        break;
      case 'kitchen':
        this.router.navigate(['/kitchen']);
        break;
      case 'kiosk':
        this.router.navigate(['/kiosk/welcome']);
        break;
      default:
        this.router.navigate(['/pos']);
    }
  }

  /** Updates a field on the device config signal */
  updateDeviceConfig<K extends keyof DeviceConfig>(key: K, value: DeviceConfig[K]): void {
    this.deviceConfig.update(c => ({ ...c, [key]: value }));
  }

  //#endregion

  //#region PIN Change

  async changePin(): Promise<void> {
    this.pinError.set('');
    this.pinSuccess.set(false);

    if (!/^\d{4}$/.test(this.newPin)) {
      this.pinError.set('El PIN debe ser de 4 dígitos numéricos.');
      return;
    }

    if (this.newPin !== this.confirmPin) {
      this.pinError.set('Los PINs no coinciden.');
      return;
    }

    const currentValid = await this.configService.verifyPin(this.currentPin);
    if (!currentValid) {
      this.pinError.set('El PIN actual es incorrecto.');
      return;
    }

    await this.configService.updatePin(this.newPin);
    this.currentPin = '';
    this.newPin     = '';
    this.confirmPin = '';
    this.pinSuccess.set(true);
    setTimeout(() => this.pinSuccess.set(false), 3000);
  }

  //#endregion

}
