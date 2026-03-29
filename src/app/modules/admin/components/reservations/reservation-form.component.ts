import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges, inject, signal } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { MessageService } from 'primeng/api';
import { CalendarModule } from 'primeng/calendar';
import { DialogModule } from 'primeng/dialog';
import { DropdownModule } from 'primeng/dropdown';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { InputTextareaModule } from 'primeng/inputtextarea';

import { Reservation, RestaurantTable } from '../../../../core/models';
import { AuthService } from '../../../../core/services/auth.service';
import { ReservationService } from '../../../../core/services/reservation.service';
import { TableService } from '../../../../core/services/table.service';

@Component({
  selector: 'app-reservation-form',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    CalendarModule,
    DialogModule,
    DropdownModule,
    InputNumberModule,
    InputTextModule,
    InputTextareaModule,
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
  private readonly reservationService = inject(ReservationService);
  private readonly tableService = inject(TableService);
  private readonly authService = inject(AuthService);
  private readonly messageService = inject(MessageService);

  readonly tables = signal<RestaurantTable[]>([]);
  readonly availabilityWarning = signal('');
  readonly isSaving = signal(false);

  readonly durationOptions = [
    { label: '1 hora', value: 60 },
    { label: '1.5 horas', value: 90 },
    { label: '2 horas', value: 120 },
    { label: '3 horas', value: 180 },
  ];

  form!: FormGroup;

  //#endregion

  //#region Lifecycle

  constructor() {
    this.form = this.fb.group({
      guestName: ['', Validators.required],
      guestPhone: [''],
      partySize: [2, [Validators.required, Validators.min(1)]],
      reservationDate: [null as Date | null, Validators.required],
      reservationTime: [null as Date | null, Validators.required],
      durationMinutes: [90, Validators.required],
      tableId: [null as number | null],
      notes: [''],
    });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['visible'] && this.visible) {
      this.loadTables();
      this.availabilityWarning.set('');

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
          tableId: this.reservation.tableId,
          notes: this.reservation.notes ?? '',
        });
      } else {
        this.form.reset({
          guestName: '',
          guestPhone: '',
          partySize: 2,
          reservationDate: new Date(),
          reservationTime: null,
          durationMinutes: 90,
          tableId: null,
          notes: '',
        });
      }
    }
  }

  //#endregion

  //#region Data Loading

  /** Loads branch tables for the dropdown */
  private async loadTables(): Promise<void> {
    try {
      const tables = await this.tableService.getTables(this.authService.branchId);
      this.tables.set(tables);
    } catch {
      this.tables.set([]);
    }
  }

  //#endregion

  //#region Availability Check

  /** Checks table availability when table/date/time changes */
  async checkAvailability(): Promise<void> {
    const { tableId, reservationDate, reservationTime, durationMinutes } = this.form.value;
    if (!tableId || !reservationDate || !reservationTime) {
      this.availabilityWarning.set('');
      return;
    }

    const dateStr = this.formatDate(reservationDate);
    const timeStr = this.formatTime(reservationTime);
    const excludeId = this.reservation?.id;

    try {
      const result = await firstValueFrom(
        this.reservationService.checkAvailability(
          tableId, dateStr, timeStr, durationMinutes, excludeId,
        ),
      );
      this.availabilityWarning.set(
        result.available ? '' : 'Esta mesa no está disponible en ese horario',
      );
    } catch {
      this.availabilityWarning.set('');
    }
  }

  //#endregion

  //#region Save

  /** Saves the reservation (create or update) */
  async onSave(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.isSaving.set(true);
    const v = this.form.value;

    const dto = {
      tableId: v.tableId ?? null,
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

  //#endregion

  //#region Dialog

  /** Closes the dialog */
  onClose(): void {
    this.visibleChange.emit(false);
  }

  //#endregion

  //#region Helpers

  /** Formats a Date to YYYY-MM-DD */
  private formatDate(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  /** Formats a Date to HH:mm:ss */
  private formatTime(date: Date): string {
    const h = String(date.getHours()).padStart(2, '0');
    const m = String(date.getMinutes()).padStart(2, '0');
    return `${h}:${m}:00`;
  }

  //#endregion

}
