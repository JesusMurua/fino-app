/**
 * AsyncValidatorService for the `tableId` field in the reservation form
 * (FDD-032 Phase 3).
 *
 * Validates a chosen table against the existing reservations book via
 * `ReservationService.checkAvailability`. Reads sibling controls for the
 * date / time / duration context. INERT (returns null) when any sibling
 * is missing OR `tableId` is null (the noTableAssigned UX path).
 *
 * Edit-mode self-collision is skipped by passing `currentReservationId`
 * as the backend's `excludeId` query parameter. The consumer calls
 * `setCurrentReservationId()` in `ngOnChanges` when the `reservation`
 * Input changes.
 */

import { Injectable, inject } from '@angular/core';
import { AbstractControl, ValidationErrors } from '@angular/forms';
import { Observable, of } from 'rxjs';
import { map } from 'rxjs/operators';

import { AsyncValidatorService } from 'src/app/shared/forms';

import { ReservationService } from '../../../../../core/services/reservation.service';

@Injectable({ providedIn: 'root' })
export class ReservationAvailabilityService implements AsyncValidatorService {

  private currentReservationId: number | null = null;
  private readonly reservationService = inject(ReservationService);

  /**
   * Consumer-invocable setter — reservation-form calls this in
   * `ngOnChanges` when the `reservation` Input changes, so the validator
   * can pass `excludeId` to the backend and skip self-collision during edit.
   */
  setCurrentReservationId(id: number | null): void {
    this.currentReservationId = id;
  }

  check(control: AbstractControl): Observable<ValidationErrors | null> {
    const tableId  = control.value as number | null;
    const date     = control.parent?.get('reservationDate')?.value as Date | null;
    const time     = control.parent?.get('reservationTime')?.value as Date | null;
    const duration = control.parent?.get('durationMinutes')?.value as number | null;

    if (!tableId || !date || !time || !duration) {
      return of(null);
    }

    return this.reservationService
      .checkAvailability(
        tableId,
        this.formatDate(date),
        this.formatTime(time),
        duration,
        this.currentReservationId ?? undefined,
      )
      .pipe(
        map(result => (result.available ? null : { availability: true } satisfies ValidationErrors)),
      );
  }

  private formatDate(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  private formatTime(d: Date): string {
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    return `${h}:${m}:00`;
  }
}
