import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { DatePipe } from '@angular/common';
import { firstValueFrom } from 'rxjs';
import { MessageService } from 'primeng/api';
import { DialogModule } from 'primeng/dialog';
import { FullCalendarModule } from '@fullcalendar/angular';
import { CalendarOptions, EventClickArg } from '@fullcalendar/core';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin from '@fullcalendar/interaction';

import { Reservation, ReservationStatus } from '../../../../core/models';
import { ReservationService } from '../../../../core/services/reservation.service';
import { ReservationFormComponent } from './reservation-form.component';

@Component({
  selector: 'app-reservations',
  standalone: true,
  imports: [DatePipe, DialogModule, FullCalendarModule, ReservationFormComponent],
  templateUrl: './reservations.component.html',
  styleUrl: './reservations.component.scss',
})
export class ReservationsComponent implements OnInit {

  //#region Properties

  private readonly reservationService = inject(ReservationService);
  private readonly messageService = inject(MessageService);

  readonly activeTab = signal<'calendar' | 'day'>('calendar');
  readonly selectedDate = signal(new Date());
  readonly reservations = signal<Reservation[]>([]);
  readonly dayReservations = signal<Reservation[]>([]);
  readonly isLoading = signal(false);

  // ---- Form dialog ----
  readonly showForm = signal(false);
  readonly editingReservation = signal<Reservation | null>(null);

  //#endregion

  //#region Computeds

  /** Day reservations sorted by time */
  readonly sortedDayReservations = computed(() =>
    [...this.dayReservations()].sort((a, b) =>
      a.reservationTime.localeCompare(b.reservationTime),
    ),
  );

  //#endregion

  //#region FullCalendar Config

  readonly calendarOptions = signal<CalendarOptions>({
    plugins: [dayGridPlugin, interactionPlugin],
    initialView: 'dayGridMonth',
    locale: 'es',
    headerToolbar: {
      left: 'prev,next today',
      center: 'title',
      right: '',
    },
    buttonText: { today: 'Hoy' },
    height: 'auto',
    dateClick: (info: any) => this.onDateClick(info),
    eventClick: (info: EventClickArg) => this.onEventClick(info),
    events: [],
    datesSet: (info) => {
      const midDate = new Date((info.start.getTime() + info.end.getTime()) / 2);
      this.loadMonthReservations(midDate.getFullYear(), midDate.getMonth() + 1);
    },
  });

  //#endregion

  //#region Lifecycle

  async ngOnInit(): Promise<void> {
    const now = new Date();
    await this.loadMonthReservations(now.getFullYear(), now.getMonth() + 1);
  }

  //#endregion

  //#region Data Loading

  /** Loads reservations for the calendar month view */
  async loadMonthReservations(year: number, month: number): Promise<void> {
    try {
      const data = await firstValueFrom(this.reservationService.getByMonth(year, month));
      this.reservations.set(data);
      this.updateCalendarEvents(data);
    } catch {
      console.warn('[Reservations] Failed to load month data');
    }
  }

  /** Loads reservations for the selected day */
  async loadDayReservations(): Promise<void> {
    this.isLoading.set(true);
    try {
      const data = await firstValueFrom(
        this.reservationService.getByDay(this.selectedDate()),
      );
      this.dayReservations.set(data);
    } catch {
      console.warn('[Reservations] Failed to load day data');
    } finally {
      this.isLoading.set(false);
    }
  }

  //#endregion

  //#region Calendar Events

  /** Maps reservations to FullCalendar event objects */
  private updateCalendarEvents(reservations: Reservation[]): void {
    const events = reservations
      .filter(r => r.status !== 'Cancelled' && r.status !== 'NoShow')
      .map(r => ({
        id: String(r.id),
        title: `${r.guestName} — ${r.partySize} pax — ${r.tableName ?? 'Sin mesa'}`,
        start: `${r.reservationDate}T${r.reservationTime}`,
        backgroundColor: this.getStatusColor(r.status),
        borderColor: this.getStatusColor(r.status),
        extendedProps: { reservation: r },
      }));

    this.calendarOptions.update(opts => ({ ...opts, events }));
  }

  //#endregion

  //#region Tab & Navigation

  /** Switches to day view for a specific date */
  switchToDay(date: Date): void {
    this.selectedDate.set(date);
    this.activeTab.set('day');
    this.loadDayReservations();
  }

  /** Navigates to previous day */
  prevDay(): void {
    const prev = new Date(this.selectedDate());
    prev.setDate(prev.getDate() - 1);
    this.selectedDate.set(prev);
    this.loadDayReservations();
  }

