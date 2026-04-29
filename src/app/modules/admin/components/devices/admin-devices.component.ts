import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule, ReactiveFormsModule, Validators, AbstractControl, ValidationErrors, NonNullableFormBuilder } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ConfirmationService, MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { DialogModule } from 'primeng/dialog';
import { DropdownModule } from 'primeng/dropdown';
import { InputTextModule } from 'primeng/inputtext';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';

import {
  DeviceConfig,
  DeviceListItem,
  GenerateCodeResponse,
  PendingDeviceCodeDto,
} from '../../../../core/models';
import { FeatureKey, MacroCategoryType } from '../../../../core/enums';
import { Branch, BranchService } from '../../../../core/services/branch.service';
import { DeviceService } from '../../../../core/services/device.service';
import { TenantContextService } from '../../../../core/services/tenant-context.service';

/** Mode option for the activation-code dropdown */
interface ModeOption {
  value: DeviceConfig['mode'];
  label: string;
  icon: string;
}

/** Shape of the branch filter options (label + id OR null for "all") */
interface BranchFilterOption {
  label: string;
  value: number | null;
}

/** Status derivation bucket for the Status column */
type DeviceStatus = 'online' | 'offline' | 'revoked';

/** Tick interval used to refresh relative-time labels (1 minute). */
const NOW_TICK_INTERVAL_MS = 60_000;

/** Freshness window for the Online badge (10 minutes). */
const ONLINE_WINDOW_MS = 10 * 60_000;

/** Human-readable labels for the mode column */
const MODE_LABELS: Record<DeviceConfig['mode'], string> = {
  cashier:   'Cajero',
  tables:    'Mesas',
  kitchen:   'Cocina',
  kiosk:     'Kiosko',
  mobile:    'Móvil',
  reception: 'Recepción / Check-in',
};

/**
 * Back Office screen for managing provisioned devices.
 *
 * Two sections:
 *   1. Activation code generator — issues 6-digit codes that the terminal
 *      consumes in its setup flow (code-flow), with the admin pre-configuring
 *      branch, mode and name so the terminal is fully zero-friction.
 *   2. Fleet table — lists every device linked to the tenant with live
 *      status badges, a branch filter, and per-row Edit and Revoke actions.
 */
@Component({
  selector: 'app-admin-devices',
  standalone: true,
  imports: [
    DatePipe,
    FormsModule,
    ReactiveFormsModule,
    ButtonModule,
    ConfirmDialogModule,
    DialogModule,
    DropdownModule,
    InputTextModule,
    TableModule,
    TagModule,
    TooltipModule,
  ],
  providers: [ConfirmationService],
  templateUrl: './admin-devices.component.html',
  styleUrl: './admin-devices.component.scss',
})
export class AdminDevicesComponent implements OnInit, OnDestroy {

  //#region Injections

