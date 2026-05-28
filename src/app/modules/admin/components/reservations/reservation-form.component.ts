import { Component, EventEmitter, Input, OnChanges, Output, Signal, SimpleChanges, computed, inject, signal } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { filter, take } from 'rxjs/operators';
import { MessageService } from 'primeng/api';
import { CalendarModule } from 'primeng/calendar';
import { DialogModule } from 'primeng/dialog';
import { DropdownModule } from 'primeng/dropdown';
import { InputTextModule } from 'primeng/inputtext';
import { InputTextareaModule } from 'primeng/inputtextarea';

import { Customer, Reservation, RestaurantTable } from '../../../../core/models';
import { AuthService } from '../../../../core/services/auth.service';
import { CustomerSelectorComponent } from '../../../../shared/components/customer-selector/customer-selector.component';
import { formatCustomerName } from '../../../../shared/pipes/customer-name.pipe';
import { ReservationService } from '../../../../core/services/reservation.service';
import { TableService } from '../../../../core/services/table.service';
import { ZoneService } from '../../../../core/services/zone.service';
import {
  DynamicFormBuilderService,
  DynamicFormSchema,
  FieldDescriptor,
  FORM_WIDGETS,
  FormFieldComponent,
  FormWidgetRegistration,
  SectionDescriptor,
} from 'src/app/shared/forms';

import { ChipGroup, ChipSelectComponent } from './widgets/chip-select.widget';
import { ReservationAvailabilityService } from './services/reservation-availability.service';
import { RESERVATION_FORM_SCHEMA, ReservationFormKey } from './reservation-form.form';

/** A zone group with its tables for the chip selector */
interface TableZoneGroup {
  zoneName: string;
  tables: { id: number; name: string; capacity?: number }[];
}

@Component({
  selector: 'app-reservation-form',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    CalendarModule,
    DialogModule,
    DropdownModule,
    InputTextModule,
    InputTextareaModule,
    CustomerSelectorComponent,
    FormFieldComponent,
  ],
  providers: [
    // Register ChipSelectWidget as a component-level FORM_WIDGETS multi-provider.
    // NOTE: cannot use `provideFormWidget('chip-select', ChipSelectWidget)` here
    // because that factory returns `EnvironmentProviders` (for app/route-level
    // configuration). Component-level `providers: []` requires `Provider[]`
    // shape. Both forms register the same FORM_WIDGETS multi-token; consumers
    // pick the scope that matches their registration point.
    {
      provide: FORM_WIDGETS,
      useValue: { name: 'chip-select', component: ChipSelectComponent } satisfies FormWidgetRegistration,
      multi: true,
    },
  ],
  templateUrl: './reservation-form.component.html',
  styleUrl: './reservation-form.component.scss',
})
export class ReservationFormComponent implements OnChanges {

  //#region Inputs & Outputs

  @Input() visible = false;
  @Input() reservation: Reservation | null = null;
  @Output() visibleChange = new EventEmitter<boolean>();
  @Output() saved = new EventEmitter<void>();

  //#endregion

  //#region Properties

  private readonly fb = inject(FormBuilder);
  private readonly builder = inject(DynamicFormBuilderService);
  private readonly availabilityService = inject(ReservationAvailabilityService);
  private readonly reservationService = inject(ReservationService);
  private readonly tableService = inject(TableService);
  private readonly zoneService = inject(ZoneService);
  private readonly authService = inject(AuthService);
  private readonly messageService = inject(MessageService);

  /** Constant id used to namespace input ids across this form. */
  readonly formId = 'reservation-form';

  /**
   * Customer linked to this reservation (optional CRM integration).
   * Stays OUTSIDE the FormGroup per FDD-032 §4.3 deviation —
   * `CustomerSelectorComponent` is used directly, not wrapped in a FormWidget.
   * Save flow reads `selectedCustomer()?.id` when assembling the DTO.
   */
  readonly selectedCustomer = signal<Customer | null>(null);

  readonly tables = signal<RestaurantTable[]>([]);
  readonly noTableAssigned = signal(false);
  readonly isSaving = signal(false);

  /** Tables grouped by zone for the chip selector */
  readonly zoneGroups = computed<TableZoneGroup[]>(() => {
    const tables = this.tables();
    const zones = this.zoneService.getActiveZones();
    const zoneMap = new Map<number, string>();
    zones.forEach(z => zoneMap.set(z.id, z.name));

    const groups = new Map<string, { id: number; name: string; capacity?: number }[]>();

    for (const t of tables) {
      const zoneName = t.zoneId ? (zoneMap.get(t.zoneId) ?? 'Sin zona') : 'Sin zona';
      if (!groups.has(zoneName)) groups.set(zoneName, []);
      groups.get(zoneName)!.push({ id: t.id, name: t.name, capacity: t.capacity });
    }

    // Follow zone sort order
    const result: TableZoneGroup[] = [];
    for (const zone of zones) {
      const g = groups.get(zone.name);
      if (g) {
        result.push({ zoneName: zone.name, tables: g });
        groups.delete(zone.name);
      }
    }
    // Remaining groups (no zone match)
    for (const [zoneName, tbls] of groups) {
      result.push({ zoneName, tables: tbls });
    }

    return result;
  });

