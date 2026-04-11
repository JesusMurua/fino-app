import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { MessageService } from 'primeng/api';
import { DropdownModule } from 'primeng/dropdown';
import { TableModule } from 'primeng/table';

import { DeviceConfig } from '../../../../core/models';
import { ApiService } from '../../../../core/services/api.service';
import { Branch, BranchService } from '../../../../core/services/branch.service';

/** Mode option for the activation-code dropdown */
interface ModeOption {
  value: DeviceConfig['mode'];
  label: string;
  icon: string;
}

/**
 * Dedicated Back Office screen for managing provisioned devices.
 *
 * Phase 9.3 scope:
 *   - Generate 6-digit activation codes for new devices (migrated from
 *     the Device tab of admin-settings where it was improperly placed).
 *   - Placeholder list for provisioned devices — the backend `GET
 *     /api/devices` endpoint is not available yet, so the UI shows a
 *     "Coming Soon" card that can be replaced with a real table once
 *     the endpoint lands.
 */
@Component({
  selector: 'app-admin-devices',
  standalone: true,
  imports: [
    FormsModule,
    DropdownModule,
    TableModule,
  ],
  templateUrl: './admin-devices.component.html',
  styleUrl: './admin-devices.component.scss',
})
export class AdminDevicesComponent implements OnInit {

  //#region Injections

  private readonly api = inject(ApiService);
  private readonly branchService = inject(BranchService);
  private readonly messageService = inject(MessageService);

  //#endregion

  //#region State

  readonly branches = signal<Branch[]>([]);
  readonly loadingBranches = signal(false);

  /** Currently displayed activation code — blank until `generateActivationCode()` resolves */
  readonly activationCode = signal('');
  readonly generatingCode = signal(false);

  /** Form values for the activation code generator */
  codeBranchId = 0;
  codeMode: DeviceConfig['mode'] = 'cashier';

  /**
   * All four operating modes the backend supports. No filtering by
   * branch flags — the admin may legitimately provision any mode on
   * any branch, and mode/branch coherence is validated server-side.
   */
  readonly modes: readonly ModeOption[] = [
    { value: 'cashier', label: '💳 Cajero',  icon: '💳' },
    { value: 'tables',  label: '🪑 Mesas',   icon: '🪑' },
    { value: 'kitchen', label: '👨‍🍳 Cocina',  icon: '👨‍🍳' },
    { value: 'kiosk',   label: '📱 Kiosko',  icon: '📱' },
  ];

  //#endregion

  //#region Lifecycle

  async ngOnInit(): Promise<void> {
    await this.loadBranches();
    const first = this.branches()[0];
    if (first) this.codeBranchId = first.id;
  }

  //#endregion

  //#region Branches

  /** Loads the business's branches into the dropdown */
  async loadBranches(): Promise<void> {
    this.loadingBranches.set(true);
    try {
      const list = await this.branchService.getAll();
      this.branches.set(list);
    } catch (error) {
      console.error('[AdminDevices] Failed to load branches:', error);
      this.messageService.add({
        severity: 'error',
        summary: 'Error',
        detail: 'No se pudieron cargar las sucursales',
        life: 4000,
      });
    } finally {
      this.loadingBranches.set(false);
    }
  }

  //#endregion

  //#region Activation Code

  /**
   * Generates a 6-digit activation code for the selected branch/mode.
   * The code is valid for 24 hours on the backend side.
   */
  async generateActivationCode(): Promise<void> {
    if (this.generatingCode() || !this.codeBranchId) return;

    this.generatingCode.set(true);
    this.activationCode.set('');

    try {
      const response = await firstValueFrom(
        this.api.post<{ code: string }>('/device/generate-code', {
          branchId: this.codeBranchId,
          mode: this.codeMode,
        }),
      );
      this.activationCode.set(response.code);
    } catch (error) {
      console.error('[AdminDevices] Failed to generate activation code:', error);
      this.messageService.add({
        severity: 'error',
        summary: 'Error',
        detail: 'No se pudo generar el código',
        life: 4000,
      });
    } finally {
      this.generatingCode.set(false);
    }
  }

  //#endregion

  //#region Template helpers

  /** Display name for the currently selected branch */
  codeBranchLabel(): string {
    return this.branches().find(b => b.id === this.codeBranchId)?.name ?? '';
  }

  /** Display label for the currently selected mode */
  codeModeLabel(): string {
    return this.modes.find(m => m.value === this.codeMode)?.label ?? this.codeMode;
  }

  //#endregion

}
