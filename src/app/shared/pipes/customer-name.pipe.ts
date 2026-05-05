import { Pipe, PipeTransform } from '@angular/core';

import { Customer } from '../../core/models/customer.model';

/** Subset of `Customer` required to render its display name. */
type CustomerNameSource = Pick<Customer, 'firstName'> & Partial<Pick<Customer, 'lastName'>>;

/**
 * Pure helper that builds the display name from the structural fields of a
 * Customer. Exported so TypeScript code (services, components, payload
 * builders) can produce the same string the templates render via the pipe.
 *
 * Behavior:
 *   - Returns `''` for `null` / `undefined`.
 *   - Trims both fields.
 *   - Drops `lastName` when it is empty (single-name customers).
 */
export function formatCustomerName(c: CustomerNameSource | null | undefined): string {
  if (!c) return '';
  const first = (c.firstName ?? '').trim();
  const last = (c.lastName ?? '').trim();
  return last ? `${first} ${last}` : first;
}

/**
 * Renders a Customer's display name in templates.
 *
 * Standalone, pure — memoized per Customer reference so dropdowns and
 * chips do not rebuild the string on every change-detection cycle.
 *
 * @example
 *   {{ customer | customerName }}
 */
@Pipe({
  name: 'customerName',
  standalone: true,
  pure: true,
})
export class CustomerNamePipe implements PipeTransform {

  transform(c: CustomerNameSource | null | undefined): string {
    return formatCustomerName(c);
  }

}