  readonly durationOptions = [
    { label: '1 hora', value: 60 },
    { label: '1.5 horas', value: 90 },
    { label: '2 horas', value: 120 },
    { label: '3 horas', value: 180 },
  ];

  /**
   * Reservation form (FDD-032 Phase 3 — hybrid pattern). Schema-driven
   * fields built via `buildFormGroup()`; raw-rendered controls added
   * imperatively below (Path Y per OQ7).
   */
  readonly form: FormGroup = this.builder.buildFormGroup(RESERVATION_FORM_SCHEMA);

  /**
   * Maps the existing `zoneGroups` computed (`TableZoneGroup[]`) → readonly
   * `ChipGroup[]` for the chip-select widget. Pure shape transform.
   */
  readonly tableChipGroups = computed<readonly ChipGroup[]>(() =>
    this.zoneGroups().map(g => ({
      groupLabel: g.zoneName,
      chips: g.tables.map(t => ({
        label: t.name,
        value: t.id,
        subLabel: t.capacity ? `${t.capacity}` : undefined,
      })),
    })),
  );

  /** Schema with runtime options injected into tableId + durationMinutes. */
  readonly schemaWithOptions: DynamicFormSchema<ReservationFormKey> =
    this.injectReservationOptions(RESERVATION_FORM_SCHEMA);

  /**
   * Map (field-key → descriptor) used by the template to bind
   * `<app-form-field>` inputs without re-traversing the schema.
   */
  readonly fieldByKey = computed(() => {
    const map = new Map<ReservationFormKey, FieldDescriptor<ReservationFormKey>>();
    for (const section of this.schemaWithOptions.sections) {
      for (const field of section.fields) {
        map.set(field.key as ReservationFormKey, field);
      }
    }
    return map;
  });

  //#endregion

  //#region Lifecycle

  constructor() {
    // Path Y per FDD-032 OQ7: raw-rendered controls are NOT in the schema;
    // consumer adds them imperatively post-buildFormGroup so they share the
    // same FormGroup as the schema-driven fields. Validators here come
    // directly from @angular/forms (NOT schema refs) since these fields
    // have no descriptor.
    this.form.addControl('partySize',
      this.fb.control(2, [Validators.required, Validators.min(1)]));
    this.form.addControl('reservationDate',
      this.fb.control<Date | null>(null, Validators.required));
    this.form.addControl('reservationTime',
      this.fb.control<Date | null>(null, Validators.required));
  }

