/**
 * Schema for the fleet-edit dialog form on /admin/devices.
 *
 * Migrated from hand-rolled FormGroup to schema-driven per FDD-032
 * Phase 2. Two fields (name + branchId) edited per-device by the admin.
 * No showWhen predicates → consumer does NOT need to pass a snapshot.
 */

import { DynamicFormSchema } from 'src/app/shared/forms';

/** Closed union of fields the edit form manages. */
export type EditFormKey = 'name' | 'branchId';

export const ADMIN_DEVICES_EDIT_SCHEMA: DynamicFormSchema<EditFormKey> = {
  sections: [
    {
      id: 'main',
      title: 'Editar dispositivo',
      icon: 'pi pi-pencil',
      defaultOpen: true,
      fields: [
        {
          key: 'name',
          kind: 'text',
          label: 'Nombre',
          defaultValue: '',
          validators: ['required', { key: 'maxLength', n: 60 }, 'nonBlank'],
        },
        {
          key: 'branchId',
          kind: 'dropdown',
          label: 'Sucursal',
          placeholder: 'Selecciona una sucursal',
          defaultValue: 0,
          validators: ['required', { key: 'min', n: 1 }],
          // options injected at runtime — branchOptions signal
        },
      ],
    },
  ],
};
