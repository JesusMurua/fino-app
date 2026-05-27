import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, Injector, OnDestroy, OnInit, ViewChild, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, FormGroup, FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ConfirmationService, MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { DialogModule } from 'primeng/dialog';
import { DropdownModule } from 'primeng/dropdown';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';

import {
  CashRegister,
  DeviceConfig,
  DeviceLimitsDto,
  DeviceListItem,
  DeviceModeQuotaDto,
  GenerateCodeResponse,
  PendingDeviceCodeDto,
} from '../../../../core/models';
import { FeatureKey } from '../../../../core/enums';
import { Branch, BranchService } from '../../../../core/services/branch.service';
import { CashRegisterService } from '../../../../core/services/cash-register.service';
import { DeviceService } from '../../../../core/services/device.service';
import { TenantContextService } from '../../../../core/services/tenant-context.service';
import {
  DynamicFormBuilderService,
  DynamicFormComponent,
  DynamicFormSchema,
  FieldDescriptor,
  SectionDescriptor,
} from 'src/app/shared/forms';
import { ADMIN_DEVICES_CODEGEN_SCHEMA, CodegenFormKey } from './admin-devices-codegen.form';
import { ADMIN_DEVICES_EDIT_SCHEMA, EditFormKey } from './admin-devices-edit.form';

