/**
 * Schema for the reservation form (FDD-032 Phase 3 — hybrid pattern).
 *
 * Only schema-friendly kinds appear here. Raw-rendered controls
 * (partySize stepper, reservationDate/reservationTime calendars) are
 * NOT in the schema — they are added to the FormGroup imperatively by
 * the consumer via `form.addControl()` post-`buildFormGroup()`. This
 * is "Path Y" locked per FDD-032 OQ7.
 *
 * formValidators: ABSENT — data model is date+time+duration, NOT
 * start/end timestamps, so the FDD-031 `date-range` validator does
 * not apply mathematically.
 */

import { DynamicFormSchema } from 'src/app/shared/forms';

import { ReservationAvailabilityService } from './services/reservation-availability.service';

/** Closed union of fields the schema renders via <app-form-field>. */
export type ReservationFormKey =
  | 'guestName' | 'guestPhone'
  | 'durationMinutes' | 'tableId' | 'notes';

export const RESERVATION_FORM_SCHEMA: DynamicFormSchema<ReservationFormKey> = {
  sections: [
    {
      id: 'guest',
      title: 'Cliente',
      fields: [
        {
          key: 'guestName',
          kind: 'text',
          label: 'Nombre',
          placeholder: 'Juan Pérez',
          defaultValue: '',
          validators: ['required'],
        },
        {
          key: 'guestPhone',
          kind: 'text',
          label: 'Teléfono',
          placeholder: '55 1234 5678',
          defaultValue: '',
        },
      ],
    },
    {
      id: 'when',
      title: 'Cuándo',
      fields: [
        {
          key: 'durationMinutes',
          kind: 'dropdown',
          label: 'Duración',
          defaultValue: 90,
          validators: ['required'],
          // options injected at runtime — `durationOptions` array in consumer.
        },
      ],
    },
    {
      id: 'table',
      title: 'Mesa',
      fields: [
        {
          key: 'tableId',
          kind: 'chip-select',
          label: 'Mesa',
          defaultValue: null,
          updateOn: 'blur',
          asyncValidators: [
            { key: 'availability', service: ReservationAvailabilityService },
          ],
          // options injected at runtime — `tableChipGroups` signal in consumer.
        },
      ],
    },
    {
      id: 'notes',
      title: 'Notas',
      fields: [
        {
          key: 'notes',
          kind: 'textarea',
          label: 'Notas',
          placeholder: 'Cumpleaños, alergias, silla alta...',
          defaultValue: '',
        },
      ],
    },
  ],
};