  /** Navigates to next day */
  nextDay(): void {
    const next = new Date(this.selectedDate());
    next.setDate(next.getDate() + 1);
    this.selectedDate.set(next);
    this.loadDayReservations();
  }

  //#endregion

  //#region Calendar Handlers

  /** Handles date cell click in FullCalendar */
  onDateClick(info: any): void {
    this.switchToDay(info.date);
  }

  /** Handles event click in FullCalendar — opens edit form */
  onEventClick(info: EventClickArg): void {
    const reservation = info.event.extendedProps['reservation'] as Reservation;
    this.openEditForm(reservation);
  }

  //#endregion

  //#region Actions

  /** Confirms a pending reservation */
  async onConfirm(reservation: Reservation): Promise<void> {
    try {
      await firstValueFrom(
        this.reservationService.update(reservation.id, {
          ...reservation,
          tableId: reservation.tableId,
          guestName: reservation.guestName,
          guestPhone: reservation.guestPhone,
          partySize: reservation.partySize,
          reservationDate: reservation.reservationDate,
          reservationTime: reservation.reservationTime,
          durationMinutes: reservation.durationMinutes,
          notes: reservation.notes,
        }),
      );
      // Backend handles status change via confirm logic
      this.messageService.add({ severity: 'success', summary: 'Reservación confirmada', life: 3000 });
      await this.loadDayReservations();
    } catch {
      this.messageService.add({ severity: 'error', summary: 'Error al confirmar', life: 3000 });
    }
  }

  /** Cancels a reservation */
  async onCancel(reservation: Reservation): Promise<void> {
    try {
      await firstValueFrom(this.reservationService.cancel(reservation.id));
      this.messageService.add({ severity: 'success', summary: 'Reservación cancelada', life: 3000 });
      await this.loadDayReservations();
    } catch {
      this.messageService.add({ severity: 'error', summary: 'Error al cancelar', life: 3000 });
    }
  }

  /** Marks a reservation as no-show */
  async onNoShow(reservation: Reservation): Promise<void> {
    try {
      await firstValueFrom(this.reservationService.markNoShow(reservation.id));
      this.messageService.add({ severity: 'success', summary: 'Marcada como no show', life: 3000 });
      await this.loadDayReservations();
    } catch {
      this.messageService.add({ severity: 'error', summary: 'Error', life: 3000 });
    }
  }

  /** Seats a confirmed reservation */
  async onSeat(reservation: Reservation): Promise<void> {
    try {
      await firstValueFrom(this.reservationService.seat(reservation.id));
      this.messageService.add({ severity: 'success', summary: 'Reservación sentada', life: 3000 });
      await this.loadDayReservations();
    } catch {
      this.messageService.add({ severity: 'error', summary: 'Error al sentar', life: 3000 });
    }
  }

  //#endregion

  //#region Form

  /** Opens the create reservation form */
  openCreateForm(): void {
    this.editingReservation.set(null);
    this.showForm.set(true);
  }

  /** Opens the edit reservation form */
  openEditForm(reservation: Reservation): void {
    this.editingReservation.set(reservation);
    this.showForm.set(true);
  }

  /** Called when the form saves successfully */
  async onFormSaved(): Promise<void> {
    this.showForm.set(false);
    await this.loadDayReservations();
    const now = new Date();
    await this.loadMonthReservations(now.getFullYear(), now.getMonth() + 1);
  }

  //#endregion

  //#region Display Helpers

  /** Returns hex color for a reservation status */
  getStatusColor(status: ReservationStatus): string {
    switch (status) {
      case 'Pending':   return '#F59E0B';
      case 'Confirmed': return '#14B8A6';
      case 'Seated':    return '#3B82F6';
      case 'Cancelled': return '#9CA3AF';
      case 'NoShow':    return '#EF4444';
      default:          return '#6B7280';
    }
  }

  /** Returns Spanish label for a reservation status */
  getStatusLabel(status: ReservationStatus): string {
    switch (status) {
      case 'Pending':   return 'Pendiente';
      case 'Confirmed': return 'Confirmada';
      case 'Seated':    return 'Sentada';
      case 'Cancelled': return 'Cancelada';
      case 'NoShow':    return 'No show';
      default:          return status;
    }
  }

  /** Formats HH:mm:ss to HH:mm */
  formatTime(time: string): string {
    return time.substring(0, 5);
  }

  //#endregion

}
