/**
 * Schema for the activation-code generator form on /admin/devices.
 *
 * Migrated from hand-rolled FormGroup to schema-driven per FDD-032
 * Phase 2 (AUDIT-059 §4.2). Consumed by `admin-devices.component.ts`
 * via `DynamicFormBuilderService.buildControls()` + manual `fb.group()`
 * (FDD §5.3 — no formValidators / no async, simpler than buildFormGroup).
 *
 * Option lists for the three dropdowns are injected at runtime by the
 * consumer's `injectCodegenOptions()` helper, since they depend on
 * tenant features (mode), branch state (branchId), and per-branch
 * register availability (cashRegisterId).
 *
 * The cashRegisterId field reads a reserved snapshot key
 * `_hasCashRegisters` for visibility — the FDD-030 OQ1 pattern (same as
 * admin-users `_edit`). Composing the reserved key on top of the form
 * snapshot avoids a circular dependency between the
 * `availableCashRegistersForBranch` computed and the snapshot itself.
 */

import { DynamicFormSchema } from 'src/app/shared/forms';

/** Closed union of fields the codegen form manages. */
export type CodegenFormKey = 'branchId' | 'mode' | 'name' | 'cashRegisterId';

export const ADMIN_DEVICES_CODEGEN_SCHEMA: DynamicFormSchema<CodegenFormKey> = {
  sections: [
    {
      id: 'main',
      title: 'Generar código de activación',
      icon: 'pi pi-key',
      defaultOpen: true,
      fields: [
        {
          key: 'branchId',
          kind: 'dropdown',
          label: 'Sucursal',
          placeholder: 'Seleccionar sucursal',
          defaultValue: 0,
          validators: ['required', { key: 'min', n: 1 }],
          // options injected at runtime — branchOptions signal
        },
        {
          key: 'mode',
          kind: 'dropdown',
          label: 'Modo del dispositivo',
          defaultValue: 'cashier',
          validators: ['required'],
          // options injected at runtime — modeFormOptions signal (driven by tenant features)
        },
        {
          key: 'name',
          kind: 'text',
          label: 'Nombre del dispositivo',
          placeholder: 'Ej. Caja Principal, Recepción',
          defaultValue: '',
          validators: ['required', { key: 'maxLength', n: 60 }, 'nonBlank'],
          hint: 'El terminal adoptará este nombre automáticamente al activar el código.',
        },
        {
          key: 'cashRegisterId',
          kind: 'dropdown',
          label: 'Vincular a caja (opcional)',
          placeholder: '— No vincular caja por ahora —',
          defaultValue: null,
          // Reserved-key pattern (FDD-030 OQ1, same as admin-users `_edit`):
          // consumer surfaces `_hasCashRegisters` in the snapshot so this
          // predicate can read it. Cast required because `_hasCashRegisters`
          // is outside the CodegenFormKey union.
          showWhen: (s) =>
            s['mode'] === 'cashier' &&
            (s as Record<string, unknown>)['_hasCashRegisters'] === true,
          hint:
            'Solo se muestran cajas sin vincular de la sucursal seleccionada. ' +
            'Al activar el código, el dispositivo quedará automáticamente asignado a la caja elegida.',
          // options injected at runtime — cashRegisterOptions signal
        },
      ],
    },
  ],
};
