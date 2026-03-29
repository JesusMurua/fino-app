import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { Reservation, CreateReservationDto, UpdateReservationDto } from '../models';
import { ApiService } from './api.service';

/**
 * Manages reservation CRUD operations via the backend API.
 * All endpoints require authentication — branchId is derived from JWT.
 */
@Injectable({ providedIn: 'root' })
export class ReservationService {

  //#region Properties
  private readonly api = inject(ApiService);
  //#endregion

  //#region Public Methods

  /**
   * Gets all reservations for a specific day.
   * @param date The date to query
   */
  getByDay(date: Date): Observable<Reservation[]> {
    const dateStr = this.formatDate(date);
    return this.api.get<Reservation[]>(`/reservations/day?date=${dateStr}`);
  }

  /**
   * Gets all reservations for a specific month (calendar view).
   * @param year 4-digit year
   * @param month 1-based month number
   */
  getByMonth(year: number, month: number): Observable<Reservation[]> {
    return this.api.get<Reservation[]>(`/reservations/month?year=${year}&month=${month}`);
  }

  /**
   * Creates a new reservation.
   * @param data Reservation data to create
   */
  create(data: CreateReservationDto): Observable<Reservation> {
    return this.api.post<Reservation>('/reservations', data);
  }

  /**
   * Updates an existing reservation.
   * @param id Reservation ID
   * @param data Updated reservation data
   */
  update(id: number, data: UpdateReservationDto): Observable<Reservation> {
    return this.api.put<Reservation>(`/reservations/${id}`, data);
  }

  /**
   * Cancels a reservation.
   * @param id Reservation ID
   */
  cancel(id: number): Observable<void> {
    return this.api.patch<void>(`/reservations/${id}/cancel`, {});
  }

  /**
   * Marks a reservation as no-show.
   * @param id Reservation ID
   */
  markNoShow(id: number): Observable<void> {
    return this.api.patch<void>(`/reservations/${id}/no-show`, {});
  }

  /**
   * Seats a reservation — transitions from Confirmed to Seated.
   * @param id Reservation ID
   */
  seat(id: number): Observable<void> {
    return this.api.patch<void>(`/reservations/${id}/seat`, {});
  }

  /**
   * Checks if a table is available for a given date/time/duration.
   * @param tableId Table to check
   * @param date YYYY-MM-DD format
   * @param time HH:mm:ss format
   * @param duration Duration in minutes
   * @param excludeId Reservation ID to exclude (when editing)
   */
  checkAvailability(
    tableId: number,
    date: string,
    time: string,
    duration: number,
    excludeId?: number,
  ): Observable<{ available: boolean }> {
    let url = `/reservations/availability?tableId=${tableId}&date=${date}&time=${time}&duration=${duration}`;
    if (excludeId) url += `&excludeId=${excludeId}`;
    return this.api.get<{ available: boolean }>(url);
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

  //#endregion

}