  private readonly branchService = inject(BranchService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly deviceService = inject(DeviceService);
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly messageService = inject(MessageService);
  private readonly tenantContext = inject(TenantContextService);

  //#endregion

  //#region Branches & activation code state

  readonly branches = signal<Branch[]>([]);
  readonly loadingBranches = signal(false);

  /**
   * Snapshot of the most recently generated code. Powers the success card
   * shown right under the form — the card reads from this signal (not from
   * the form) so that resetting the form post-generation does not blank
   * the on-screen summary.
   */
  readonly lastGeneratedCode = signal<GenerateCodeResponse | null>(null);
  readonly generatingCode = signal(false);

  /**
   * Reactive form for the activation-code generator.
   *
   * Validators mirror the backend constraints: a positive `branchId`
   * (defaulting to `0` would slip past `Validators.required`), one of the
   * known device modes, and a non-blank human-readable name capped at the
   * column length used by the backend.
   */
  readonly generateForm = this.fb.group({
    branchId: this.fb.control(0, [Validators.required, Validators.min(1)]),
    mode: this.fb.control<DeviceConfig['mode']>('cashier', [Validators.required]),
    name: this.fb.control('', [
      Validators.required,
      Validators.maxLength(60),
      AdminDevicesComponent.nonBlankValidator,
    ]),
  });

  /**
   * Device mode options, filtered dynamically by the tenant's active
   * features. Cashier is always available; the rest require the matching
   * quantitative feature key from the monetization architecture.
   *
   * Note on quantitative keys: `MaxKdsScreens`, `MaxKiosks` and
   * `MaxReceptionsPerBranch` are emitted by the backend on every plan,
   * even when the cap is 0. Their *presence* in the JWT means "this
   * mode exists for your vertical"; the *actual quota* is enforced
   * server-side via 403 on `/device/generate-code`. Treating presence
   * as visibility (instead of capacity) is intentional — Free tenants
   * can discover the upsell path and the 403 toast handles the rest.
   *
   * `reception` (member check-in) layers two checks:
   *   1. Macro gate — only Services tenants see the option, so other
   *      macros (FoodBeverage, QuickService, Retail) never get a member
   *      check-in screen they can't actually use. We gate on macro rather
   *      than sub-category because the JWT does not yet carry the
   *      `subCategory` claim and the backend already restricts the
   *      `MaxReceptionsPerBranch` feature flag to the Services macro at
   *      issue time.
   *   2. Feature gate — `MaxReceptionsPerBranch` must be present in the
   *      JWT features claim. Without it the option stays hidden
   *      regardless of vertical.
   */
  readonly modes = computed<ModeOption[]>(() => {
    const modes: ModeOption[] = [
      { value: 'cashier', label: 'Cajero', icon: 'pi pi-credit-card' },
    ];
    if (this.tenantContext.hasAnyFeature([FeatureKey.TableMap, FeatureKey.WaiterApp])) {
      modes.push({ value: 'tables', label: 'Mesas', icon: 'pi pi-th-large' });
    }
    if (this.tenantContext.hasFeature(FeatureKey.MaxKdsScreens)) {
      modes.push({ value: 'kitchen', label: 'Cocina', icon: 'pi pi-box' });
    }
    if (this.tenantContext.hasFeature(FeatureKey.MaxKiosks)) {
      modes.push({ value: 'kiosk', label: 'Kiosko', icon: 'pi pi-mobile' });
    }
    const isServices = this.tenantContext.currentMacro() === MacroCategoryType.Services;
    if (isServices && this.tenantContext.hasFeature(FeatureKey.MaxReceptionsPerBranch)) {
      modes.push({ value: 'reception', label: 'Pantalla de Recepción / Check-in', icon: 'pi pi-id-card' });
    }
    return modes;
  });

  //#endregion

  //#region Fleet list state

  /** Rows shown in the fleet table */
  readonly devices = signal<DeviceListItem[]>([]);

  /** True during the initial load (drives `<p-table [loading]>`) */
  readonly loadingDevices = signal(true);

  /** True during a manual refresh / filter change (spinner on the button) */
  readonly refreshingDevices = signal(false);

  /** Current branch filter — `null` means "Todas las sucursales" */
  readonly branchFilterId = signal<number | null>(null);

  /** Tick source for relative-time labels (re-evaluated by computeds reading it) */
  readonly nowTick = signal(Date.now());
  private tickInterval: ReturnType<typeof setInterval> | null = null;

  /** Row id currently being toggled; other rows keep their action buttons enabled */
  readonly togglingDeviceId = signal<number | null>(null);

  //#endregion

  //#region Pending-codes state

  /** Activation codes issued but not yet redeemed by a device */
  readonly pendingCodes = signal<PendingDeviceCodeDto[]>([]);

  /** True while `GET /api/device/pending-codes` is in flight */
  readonly loadingPending = signal(false);

  //#endregion

  //#region Edit dialog state

  /** Device currently under edit; `null` while the dialog is hidden */
  readonly editingDevice = signal<DeviceListItem | null>(null);

  /** Controls `<p-dialog [visible]>` visibility */
  readonly editDialogVisible = signal(false);

  /** True while `PATCH /api/devices/{id}` is in flight */
  readonly savingEdit = signal(false);

  /**
   * Reactive form for the Edit dialog.
   * Whitespace-only names are rejected via the `nonBlank` validator so an
   * accidental space-bar commit does not wipe the device label server-side.
   */
  readonly editForm = this.fb.group({
    name: this.fb.control('', [
      Validators.required,
      Validators.maxLength(60),
      AdminDevicesComponent.nonBlankValidator,
    ]),
    branchId: this.fb.control(0, [
      Validators.required,
      Validators.min(1),
    ]),
  });

  //#endregion

  //#region Fleet computeds

  readonly totalCount   = computed(() => this.devices().length);
  readonly onlineCount  = computed(() => this.devices().filter(d => this.statusOf(d) === 'online').length);
  readonly offlineCount = computed(() => this.devices().filter(d => this.statusOf(d) === 'offline').length);
  readonly revokedCount = computed(() => this.devices().filter(d => !d.isActive).length);
  readonly hasDevices   = computed(() => this.devices().length > 0);

  /** Show the branch filter only when the tenant has more than one branch */
  readonly showBranchFilter = computed(() => this.branches().length >= 2);

  /** Options for the branch filter dropdown — includes the sentinel "all branches" entry */
  readonly branchFilterOptions = computed<BranchFilterOption[]>(() => [
    { label: 'Todas las sucursales', value: null },
    ...this.branches().map(b => ({ label: b.name, value: b.id })),
  ]);

  //#endregion

  //#region Lifecycle

  async ngOnInit(): Promise<void> {
    // Load branches, devices and pending codes in parallel so first paint
    // has the full picture without sequential round-trips.
    await Promise.all([
      this.loadBranches(),
      this.loadDevices(),
      this.loadPendingCodes(),
    ]);

    const first = this.branches()[0];
    if (first) this.generateForm.controls.branchId.setValue(first.id);

    // Tick every minute so status badges / relative-time labels
    // refresh without re-fetching over the network.
    this.tickInterval = setInterval(() => {
      this.nowTick.set(Date.now());
    }, NOW_TICK_INTERVAL_MS);
  }

  ngOnDestroy(): void {
    if (this.tickInterval !== null) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
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
   * Generates a 6-digit activation code for the form's branch/mode/name.
   *
   * Three side-effects on success:
   *   1. Stores the enriched response in `lastGeneratedCode` so the
   *      summary card can render `code`, `name`, `branchName`, `mode`
   *      and `expiresAt` without depending on the form (which is reset
   *      below).
   *   2. Resets the form, keeping the default mode of `cashier` so the
   *      next code can be issued without re-typing common fields.
   *   3. Refreshes the pending-codes table so the new entry shows up
   *      immediately under the form.
   *
   * On HTTP 403 (plan limit exceeded) the backend message is surfaced
   * verbatim — the interceptor only handles 401/402 globally, so this
   * 403 path stays scoped to the device-limit semantics for this screen.
   */
  async generateActivationCode(): Promise<void> {
    if (this.generatingCode()) return;
    if (this.generateForm.invalid) {
      this.generateForm.markAllAsTouched();
      return;
    }

    const { branchId, mode, name } = this.generateForm.getRawValue();
    const payload = { branchId, mode, name: name.trim() };

    this.generatingCode.set(true);
    this.lastGeneratedCode.set(null);

    try {
      const response = await firstValueFrom(
        this.deviceService.generateCode(payload),
      );
      this.lastGeneratedCode.set(response);
      this.generateForm.reset({ branchId: 0, mode: 'cashier', name: '' });
      const first = this.branches()[0];
      if (first) this.generateForm.controls.branchId.setValue(first.id);
      await this.loadPendingCodes();
    } catch (error) {
      console.error('[AdminDevices] Failed to generate activation code:', error);
      this.handleGenerateError(error);
    } finally {
      this.generatingCode.set(false);
    }
  }

  /**
   * Surfaces the backend's plan-limit message on 403, falling back to a
   * generic toast for every other failure mode (network, 5xx, etc.).
   * The fallback chain `message ?? detail` covers both the project's
   * usual `{ message }` envelope and the .NET `ProblemDetails` shape.
   */
  private handleGenerateError(error: unknown): void {
    if (error instanceof HttpErrorResponse && error.status === 403) {
      const body = error.error as { message?: string; detail?: string } | null;
      const detail = body?.message
        ?? body?.detail
        ?? 'Has alcanzado el límite de dispositivos de tu plan.';
      this.messageService.add({
        severity: 'error',
        summary: 'Límite alcanzado',
        detail,
        life: 6000,
      });
      return;
    }

    this.messageService.add({
      severity: 'error',
      summary: 'Error',
      detail: 'No se pudo generar el código',
      life: 4000,
    });
  }

  //#endregion

  //#region Pending codes

  /**
   * Loads (or reloads) the pending-codes list, honoring the current
   * `branchFilterId` so the table stays in sync with the fleet table
   * when the admin scopes the view to a single branch.
   */
  async loadPendingCodes(): Promise<void> {
    this.loadingPending.set(true);
    try {
      const branchId = this.branchFilterId();
      const list = await firstValueFrom(
        this.deviceService.getPendingCodes(branchId ?? undefined),
      );
      this.pendingCodes.set(list);
    } catch (error) {
      console.error('[AdminDevices] Failed to load pending codes:', error);
      this.messageService.add({
        severity: 'error',
        summary: 'Error',
        detail: 'No se pudieron cargar los códigos pendientes',
        life: 4000,
      });
    } finally {
      this.loadingPending.set(false);
    }
  }

  //#endregion

  //#region Fleet loading

  /**
   * Loads (or reloads) the device list, honoring the current `branchFilterId`.
   *
   * Two loading modes:
   *   - Initial (refreshing = false): drives `loadingDevices` so the table
   *     shows its skeleton rows.
   *   - Manual / filter-change (refreshing = true): drives `refreshingDevices`
   *     so the button spinner fires while the table keeps stale rows visible.
   */
  async loadDevices(options: { refreshing?: boolean } = {}): Promise<void> {
    const { refreshing = false } = options;

    if (refreshing) {
      this.refreshingDevices.set(true);
    } else {
      this.loadingDevices.set(true);
    }

    try {
      const branchId = this.branchFilterId();
      const params = branchId != null ? { branchId } : undefined;
      const list = await firstValueFrom(this.deviceService.getAll(params));
      this.devices.set(list);
    } catch (error) {
      console.error('[AdminDevices] Failed to load devices:', error);
      this.messageService.add({
        severity: 'error',
        summary: 'Error',
        detail: 'No se pudieron cargar los dispositivos',
        life: 4000,
      });
    } finally {
      if (refreshing) {
        this.refreshingDevices.set(false);
      } else {
        this.loadingDevices.set(false);
      }
    }
  }

  /** Re-fires both fleet and pending-codes loads without changing the filter */
  refresh(): void {
    this.loadDevices({ refreshing: true });
    this.loadPendingCodes();
  }

  /**
   * Handler for the branch filter dropdown. Drives both the fleet table
   * and the pending-codes table so the admin's mental model — "I'm
   * looking at branch X" — applies consistently across the page.
   */
  onBranchFilterChange(value: number | null): void {
    this.branchFilterId.set(value);
    this.loadDevices({ refreshing: true });
    this.loadPendingCodes();
  }

  //#endregion

  //#region Revoke / Restore

  /**
   * Opens a confirmation dialog before flipping the device's `isActive`.
   * Copy and severity swap between "Revocar" and "Reactivar" based on
   * the current state.
   */
  confirmToggle(device: DeviceListItem): void {
    const goingToRevoke = device.isActive;

    this.confirmationService.confirm({
      key: 'device-toggle',
      header: goingToRevoke ? '¿Revocar este dispositivo?' : '¿Reactivar este dispositivo?',
      message: goingToRevoke
        ? `«${device.name}» quedará desconectado y su sesión será inválida al siguiente request.`
        : `«${device.name}» volverá a aceptar comandos del backend.`,
      icon: goingToRevoke ? 'pi pi-ban' : 'pi pi-refresh',
      acceptLabel: goingToRevoke ? 'Revocar' : 'Reactivar',
      rejectLabel: 'Cancelar',
      acceptButtonStyleClass: goingToRevoke ? 'p-button-danger' : 'p-button-success',
      accept: () => this.toggleDeviceActive(device),
    });
  }

  /** Fires the PATCH, merges the response back into the row, toasts. */
  private async toggleDeviceActive(device: DeviceListItem): Promise<void> {
    if (this.togglingDeviceId() !== null) return;
    this.togglingDeviceId.set(device.id);

    try {
      const response = await firstValueFrom(this.deviceService.toggleActive(device.id));
      this.devices.update(list =>
        list.map(d => d.id === device.id ? { ...d, isActive: response.isActive } : d),
      );
      this.messageService.add({
        severity: 'success',
        summary: response.isActive ? 'Dispositivo reactivado' : 'Dispositivo revocado',
        life: 3000,
      });
    } catch (error) {
      console.error('[AdminDevices] Failed to toggle device:', error);
      this.messageService.add({
        severity: 'error',
        summary: 'Error',
        detail: 'No se pudo cambiar el estado',
        life: 4000,
      });
    } finally {
      this.togglingDeviceId.set(null);
    }
  }

  //#endregion

  //#region Edit dialog

  /** Opens the edit dialog with the row's current values patched into the form */
  openEditDialog(device: DeviceListItem): void {
    this.editingDevice.set(device);
    this.editForm.reset({
      name: device.name,
      branchId: device.branchId,
    });
    this.editDialogVisible.set(true);
  }

  /** Resets the edit dialog state — called both manually and from (onHide) */
  closeEditDialog(): void {
    if (this.savingEdit()) return;
    this.editDialogVisible.set(false);
    this.editingDevice.set(null);
  }

  /** Handler bound to `(visibleChange)` so PrimeNG's internal close keeps state in sync */
  onEditDialogVisibleChange(visible: boolean): void {
    this.editDialogVisible.set(visible);
    if (!visible) this.editingDevice.set(null);
  }

  /** Persists the form via PATCH and replaces the row in place on success */
  async saveEdit(): Promise<void> {
    const device = this.editingDevice();
    if (!device || this.savingEdit()) return;

    if (this.editForm.invalid) {
      this.editForm.markAllAsTouched();
      return;
    }

    const { name, branchId } = this.editForm.getRawValue();
    const payload = { name: name.trim(), branchId };

    this.savingEdit.set(true);

    try {
      const updated = await firstValueFrom(
        this.deviceService.update(device.id, payload),
      );
      this.devices.update(list => list.map(d => d.id === device.id ? updated : d));
      this.messageService.add({
        severity: 'success',
        summary: 'Dispositivo actualizado',
        life: 3000,
      });
      this.editDialogVisible.set(false);
      this.editingDevice.set(null);
    } catch (error) {
      console.error('[AdminDevices] Failed to update device:', error);
      this.messageService.add({
        severity: 'error',
        summary: 'Error',
        detail: 'No se pudo actualizar el dispositivo',
        life: 4000,
      });
    } finally {
      this.savingEdit.set(false);
    }
  }

  //#endregion

  //#region Status & relative-time helpers

  /**
   * Derives the 3-state status for a device per FDD-015 §3.1 FR-002.
   * Reads `nowTick()` so consumers re-evaluate when the minute ticks.
   */
  statusOf(device: DeviceListItem): DeviceStatus {
    if (!device.isActive) return 'revoked';
    if (!device.lastSeenAt) return 'offline';
    const lastSeen = new Date(device.lastSeenAt).getTime();
    const elapsed = this.nowTick() - lastSeen;
    return elapsed < ONLINE_WINDOW_MS ? 'online' : 'offline';
  }

  /**
   * Renders a Spanish-localized relative time for the Last Seen column.
   * Returns `—` for devices that have never heartbeated.
   */
  relativeTime(iso: string | null): string {
    if (!iso) return '—';

    const now = this.nowTick();
    const then = new Date(iso).getTime();
    const diff = now - then;

    if (diff < 60_000) return 'hace unos segundos';

    const mins = Math.floor(diff / 60_000);
    if (mins < 60) return `hace ${mins} min`;

    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `hace ${hrs} h`;

    const days = Math.floor(hrs / 24);
    if (days === 1) return 'ayer';
    if (days < 7) return `hace ${days} días`;

    return new Date(iso).toLocaleDateString('es');
  }

  /** Screen-reader text for the status cell (combines badge + last-seen hint) */
  statusAriaLabel(device: DeviceListItem): string {
    const status = this.statusOf(device);
    const statusLabel = status === 'online' ? 'En línea'
      : status === 'offline' ? 'Desconectado'
      : 'Revocado';
    const seen = this.relativeTime(device.lastSeenAt);
    return seen === '—'
      ? `Estado: ${statusLabel}, nunca visto`
      : `Estado: ${statusLabel}, visto ${seen}`;
  }

  /** Human label for the Mode column */
  modeLabel(mode: DeviceConfig['mode']): string {
    return MODE_LABELS[mode] ?? mode;
  }

  //#endregion

  //#region Template helpers

  /** TrackBy so a single-row patch does not rebuild the entire table DOM */
  trackByDeviceId = (_: number, device: DeviceListItem): number => device.id;

  /** TrackBy for the pending-codes table — the 6-digit code is unique */
  trackByPendingCode = (_: number, row: PendingDeviceCodeDto): string => row.code;

  //#endregion

  //#region Validators

  /** Rejects whitespace-only strings so a literal "   " does not pass `required` */
  private static nonBlankValidator(control: AbstractControl): ValidationErrors | null {
    const value = control.value;
    if (typeof value !== 'string') return null;
    return value.trim().length === 0 ? { required: true } : null;
  }

  //#endregion

}
