import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ConfirmationService, MessageService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { DialogModule } from 'primeng/dialog';
import { DropdownModule } from 'primeng/dropdown';
import { InputSwitchModule } from 'primeng/inputswitch';
import { InputTextModule } from 'primeng/inputtext';
import { TooltipModule } from 'primeng/tooltip';

import { CashRegister, DeviceListItem, GenerateLinkCodeResponse } from '../../../../core/models';
import { FeatureKey } from '../../../../core/enums';
import { AuthService } from '../../../../core/services/auth.service';
import { CashRegisterService } from '../../../../core/services/cash-register.service';
import { DeviceService } from '../../../../core/services/device.service';
import { TenantContextService } from '../../../../core/services/tenant-context.service';

/** Shape of the register form used in create/edit dialog */
interface RegisterForm {
  name: string;
  isActive: boolean;
  /**
   * UUID of the device this register should be linked to. `null` means
   * "do not link / unlink current". Only meaningful in edit mode (a new
   * register has nothing to link yet — that flow goes through device
   * activation or the link-code path).
   */
  deviceUuid: string | null;
}

@Component({
  selector: 'app-admin-registers',
  standalone: true,
  imports: [
    FormsModule,
    ConfirmDialogModule,
    DialogModule,
    DropdownModule,
    InputSwitchModule,
    InputTextModule,
    TooltipModule,
  ],
  providers: [ConfirmationService],
  templateUrl: './admin-registers.component.html',
  styleUrl: './admin-registers.component.scss',
})
export class AdminRegistersComponent implements OnInit, OnDestroy {

  //#region Injections

