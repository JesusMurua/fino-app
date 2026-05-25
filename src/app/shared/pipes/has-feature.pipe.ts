import { Pipe, PipeTransform, inject } from '@angular/core';

import { FeatureKey } from '../../core/enums';
import { TenantContextService } from '../../core/services/tenant-context.service';

/**
 * Template pipe that returns true when the current tenant has the given
 * feature enabled. Delegates to `TenantContextService.hasFeature()` — O(1)
 * Set lookup.
 *
 * Marked impure so it re-evaluates on every change-detection cycle as the
 * active-features signal updates. The lookup is cheap enough that this
 * trade-off is preferable to wiring an async-pipe-based observable for
 * every template binding.
 *
 * Usage:
 *   <button [disabled]="!(FeatureKey.MaxKdsScreens | hasFeature)">
 *     Enviar a cocina
 *   </button>
 *
 *   <div [class.locked]="!(FeatureKey.CfdiInvoicing | hasFeature)">
 *     ...
 *   </div>
 *
 * For full DOM removal (instead of styling), prefer the `*appFeature`
 * structural directive — it avoids rendering the element entirely when
 * the feature is absent.
 */
@Pipe({
  name: 'hasFeature',
  standalone: true,
  pure: false,
})
export class HasFeaturePipe implements PipeTransform {

  private readonly tenantContext = inject(TenantContextService);

  transform(key: FeatureKey): boolean {
    return this.tenantContext.hasFeature(key);
  }

}