  /**
   * Injects runtime options into the schema. The cast at `tableId`
   * preserves the `Signal<...>` discriminator that `FormFieldComponent.resolvedOptions`
   * uses to detect reactive vs static options. Platform widening of
   * `FieldDescriptor.options` is out of scope for FDD-032 Phase 3.
   */
  private injectReservationOptions(
    base: DynamicFormSchema<ReservationFormKey>,
  ): DynamicFormSchema<ReservationFormKey> {
    return {
      ...base,
      sections: base.sections.map((section: SectionDescriptor<ReservationFormKey>) => ({
        ...section,
        fields: section.fields.map((field: FieldDescriptor<ReservationFormKey>) => {
          switch (field.key) {
            case 'tableId':
              return {
                ...field,
                options: this.tableChipGroups as unknown as
                  Signal<readonly { label: string; value: unknown }[]>,
              };
            case 'durationMinutes':
              return { ...field, options: this.durationOptions };
            default:
              return field;
          }
        }),
      })),
    };
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['visible'] && this.visible) {
      this.loadTables();

      // Wire async validator's edit-mode self-collision skip BEFORE
      // patchValue, so the initial validator run sees the right id.
      this.availabilityService.setCurrentReservationId(this.reservation?.id ?? null);

      if (this.reservation) {
        const [h, m] = this.reservation.reservationTime.split(':').map(Number);
        const timeDate = new Date();
        timeDate.setHours(h, m, 0, 0);

        this.form.patchValue({
          guestName: this.reservation.guestName,
          guestPhone: this.reservation.guestPhone ?? '',
          partySize: this.reservation.partySize,
          reservationDate: new Date(this.reservation.reservationDate + 'T00:00:00'),
          reservationTime: timeDate,
          durationMinutes: this.reservation.durationMinutes,
          notes: this.reservation.notes ?? '',
          tableId: this.reservation.tableId,
        });
        this.noTableAssigned.set(!this.reservation.tableId);
      } else {
        this.form.reset({
          guestName: '',
          guestPhone: '',
          partySize: 2,
          reservationDate: new Date(),
          reservationTime: null,
          durationMinutes: 90,
          notes: '',
          tableId: null,
        });
        this.noTableAssigned.set(true);
      }
    }
  }

  //#endregion

  //#region Data Loading

  private async loadTables(): Promise<void> {
    try {
      // Ensure zones are loaded for grouping
      if (this.zoneService.getActiveZones().length === 0) {
        await this.zoneService.loadZones();
      }

      let tables = await this.tableService.getTables(this.authService.branchId);
      if (tables.length === 0) {
        await this.tableService.loadTables(this.authService.branchId);
        tables = await this.tableService.getTables(this.authService.branchId);
      }
      this.tables.set(tables);
    } catch {
      this.tables.set([]);
    }
  }

  //#endregion

  //#region Table Selection

  /**
   * Toggles "sin mesa asignada". Sets the form's `tableId` to null so the
   * async availability validator stays inactive (it returns `of(null)`
   * when tableId is null).
   */
  toggleNoTable(): void {
    this.noTableAssigned.set(true);
    this.form.controls['tableId'].setValue(null);
  }

  /** Custom party size increment/decrement */
  adjustPartySize(delta: number): void {
    const current = this.form.get('partySize')!.value ?? 2;
    const next = Math.max(1, Math.min(50, current + delta));
    this.form.get('partySize')!.setValue(next);
  }

  //#endregion

  //#region Customer

  /** Maps a selected customer to the guestName/guestPhone form fields */
  onCustomerChanged(customer: Customer | null): void {
    this.selectedCustomer.set(customer);
    if (customer) {
      this.form.patchValue({
        guestName: formatCustomerName(customer),
        guestPhone: customer.phone,
      });
    }
  }

  //#endregion

  //#region Save

  async onSave(): Promise<void> {
    this.form.markAllAsTouched();

    // Wait for any pending async validators (availability check) before
    // deciding valid/invalid. Multiple controls can be PENDING in parallel —
    // wait until the FormGroup's status leaves PENDING.
    if (this.form.pending) {
      await firstValueFrom(
        this.form.statusChanges.pipe(filter(s => s !== 'PENDING'), take(1)),
      );
    }

    if (this.form.invalid) {
      this.focusFirstInvalid();
      return;
    }

    this.isSaving.set(true);
    const v = this.form.value;

    const dto = {
      tableId: this.noTableAssigned() ? null : (v.tableId ?? null),
      customerId: this.selectedCustomer()?.id ?? null,
      guestName: v.guestName,
      guestPhone: v.guestPhone || null,
      partySize: v.partySize,
      reservationDate: this.formatDate(v.reservationDate),
      reservationTime: this.formatTime(v.reservationTime),
      durationMinutes: v.durationMinutes,
      notes: v.notes || null,
    };

    try {
      if (this.reservation) {
        await firstValueFrom(this.reservationService.update(this.reservation.id, dto));
        this.messageService.add({ severity: 'success', summary: 'Reservación actualizada', life: 3000 });
      } else {
        await firstValueFrom(this.reservationService.create(dto));
        this.messageService.add({ severity: 'success', summary: 'Reservación creada', life: 3000 });
      }
      this.saved.emit();
    } catch {
      this.messageService.add({ severity: 'error', summary: 'Error al guardar', life: 3000 });
    } finally {
      this.isSaving.set(false);
    }
  }

  /**
   * Focuses the first invalid input. Schema fields use `${formId}-${key}`
   * ids (set by FormFieldComponent OR the chip-select widget's host binding).
   * Raw fields use `rf-${rawKey}` ids set explicitly in the template.
   */
  private focusFirstInvalid(): void {
    for (const section of this.schemaWithOptions.sections) {
      for (const field of section.fields) {
        const ctrl = this.form.get(field.key as string);
        if (ctrl?.invalid) {
          const el = document.getElementById(`${this.formId}-${field.key}`);
          if (el instanceof HTMLElement) el.focus();
          return;
        }
      }
    }
    for (const rawKey of ['partySize', 'reservationDate', 'reservationTime']) {
      if (this.form.get(rawKey)?.invalid) {
        const el = document.getElementById(`rf-${rawKey}`);
        if (el instanceof HTMLElement) el.focus();
        return;
      }
    }
  }

  //#endregion

  //#region Dialog

  onClose(): void {
    this.visibleChange.emit(false);
  }

  //#endregion

  //#region Helpers

  private formatDate(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  private formatTime(date: Date): string {
    const h = String(date.getHours()).padStart(2, '0');
    const m = String(date.getMinutes()).padStart(2, '0');
    return `${h}:${m}:00`;
  }

  //#endregion

}