  private readonly cashRegisterService = inject(CashRegisterService);
  private readonly authService = inject(AuthService);
  private readonly deviceService = inject(DeviceService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly messageService = inject(MessageService);
  private readonly tenantContext = inject(TenantContextService);

  //#endregion

  //#region Properties

  readonly registers = signal<CashRegister[]>([]);
  readonly isLoading = signal(false);
  readonly showDialog = signal(false);
  readonly editingRegister = signal<CashRegister | null>(null);
  readonly isSaving = signal(false);
  readonly nameError = signal('');

  /**
   * Active cashier-mode devices for the editing register's branch. Loaded
   * lazily when the edit dialog opens — the create dialog never lists
   * devices because a not-yet-persisted register has no id to link to.
   */
  readonly branchDevices = signal<DeviceListItem[]>([]);
  readonly loadingBranchDevices = signal(false);

  form: RegisterForm = this.emptyForm();

  /**
   * Dropdown options for the "Dispositivo Vinculado" picker.
   *
   * Keeps the list deliberately narrow:
   *   - device must be active (revoked devices cannot operate a caja)
   *   - device must be in cashier mode (kitchen / kiosk / reception have
   *     no cash drawer concept)
   *   - device must be either unlinked anywhere OR currently linked to
   *     THIS register (so the dropdown always shows the current binding
   *     even though it is technically "linked"). Devices linked to OTHER
   *     registers are hidden — preventing silent steals from the
   *     backoffice.
   *
   * Plus a sentinel "Ninguno / Desvincular" entry so the admin can
   * explicitly break the binding from this surface.
   */
  readonly deviceOptions = computed<{ label: string; value: string | null }[]>(() => {
    const reg = this.editingRegister();
    if (!reg) return [{ label: '— Ninguno / Desvincular —', value: null }];

    const eligible = this.branchDevices().filter(d =>
      d.isActive
      && d.mode === 'cashier'
      && !this.isLinkedToOtherRegister(d.deviceUuid, reg.id),
    );

    return [
      { label: '— Ninguno / Desvincular —', value: null },
      ...eligible.map(d => ({ label: d.name, value: d.deviceUuid })),
    ];
  });

  /**
   * True when the given device UUID is currently bound to a register
   * other than the one being edited. Hides cross-linked devices from
   * the dropdown so the admin cannot silently re-home them.
   *
   * Reads from the local `registers()` snapshot — accurate for this
   * branch as long as the snapshot was loaded recently. Concurrent
   * mutations from another admin session would only become visible
   * after the next refresh, which matches the rest of this screen's
   * staleness model.
   */
  private isLinkedToOtherRegister(deviceUuid: string, currentRegisterId: number): boolean {
    return this.registers().some(r =>
      r.id !== currentRegisterId
      && r.deviceUuid === deviceUuid,
    );
  }

  /**
   * True when the user can add a NEW cash register.
   *   - Always true if the tenant has the MultiTill feature.
   *   - Otherwise true only when zero registers exist yet (every business
   *     needs to create their first one — that's Core, not Premium).
   */
  readonly canAddRegister = computed(() =>
    this.tenantContext.hasFeature(FeatureKey.MultiTill) || this.registers().length === 0,
  );

  //#endregion

  //#region Link Code Dialog

  /** Visibility of the link-code dialog */
  readonly showLinkCodeDialog = signal(false);

  /** True while the API call to mint a code is in flight */
  readonly generatingLinkCode = signal(false);

  /** Register the dialog is currently scoped to (drives header copy) */
  readonly linkCodeRegister = signal<CashRegister | null>(null);

  /**
   * Fresh code returned by the backend. Read by the dialog body so the
   * admin can dictate the digits to the cashier. Null while no dialog
   * is open / during the in-flight request.
   */
  readonly linkCodeData = signal<GenerateLinkCodeResponse | null>(null);

  /**
   * Seconds left until the displayed code expires. Live-updates via a
   * 1 s interval that we tear down on dialog close / component
   * destroy. Reaches 0 → dialog stays open but copy hints "expired".
   */
  readonly linkCodeSecondsLeft = signal(0);

  /** Toggled once the admin clicks the copy button so the icon flips */
  readonly linkCodeCopied = signal(false);

  /** Interval handle for the countdown — cleared on close/destroy */
  private linkCodeTimer: ReturnType<typeof setInterval> | null = null;

  //#endregion

  //#region Lifecycle

  ngOnInit(): void {
    this.loadRegisters();
  }

  //#endregion

  //#region Data Loading

  async loadRegisters(): Promise<void> {
    this.isLoading.set(true);
    try {
      const data = await this.cashRegisterService.getRegisters();
      this.registers.set(data);
    } catch {
      this.messageService.add({
        severity: 'error',
        summary: 'Error',
        detail: 'No se pudieron cargar las cajas registradoras.',
        life: 5000,
      });
    } finally {
      this.isLoading.set(false);
    }
  }

  //#endregion

  //#region Dialog Methods

  openCreateDialog(): void {
    this.editingRegister.set(null);
    this.form = this.emptyForm();
    this.branchDevices.set([]);
    this.nameError.set('');
    this.showDialog.set(true);
  }

  /**
   * Opens the edit dialog and kicks off a parallel fetch of cashier
   * devices for the register's branch. The dropdown stays in a loading
   * state until devices arrive, but the dialog itself is interactive
   * immediately so the admin can edit name/active without waiting for
   * the device list.
   */
  openEditDialog(register: CashRegister): void {
    this.editingRegister.set(register);
    this.form = {
      name: register.name,
      isActive: register.isActive,
      deviceUuid: register.deviceUuid ?? null,
    };
    this.nameError.set('');
    this.branchDevices.set([]);
    this.showDialog.set(true);
    void this.loadBranchDevices(register.branchId);
  }

  /**
   * Fetches the active cashier devices for a branch and stores the
   * result so the dropdown can reactively populate. Errors resolve to
   * an empty list — the admin will only see the "Ninguno / Desvincular"
   * option, which is still useful for explicitly unlinking.
   */
  private async loadBranchDevices(branchId: number): Promise<void> {
    this.loadingBranchDevices.set(true);
    try {
      const list = await firstValueFrom(this.deviceService.getAll({ branchId }));
      this.branchDevices.set(list);
    } catch (error) {
      console.warn('[AdminRegisters] Failed to load branch devices:', error);
      this.branchDevices.set([]);
    } finally {
      this.loadingBranchDevices.set(false);
    }
  }

  async saveRegister(): Promise<void> {
    const name = this.form.name.trim();
    if (!name) {
      this.nameError.set('El nombre es obligatorio.');
      return;
    }
    this.nameError.set('');

    const editing = this.editingRegister();

    // ---- Create flow (no device picker, no diff) ----
    if (!editing) {
      this.isSaving.set(true);
      try {
        await this.cashRegisterService.createRegister(name, this.form.isActive);
        this.messageService.add({
          severity: 'success',
          summary: 'Caja creada',
          detail: `"${name}" se creó correctamente.`,
          life: 3000,
        });
        this.showDialog.set(false);
        await this.loadRegisters();
      } catch {
        this.messageService.add({
          severity: 'error',
          summary: 'Error',
          detail: 'No se pudo guardar la caja. Verifica tu conexión.',
          life: 5000,
        });
      } finally {
        this.isSaving.set(false);
      }
      return;
    }

    // ---- Edit flow ----
    // Detect what changed so we can issue exactly the right calls in
    // the right order. The device change is the only one that may
    // require an interstitial confirm (open-session guard).
    const nameChanged   = name !== editing.name;
    const activeChanged = this.form.isActive !== editing.isActive;
    const previousUuid  = editing.deviceUuid ?? null;
    const nextUuid      = this.form.deviceUuid ?? null;
    const deviceChanged = previousUuid !== nextUuid;

    const proceed = deviceChanged
      ? await this.confirmDeviceChangeIfSessionOpen(editing)
      : true;
    if (!proceed) return;

    await this.commitEdit(editing.id, name, this.form.isActive,
      { nameChanged, activeChanged, deviceChanged, nextUuid });
  }

  /**
   * Sequential commit per AUDIT-049 Phase 5: update first, then
   * link/unlink. Each step has its own toast so the admin sees
   * partial success clearly. On link/unlink failure we keep the
   * dialog open with the device dropdown rolled back to the previous
   * value so the admin can retry without re-entering name/active.
   */
  private async commitEdit(
    registerId: number,
    name: string,
    isActive: boolean,
    diff: {
      nameChanged: boolean;
      activeChanged: boolean;
      deviceChanged: boolean;
      nextUuid: string | null;
    },
  ): Promise<void> {
    this.isSaving.set(true);

    // Step 1 — update the basic fields. Skipped only if absolutely
    // nothing about name/active changed AND a device change is
    // pending (so we still need to do step 2).
    if (diff.nameChanged || diff.activeChanged) {
      try {
        await this.cashRegisterService.updateRegister(registerId, { name, isActive });
        this.messageService.add({
          severity: 'success',
          summary: 'Caja actualizada',
          detail: `"${name}" se actualizó correctamente.`,
          life: 3000,
        });
      } catch {
        this.messageService.add({
          severity: 'error',
          summary: 'Error',
          detail: 'No se pudo actualizar la caja. Verifica tu conexión.',
          life: 5000,
        });
        this.isSaving.set(false);
        return;
      }
    }

    // Step 2 — link / unlink the device. Only fires when the dropdown
    // selection actually changed.
    if (diff.deviceChanged) {
      try {
        if (diff.nextUuid === null) {
          await this.cashRegisterService.unlinkDevice(registerId);
          this.messageService.add({
            severity: 'info',
            summary: 'Dispositivo desvinculado',
            detail: `"${name}" ya no está vinculada a ningún dispositivo.`,
            life: 3500,
          });
        } else {
          await this.cashRegisterService.linkDevice(registerId, diff.nextUuid);
          this.messageService.add({
            severity: 'success',
            summary: 'Dispositivo vinculado',
            detail: `"${name}" ahora está asignada al dispositivo seleccionado.`,
            life: 3500,
          });
        }
      } catch {
        // Roll the dropdown back so the next attempt is consistent
        // with what's actually in the backend.
        const editing = this.editingRegister();
        this.form = {
          ...this.form,
          deviceUuid: editing?.deviceUuid ?? null,
        };
        this.messageService.add({
          severity: 'error',
          summary: 'Error al vincular',
          detail: 'No se pudo cambiar el dispositivo. Inténtalo de nuevo.',
          life: 5000,
        });
        this.isSaving.set(false);
        return;
      }
    }

    this.showDialog.set(false);
    await this.loadRegisters();
    this.isSaving.set(false);
  }

  /**
   * Open-session guard for the device reassignment flow.
   *
   * Strategy (hybrid A + B per AUDIT-049 Phase 5):
   *   1. If `register.hasOpenSession` is populated by the backend,
   *      decide locally without an extra round-trip.
   *   2. Otherwise fall back to a session fetch and check whether the
   *      currently-open session belongs to this register.
   *
   * Returns `true` when the admin confirmed (or no session exists)
   * and the save can proceed; `false` when the admin cancelled.
   */
  private async confirmDeviceChangeIfSessionOpen(register: CashRegister): Promise<boolean> {
    let hasOpenSession = register.hasOpenSession;

    if (hasOpenSession === undefined) {
      try {
        const branchId = this.authService.branchId;
        const session = await this.cashRegisterService.getOpenSession(branchId);
        hasOpenSession = session !== null && session.cashRegisterId === register.id;
      } catch {
        // If we cannot determine session state, skip the confirm —
        // worse to block the admin than to risk a soft warning miss.
        hasOpenSession = false;
      }
    }

    if (!hasOpenSession) return true;

    return new Promise<boolean>(resolve => {
      this.confirmationService.confirm({
        key: 'register-device-reassign',
        header: '¿Cambiar el dispositivo?',
        message: 'Esta caja tiene un turno abierto. Al cambiar el dispositivo, '
          + 'el iPad actual quedará bloqueado y el nuevo recogerá la sesión '
          + 'al siguiente refresco. ¿Continuar?',
        icon: 'pi pi-exclamation-triangle',
        acceptLabel: 'Sí, cambiar',
        rejectLabel: 'Cancelar',
        acceptButtonStyleClass: 'p-button-warning',
        accept: () => resolve(true),
        reject: () => resolve(false),
      });
    });
  }

  //#endregion

  //#endregion

  //#region Link Code Methods

  /**
   * Asks the backend to mint a fresh pairing code for the given register
   * and shows the dialog with the result. Fires from the per-row link
   * icon (only rendered when the register is unlinked).
   */
  async openLinkCodeDialog(register: CashRegister): Promise<void> {
    if (this.generatingLinkCode()) return;

    this.linkCodeRegister.set(register);
    this.linkCodeCopied.set(false);
    this.generatingLinkCode.set(true);
    this.linkCodeData.set(null);
    this.showLinkCodeDialog.set(true);

    try {
      const data = await this.cashRegisterService.generateLinkCode(register.id);
      this.linkCodeData.set(data);
      this.startLinkCodeCountdown(data.expiresAt);
    } catch {
      this.messageService.add({
        severity: 'error',
        summary: 'Error',
        detail: 'No se pudo generar el código de vinculación.',
        life: 5000,
      });
      this.showLinkCodeDialog.set(false);
      this.linkCodeRegister.set(null);
    } finally {
      this.generatingLinkCode.set(false);
    }
  }

  /** Closes the dialog and tears down the countdown interval */
  closeLinkCodeDialog(): void {
    this.showLinkCodeDialog.set(false);
    this.linkCodeRegister.set(null);
    this.linkCodeData.set(null);
    this.linkCodeCopied.set(false);
    this.linkCodeSecondsLeft.set(0);
    this.stopLinkCodeCountdown();
  }

  /**
   * Copies the active code to the clipboard. The "copied" state flag
   * resets after 2 s so the icon can flicker between copy / check on
   * repeated clicks. Falls back gracefully when the Clipboard API is
   * unavailable (older browsers / insecure contexts).
   */
  async copyLinkCode(): Promise<void> {
    const code = this.linkCodeData()?.code;
    if (!code) return;

    try {
      await navigator.clipboard.writeText(code);
      this.linkCodeCopied.set(true);
      setTimeout(() => this.linkCodeCopied.set(false), 2000);
    } catch {
      this.messageService.add({
        severity: 'warn',
        summary: 'No se pudo copiar',
        detail: 'Cópialo manualmente desde la pantalla.',
        life: 3000,
      });
    }
  }

  /**
   * Drives the live countdown shown in the dialog. Recalculates every
   * second so the admin sees urgency build as the code approaches its
   * expiration. Replaces any prior timer so a re-open does not leak
   * intervals.
   */
  private startLinkCodeCountdown(expiresAt: string): void {
    this.stopLinkCodeCountdown();
    const expiry = new Date(expiresAt).getTime();
    const tick = (): void => {
      const remaining = Math.max(0, Math.floor((expiry - Date.now()) / 1000));
      this.linkCodeSecondsLeft.set(remaining);
      if (remaining <= 0) this.stopLinkCodeCountdown();
    };
    tick();
    this.linkCodeTimer = setInterval(tick, 1000);
  }

  private stopLinkCodeCountdown(): void {
    if (this.linkCodeTimer !== null) {
      clearInterval(this.linkCodeTimer);
      this.linkCodeTimer = null;
    }
  }

  /** "M:SS" formatter for the countdown chip */
  formatCountdown(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  //#endregion

  //#region Lifecycle

  ngOnDestroy(): void {
    this.stopLinkCodeCountdown();
  }

  //#endregion

  //#region Helpers

  private emptyForm(): RegisterForm {
    return { name: '', isActive: true, deviceUuid: null };
  }

  //#endregion
}
