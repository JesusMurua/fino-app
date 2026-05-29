/**
 * Schema declarativo del form de admin-users.
 *
 * Migrated from hand-rolled FormGroup to schema-driven per FDD-030
 * (AUDIT-059 §4.1 — admin-users was identified as highest-ROI candidate).
 * Consumed by `admin-users.component.ts` via `DynamicFormBuilderService`.
 *
 * Three sections:
 *   - identity: name + role.
 *   - credentials: pin OR email + password, gated by role.
 *   - status: isActive toggle, only visible in edit mode.
 *
 * Branch assignment lives OUTSIDE this schema as a consumer-owned
 * `<p-table>` (see FDD-030 §5.3 for rationale).
 */

import { DynamicFormSchema } from 'src/app/shared/forms';

import { UserRoleId } from '../../../../core/enums';

/**
 * Closed union of fields the dynamic form manages.
 * Branch assignment is NOT here — see file docblock.
 */
export type AdminUsersFormKey =
  | 'name'
  | 'roleId'
  | 'pin'
  | 'email'
  | 'password'
  | 'isActive';

/** Roles that authenticate via 4-digit PIN. */
const PIN_ROLES: ReadonlySet<UserRoleId> = new Set([
  UserRoleId.Cashier,
  UserRoleId.Waiter,
  UserRoleId.Host,
]);

/** Roles that authenticate via email + password. */
const EMAIL_ROLES: ReadonlySet<UserRoleId> = new Set([
  UserRoleId.Owner,
  UserRoleId.Manager,
]);

/**
 * Authoritative schema. Role options injected at runtime by the consumer
 * (see `admin-users.component.ts` — `injectRoleOptions()` helper), since
 * the role catalog is product-specific (label + emoji + color).
 */
export const ADMIN_USERS_FORM_SCHEMA: DynamicFormSchema<AdminUsersFormKey> = {
  sections: [
    {
      id:          'identity',
      title:       'Identidad',
      icon:        'pi pi-user',
      defaultOpen: true,
      fields: [
        {
          key:          'name',
          kind:         'text',
          label:        'Nombre',
          placeholder:  'Nombre completo',
          defaultValue: '',
          validators:   ['required', { key: 'maxLength', n: 100 }],
        },
        {
          key:          'roleId',
          kind:         'dropdown',
          label:        'Rol',
          defaultValue: UserRoleId.Cashier,
          validators:   ['required'],
          // `options` injected at runtime via injectRoleOptions().
        },
      ],
    },
    {
      id:          'credentials',
      title:       'Credenciales',
      icon:        'pi pi-key',
      defaultOpen: true,
      fields: [
        {
          key:          'pin',
          kind:         'text',
          label:        'PIN (4 dígitos)',
          placeholder:  '4 dígitos',
          defaultValue: '',
          showWhen:     (s) => PIN_ROLES.has(s['roleId'] as UserRoleId),
        },
        {
          key:          'email',
          kind:         'text',
          label:        'Email',
          placeholder:  'correo@ejemplo.com',
          defaultValue: '',
          showWhen:     (s) => EMAIL_ROLES.has(s['roleId'] as UserRoleId),
        },
        {
          key:          'password',
          kind:         'text',
          label:        'Contraseña',
          placeholder:  'Mínimo 6 caracteres',
          defaultValue: '',
          showWhen:     (s) => EMAIL_ROLES.has(s['roleId'] as UserRoleId),
        },
      ],
    },
    {
      id:          'status',
      title:       'Estado',
      icon:        'pi pi-circle',
      defaultOpen: true,
      // Section visible ONLY in edit mode. Consumer surfaces a `_edit`
      // flag in the snapshot — see FDD-030 §4.2 (OQ1 documents the
      // reserved-key pattern; revisit if a second consumer needs it).
      // Cast required because `_edit` is outside the AdminUsersFormKey
      // union; FormValueSnapshot type-checks against TKey, so reserved
      // string keys need an explicit `Record<string, unknown>` view.
      showSection: (s) => (s as Record<string, unknown>)['_edit'] === true,
      fields: [
        {
          key:          'isActive',
          kind:         'switch',
          label:        'Activo',
          defaultValue: true,
        },
      ],
    },
  ],
};
