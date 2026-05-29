import { TestBed } from '@angular/core/testing';
import { AbstractControl, FormControl, FormGroup } from '@angular/forms';
import { firstValueFrom, of } from 'rxjs';

import { ReservationService } from '../../../../../core/services/reservation.service';

import { ReservationAvailabilityService } from './reservation-availability.service';

describe('ReservationAvailabilityService', () => {

  let service: ReservationAvailabilityService;
  let reservationServiceSpy: jasmine.SpyObj<ReservationService>;

  beforeEach(() => {
    reservationServiceSpy = jasmine.createSpyObj<ReservationService>(
      'ReservationService', ['checkAvailability'],
    );
    TestBed.configureTestingModule({
      providers: [
        { provide: ReservationService, useValue: reservationServiceSpy },
      ],
    });
    service = TestBed.inject(ReservationAvailabilityService);
  });

  function buildGroup(values: {
    tableId?: number | null;
    reservationDate?: Date | null;
    reservationTime?: Date | null;
    durationMinutes?: number | null;
  }): { group: FormGroup; tableCtrl: AbstractControl } {
    const group = new FormGroup({
      tableId:         new FormControl(values.tableId ?? null),
      reservationDate: new FormControl(values.reservationDate ?? null),
      reservationTime: new FormControl(values.reservationTime ?? null),
      durationMinutes: new FormControl(values.durationMinutes ?? null),
    });
    return { group, tableCtrl: group.controls['tableId'] };
  }

  it('returns of(null) when any required sibling is missing (validator inert)', async () => {
    // 4 missing-value cases — checkAvailability MUST NOT be called for any.
    const cases: Parameters<typeof buildGroup>[0][] = [
      { tableId: null, reservationDate: new Date(), reservationTime: new Date(), durationMinutes: 90 },
      { tableId: 1,    reservationDate: null,       reservationTime: new Date(), durationMinutes: 90 },
      { tableId: 1,    reservationDate: new Date(), reservationTime: null,       durationMinutes: 90 },
      { tableId: 1,    reservationDate: new Date(), reservationTime: new Date(), durationMinutes: null },
    ];

    for (const c of cases) {
      const { tableCtrl } = buildGroup(c);
      const result = await firstValueFrom(service.check(tableCtrl));
      expect(result).toBeNull();
    }
    expect(reservationServiceSpy.checkAvailability).not.toHaveBeenCalled();
  });

  it('maps backend response, formats date/time, and forwards excludeId from setCurrentReservationId', async () => {
    const date = new Date(2026, 4, 27);  // May 27, 2026 (month is 0-indexed)
    const time = new Date();
    time.setHours(19, 30, 0, 0);
    const { tableCtrl } = buildGroup({
      tableId: 7, reservationDate: date, reservationTime: time, durationMinutes: 120,
    });

    service.setCurrentReservationId(42);

    // Case A: backend says available → emits null.
    reservationServiceSpy.checkAvailability.and.returnValue(of({ available: true }));
    let result = await firstValueFrom(service.check(tableCtrl));
    expect(result).toBeNull();
    expect(reservationServiceSpy.checkAvailability).toHaveBeenCalledWith(
      7, '2026-05-27', '19:30:00', 120, 42,
    );

    // Case B: backend says NOT available → emits { availability: true }.
    reservationServiceSpy.checkAvailability.and.returnValue(of({ available: false }));
    result = await firstValueFrom(service.check(tableCtrl));
    expect(result).toEqual({ availability: true });
  });

});