/** Mode option for the activation-code dropdown */
interface ModeOption {
  value: DeviceConfig['mode'] | 'bridge';
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
const MODE_LABELS: Record<DeviceConfig['mode'] | 'bridge', string> = {
  cashier:   'Cajero',
  tables:    'Mesas',
  kitchen:   'Cocina',
  kiosk:     'Kiosko',
  mobile:    'Móvil',
  reception: 'Recepción / Check-in',
  bridge:    'Fino Bridge',
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
    ButtonModule,
    ConfirmDialogModule,
    DialogModule,
    DropdownModule,
    DynamicFormComponent,
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
  private readonly cashRegisterService = inject(CashRegisterService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly deviceService = inject(DeviceService);
  private readonly fb = inject(FormBuilder);
  private readonly builder = inject(DynamicFormBuilderService);
  private readonly injector = inject(Injector);
  private readonly messageService = inject(MessageService);
  private readonly tenantContext = inject(TenantContextService);

  /** Template ref to the codegen <app-dynamic-form> — used to trigger
   *  validation + focus from the external "Generar código" button. */
  @ViewChild('codegenFormRef') private codegenDynamicForm!: DynamicFormComponent<CodegenFormKey>;

  /** Template ref to the edit-dialog <app-dynamic-form> — used to trigger
   *  validation + focus from the dialog footer's "Guardar" button. */
  @ViewChild('editFormRef') private editDynamicForm!: DynamicFormComponent<EditFormKey>;

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
   * True for 2 seconds after the admin clicks the copy button, used to
   * swap the icon `pi pi-copy` ↔ `pi pi-check`. Mirrors the link-code
   * UX in `admin-registers.component.ts` for consistency across the
   * Back Office "code generator" surfaces.
   */
  readonly lastCodeCopied = signal(false);

  /**
   * Monotonic counter that ticks each time `lastGeneratedCode` is replaced.
   * Bound to a `[data-pulse]` attribute on the success card so the CSS
   * scale-pulse animation re-fires for every new generation — gives the
   * admin a clear "this card just changed" signal without overhauling
   * the layout. Same pattern used by the POS shift chip.
   */
  readonly codePulseKey = signal(0);

  /**
   * All cash registers fetched at init — the cashier dropdown filters
   * this list by the currently-selected branch + unlinked status. Cached
   * for the lifetime of the screen since registers are rarely added on
   * the fly. A manual refresh would re-fetch alongside the fleet table.
   */
  readonly cashRegisters = signal<CashRegister[]>([]);

  /**
   * Cash registers the admin can pick from when generating a `cashier`
   * activation code. Filtered to:
   *   - the form's currently-selected branch (a code is always scoped
   *     to one branch, so cross-branch links do not make sense),
   *   - not yet linked to any device (no silent steals).
   *
   * Reads `branchId` from `rawCodegenSnapshot` (the reactive form value
   * signal) — NOT from the composed `codegenSnapshot`, to break the
   * circular dep `codegenSnapshot → availableCashRegistersForBranch
   * → codegenSnapshot`. See `rawCodegenSnapshot` declaration below for
   * the rationale.
   */
  readonly availableCashRegistersForBranch = computed<CashRegister[]>(() => {
    const branchId = (this.rawCodegenSnapshot() as Record<string, unknown>)['branchId'] as number;
    if (!branchId) return [];
    return this.cashRegisters().filter(r =>
      r.branchId === branchId && !r.deviceUuid && r.isActive,
    );
  });

  /** Dropdown options for the cash register picker (label + value pair) */
  readonly cashRegisterOptions = computed(() => [
    { label: '— No vincular caja por ahora —', value: null },
    ...this.availableCashRegistersForBranch().map(r => ({
      label: r.name,
      value: r.id,
    })),
  ]);

  //#endregion

  //#region Device limits (proactive quota UI)

  /**
   * Latest quota envelope from `GET /api/Devices/limits` for the branch
   * currently selected in the form. Re-fetched on init, on branch
   * change, on successful generation, and on revoke / restore so the
   * counter is always trustworthy. `null` while loading or when the
   * fetch failed (counter card is hidden in that case — backend 403
   * stays as the safety net).
   */
  readonly deviceLimits = signal<DeviceLimitsDto | null>(null);
  readonly loadingLimits = signal(false);

  /**
   * Quota row for the mode currently selected in the form. Looked up
   * by `mode` since the backend returns ALL modes the tenant could use
   * — modes outside the plan's coverage simply do not appear in the
   * array and resolve to `null` here, which the UI treats as "no
   * quota information for this mode" and hides the counter.
   */
  readonly currentModeQuota = computed<DeviceModeQuotaDto | null>(() => {
    const limits = this.deviceLimits();
    if (!limits) return null;
    const mode = (this.rawCodegenSnapshot() as Record<string, unknown>)['mode'] as DeviceConfig['mode'] | 'bridge';
    return limits.modes.find(m => m.mode === mode) ?? null;
  });

  /**
   * Tri-state derived from `currentModeQuota` — `null` while quota is
   * unknown so the template can render exactly one of the three
   * variants (unlimited / normal / reached) without a fallback bucket.
   */
  readonly counterState = computed<'unlimited' | 'normal' | 'reached' | null>(() => {
    const q = this.currentModeQuota();
    if (!q) return null;
    if (q.isUnlimited) return 'unlimited';
    if (q.isLimitReached) return 'reached';
    return 'normal';
  });

  /** Convenience flag — true when the submit button must stay disabled. */
  readonly isQuotaLocked = computed(() => this.counterState() === 'reached');

  //#endregion

  /**
   * Reactive form for the activation-code generator. Schema-driven via
   * `DynamicFormBuilderService.buildControls()` + manual `fb.group()`
   * (FDD-032 §5.3 — no formValidators / no async, so buildControls
   * suffices over buildFormGroup).
   *
   * Validators live in the schema (FDD-031 string + ref keys): required,
   * min(1) on branchId; required on mode; required + maxLength(60) +
   * nonBlank on name; no validators on cashRegisterId (visibility gated
   * by the schema's `showWhen` predicate).
   */
  readonly codegenForm: FormGroup = this.fb.group(
    this.builder.buildControls<CodegenFormKey>(ADMIN_DEVICES_CODEGEN_SCHEMA),
  );

  /**
   * Reactive raw snapshot of codegenForm values. toSignal subscribes to
   * valueChanges so any field mutation re-evaluates dependent computeds
   * (availableCashRegistersForBranch, currentModeQuota, codegenSnapshot).
   * Replaces the eliminated selectedBranchSignal / selectedModeSignal
   * mirror pair (FDD-032 §5.1).
   *
   * A plain `computed(() => this.codegenForm.value)` would NOT be
   * reactive — the form value getter isn't tracked by the signal
   * dependency graph. toSignal of valueChanges is the technically
   * correct path.
   */
  private readonly rawCodegenSnapshot = toSignal(this.codegenForm.valueChanges, {
    initialValue: this.codegenForm.value,
    injector: this.injector,
  });

  /**
   * Consumer-provided snapshot for `<app-dynamic-form>`'s [valueSnapshot]
   * input. Composes the raw form snapshot with the `_hasCashRegisters`
   * reserved key the cashRegisterId showWhen predicate consults
   * (FDD-030 OQ1 reserved-key pattern, same shape as admin-users `_edit`).
   *
   * Reading from `rawCodegenSnapshot` (NOT this composed signal) inside
   * `availableCashRegistersForBranch` breaks the otherwise-circular
   * dependency.
   */
  readonly codegenSnapshot = computed<Record<string, unknown>>(() => ({
    ...this.rawCodegenSnapshot(),
    _hasCashRegisters: this.availableCashRegistersForBranch().length > 0,
  }));

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
    // `MaxReceptionsPerBranch` lives only in the Services giro's feature map,
    // so the feature presence alone implies the macro — the previous explicit
    // `=== Services` check was redundant (AUDIT-058 Vector A).
    if (this.tenantContext.hasFeature(FeatureKey.MaxReceptionsPerBranch)) {
      modes.push({ value: 'reception', label: 'Pantalla de Recepción / Check-in', icon: 'pi pi-id-card' });
    }
    // Hardware headless service (available to all plans as Core Infrastructure)
    modes.push({ value: 'bridge', label: 'Fino Bridge', icon: 'pi pi-server' });
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
   * Reactive form for the Edit dialog. Schema-driven via the shared
   * dynamic-form library (FDD-032 §5.3). No showWhen predicates in this
   * schema → no [valueSnapshot] needed on the orchestrator.
   * Whitespace-only names are rejected via the shared 'nonBlank' validator.
   */
  readonly editForm: FormGroup = this.fb.group(
    this.builder.buildControls<EditFormKey>(ADMIN_DEVICES_EDIT_SCHEMA),
  );

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

  //#region Dynamic-form option signals + schemas (FDD-032 Phase 2)

  /** Branches signal mapped to `{label, value}` dropdown options. */
  readonly branchOptions = computed(() =>
    this.branches().map(b => ({ label: b.name, value: b.id })),
  );

  /**
   * Modes signal mapped to `{label, value}` dropdown options. Drops the
   * unused `icon` field — the legacy template referenced `optionLabel="label"`
   * / `optionValue="value"` only, so icons were never rendered. Same UX
   * post-migration.
   */
  readonly modeFormOptions = computed(() =>
    this.modes().map(m => ({ label: m.label, value: m.value })),
  );

  /** Schema for the codegen form with runtime options injected. */
  readonly codegenSchema: DynamicFormSchema<CodegenFormKey> =
    this.injectCodegenOptions(ADMIN_DEVICES_CODEGEN_SCHEMA);

  /** Schema for the edit-dialog form with runtime options injected. */
  readonly editSchema: DynamicFormSchema<EditFormKey> =
    this.injectEditOptions(ADMIN_DEVICES_EDIT_SCHEMA);

  /**
   * Deep-clones the codegen schema with `branchId` / `mode` / `cashRegisterId`
   * dropdowns wired to the consumer's option Signals. `options` accepts a
   * `Signal<readonly Option[]>` (FDD-031 §4.2) — passing the signal
   * REFERENCE (not calling it) lets FormFieldComponent re-render
   * reactively when the underlying data changes.
   */
  private injectCodegenOptions(
    base: DynamicFormSchema<CodegenFormKey>,
  ): DynamicFormSchema<CodegenFormKey> {
    return {
      sections: base.sections.map((section: SectionDescriptor<CodegenFormKey>) => ({
        ...section,
        fields: section.fields.map((field: FieldDescriptor<CodegenFormKey>) => {
          switch (field.key) {
            case 'branchId':       return { ...field, options: this.branchOptions };
            case 'mode':           return { ...field, options: this.modeFormOptions };
            case 'cashRegisterId': return { ...field, options: this.cashRegisterOptions };
            default:               return field;
          }
        }),
      })),
    };
  }

  /** Deep-clones the edit schema with `branchId` wired to branchOptions. */
  private injectEditOptions(
    base: DynamicFormSchema<EditFormKey>,
  ): DynamicFormSchema<EditFormKey> {
    return {
      sections: base.sections.map((section: SectionDescriptor<EditFormKey>) => ({
        ...section,
        fields: section.fields.map((field: FieldDescriptor<EditFormKey>) =>
          field.key === 'branchId'
            ? { ...field, options: this.branchOptions }
            : field,
        ),
      })),
    };
  }

  //#endregion

  //#region Lifecycle

  constructor() {
    // Auto-naming logic that reacts to async quota updates + form selections.
    // Reads from `codegenSnapshot()` (composed reactive snapshot driven by
    // toSignal of valueChanges) — replaces the eliminated mirror signals.
    // `setValue({ emitEvent: false })` avoids re-triggering valueChanges →
    // rawCodegenSnapshot → this effect, which would loop. Trade-off:
    // rawCodegenSnapshot stays stale for `name` until the user types or
    // another mutation fires valueChanges. Harmless because no consumer
    // reads `snapshot['name']`.
    effect(() => {
      const snapshot = this.codegenSnapshot();
      const mode = snapshot['mode'] as DeviceConfig['mode'] | 'bridge' | undefined;
      const branchId = snapshot['branchId'] as number | undefined;
      const quota = this.currentModeQuota();

      if (this.codegenForm.controls['name'].dirty || !branchId || !mode) return;

      const branch = this.branches().find(b => b.id === branchId);
      const branchName = branch?.name || '';
      const modeLabel = this.modeLabel(mode);

      // Formatting: Bridge doesn't need a number. Others get Usage + 1.
      let autoName = mode === 'bridge'
        ? `${modeLabel} ${branchName}`
        : `${modeLabel} ${branchName} ${(quota?.usage || 0) + 1}`;

      // Clean double spaces and truncate to avoid validation errors
      autoName = autoName.replace(/\s+/g, ' ').trim().substring(0, 60);

      if (this.codegenForm.controls['name'].value !== autoName) {
        this.codegenForm.controls['name'].setValue(autoName, { emitEvent: false });
      }
    });
  }

  async ngOnInit(): Promise<void> {
    // Imperative side-effect subscriptions on valueChanges. These STAY
    // (FDD-032 §5.3 boundary): rawCodegenSnapshot replaces mirror signals
    // for reactive computeds, but API calls + control mutations don't
    // fit a computed pattern and remain explicit subscriptions.
    this.codegenForm.controls['branchId'].valueChanges.subscribe(value => {
      // Reset the cash-register pick whenever the branch changes — the
      // previously-selected register may belong to the old branch.
      this.codegenForm.controls['cashRegisterId'].setValue(null);
      // Quotas are per-branch — re-fetch so the counter card reflects
      // the new context. Skipped when the branch is reset to 0 during
      // form clears.
      if (value && value > 0) {
        void this.loadDeviceLimits(value);
      }
    });
    this.codegenForm.controls['mode'].valueChanges.subscribe(value => {
      // Non-cashier modes do not use a register; clear any stale pick
      // so we never POST `cashRegisterId` for a kitchen / kiosk code.
      if (value !== 'cashier') {
        this.codegenForm.controls['cashRegisterId'].setValue(null);
      }
    });

    // Load branches, devices, pending codes AND cash registers in parallel
    // so the dropdown is ready by first paint instead of populating after
    // an extra round-trip.
    await Promise.all([
      this.loadBranches(),
      this.loadDevices(),
      this.loadPendingCodes(),
      this.loadCashRegisters(),
    ]);

    const first = this.branches()[0];
    if (first) this.codegenForm.controls['branchId'].setValue(first.id);

    // Tick every minute so status badges / relative-time labels
    // refresh without re-fetching over the network.
    this.tickInterval = setInterval(() => {
      this.nowTick.set(Date.now());
    }, NOW_TICK_INTERVAL_MS);
  }

  /**
   * Loads cash registers once at init. Errors are non-fatal — the
   * dropdown simply stays empty (`showCashRegisterPicker` returns
   * false) so the form remains operable for activation without
   * register pre-binding.
   */
  private async loadCashRegisters(): Promise<void> {
    try {
      const list = await this.cashRegisterService.getRegisters();
      this.cashRegisters.set(list);
    } catch (error) {
      console.warn('[AdminDevices] Failed to load cash registers:', error);
    }
  }

  /**
   * Loads per-mode quotas for `branchId`. Errors resolve to `null` so
   * the counter card hides instead of showing stale or wrong data —
   * the backend's 403 on `/device/generate-code` remains the
   * authoritative safety net.
   */
  private async loadDeviceLimits(branchId: number): Promise<void> {
    if (!branchId || branchId <= 0) return;
    this.loadingLimits.set(true);
    try {
      const limits = await firstValueFrom(this.deviceService.getDeviceLimits(branchId));
      this.deviceLimits.set(limits);
    } catch (error) {
      console.warn('[AdminDevices] Failed to load device limits:', error);
      this.deviceLimits.set(null);
    } finally {
      this.loadingLimits.set(false);
    }
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
  /** Footer-button click — delegates validation + focus to the orchestrator. */
  onGenerateClick(): void {
    this.codegenDynamicForm.submit();
  }

  /**
   * Triggered by `<app-dynamic-form>` (submitted) when the codegen form
   * is valid. The orchestrator already enforced validity, so the
   * `if (form.invalid) markAllAsTouched + return` guards from the legacy
   * imperative flow are gone.
   */
  async onCodegenSubmitted(value: Record<CodegenFormKey, unknown>): Promise<void> {
    if (this.generatingCode()) return;

    const branchId = value['branchId'] as number;
    const mode = value['mode'] as DeviceConfig['mode'] | 'bridge';
    const name = value['name'] as string;
    const cashRegisterId = value['cashRegisterId'] as number | null;

    // Only forward `cashRegisterId` to the backend for cashier-mode codes.
    // Other modes never have a meaningful register selection (the field
    // is hidden in the UI for them via showWhen), so omitting the property
    // keeps the payload tight and unambiguous.
    const payload = mode === 'cashier' && cashRegisterId !== null
      ? { branchId, mode, name: name.trim(), cashRegisterId }
      : { branchId, mode, name: name.trim() };

    this.generatingCode.set(true);
    this.lastGeneratedCode.set(null);

    try {
      const response = await firstValueFrom(
        this.deviceService.generateCode(payload),
      );
      this.lastGeneratedCode.set(response);
      this.codePulseKey.update(v => v + 1);
      this.codegenForm.reset({
        branchId: 0,
        mode: 'cashier',
        name: '',
        cashRegisterId: null,
      });
      const first = this.branches()[0];
      if (first) this.codegenForm.controls['branchId'].setValue(first.id);
      await this.loadPendingCodes();
      // Pull the freshest quota — the new pending code counts toward
      // `usage` per the backend so the counter must reflect it before
      // the admin can issue another. Scoped to the branch we just
      // generated for so a stale signal from a previous branch does
      // not bleed into the new context.
      await this.loadDeviceLimits(branchId);
      // Confirmation toast — clarifies the form has been cleared so the
      // admin does not wonder why their inputs disappeared while the
      // success card up top shows the freshly minted code.
      this.messageService.add({
        severity: 'success',
        summary: 'Código generado',
        detail: 'Formulario listo para el siguiente código.',
        life: 2500,
      });
    } catch (error) {
      console.error('[AdminDevices] Failed to generate activation code:', error);
      this.handleGenerateError(error);
    } finally {
      this.generatingCode.set(false);
    }
  }

  /**
   * Copies the freshly generated activation code to the clipboard. The
   * "copied" flag flips for 2 s so the icon swaps `pi pi-copy` →
   * `pi pi-check` and back. Falls back to a warn toast when the
   * Clipboard API is unavailable (older browsers / insecure contexts).
   *
   * @param code Activation code value rendered in the success card
   */
  async copyActivationCode(code: string): Promise<void> {
    if (!code) return;

    try {
      await navigator.clipboard.writeText(code);
      this.lastCodeCopied.set(true);
      setTimeout(() => this.lastCodeCopied.set(false), 2000);
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
      // Revoking frees a quota seat, restoring consumes one — re-fetch
      // so the counter card and submit lockout reflect reality before
      // the admin tries to issue the next code.
      const branchId = (this.rawCodegenSnapshot() as Record<string, unknown>)['branchId'] as number;
      if (branchId > 0) {
        await this.loadDeviceLimits(branchId);
      }
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

  /** Dialog footer "Guardar" click — delegates to the edit orchestrator. */
  onEditSaveClick(): void {
    this.editDynamicForm.submit();
  }

  /**
   * Triggered by the edit-dialog `<app-dynamic-form>` (submitted) when
   * the form is valid. Persists the form via PATCH and replaces the row
   * in place on success.
   */
  async onEditSubmitted(value: Record<EditFormKey, unknown>): Promise<void> {
    const device = this.editingDevice();
    if (!device || this.savingEdit()) return;

    const name = value['name'] as string;
    const branchId = value['branchId'] as number;
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
  modeLabel(mode: DeviceConfig['mode'] | 'bridge'): string {
    return MODE_LABELS[mode] ?? mode;
  }

  //#endregion

  //#region Template helpers

  /** TrackBy so a single-row patch does not rebuild the entire table DOM */
  trackByDeviceId = (_: number, device: DeviceListItem): number => device.id;

  /** TrackBy for the pending-codes table — the 6-digit code is unique */
  trackByPendingCode = (_: number, row: PendingDeviceCodeDto): string => row.code;

  //#endregion

}
