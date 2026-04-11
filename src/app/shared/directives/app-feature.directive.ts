import {
  Directive,
  EmbeddedViewRef,
  Input,
  TemplateRef,
  ViewContainerRef,
  effect,
  inject,
  signal,
} from '@angular/core';

import { FeatureKey } from '../../core/enums';
import { TenantContextService } from '../../core/services/tenant-context.service';

/**
 * Two rendering modes:
 *   - `hide` — remove the element from the DOM entirely. Use this
 *              when the feature does not apply to the current giro
 *              (e.g. a Mesas menu item for a Retail business).
 *   - `lock` — render the element with a `feature-locked` class so
 *              the template can show a padlock overlay / upsell CTA.
 *              Use this when the feature exists for this giro but
 *              requires a higher plan tier.
 */
export type AppFeatureMode = 'hide' | 'lock';

/**
 * Structural directive that conditionally renders content based on
 * the `TenantContextService.activeFeatures` set.
 *
 * Reacts via `effect()` to signal changes, so the DOM updates
 * automatically when the backend pushes a new plan/feature set
 * (e.g. after a subscription upgrade).
 *
 * Usage:
 *   <button *appFeature="FeatureKey.RealtimeKds">KDS en vivo</button>
 *   <div *appFeature="FeatureKey.CfdiInvoicing; mode: 'lock'">
 *     <!-- rendered with .feature-locked when not available -->
 *   </div>
 */
@Directive({
  selector: '[appFeature]',
  standalone: true,
})
export class AppFeatureDirective {

  //#region Injections

  private readonly templateRef = inject(TemplateRef<unknown>);
  private readonly viewContainer = inject(ViewContainerRef);
  private readonly tenantContext = inject(TenantContextService);

  //#endregion

  //#region State

  private readonly feature = signal<FeatureKey | null>(null);
  private readonly mode = signal<AppFeatureMode>('hide');
  private embeddedView: EmbeddedViewRef<unknown> | null = null;

  //#endregion

  //#region Inputs

  /** Feature key required to render the element */
  @Input({ required: true })
  set appFeature(value: FeatureKey) {
    this.feature.set(value);
  }

  /** Rendering mode — `hide` (default) removes the node; `lock` renders it with a locked class */
  @Input()
  set appFeatureMode(value: AppFeatureMode) {
    this.mode.set(value);
  }

  //#endregion

  //#region Lifecycle

  constructor() {
    effect(() => {
      const feature = this.feature();
      if (!feature) {
        this.clearView();
        return;
      }

      const available = this.tenantContext.hasFeature(feature);
      const mode = this.mode();

      if (available) {
        this.renderView(false);
      } else if (mode === 'lock') {
        this.renderView(true);
      } else {
        this.clearView();
      }
    });
  }

  //#endregion

  //#region Private Helpers

  /** Creates (or updates) the embedded view and applies the locked class */
  private renderView(locked: boolean): void {
    if (!this.embeddedView) {
      this.viewContainer.clear();
      this.embeddedView = this.viewContainer.createEmbeddedView(this.templateRef);
    }
    this.applyLockedClass(locked);
  }

  /** Removes the embedded view from the DOM */
  private clearView(): void {
    if (this.embeddedView) {
      this.viewContainer.clear();
      this.embeddedView = null;
    }
  }

  /** Toggles the `feature-locked` class on every root node of the embedded view */
  private applyLockedClass(locked: boolean): void {
    if (!this.embeddedView) return;
    for (const node of this.embeddedView.rootNodes) {
      if (node instanceof HTMLElement) {
        node.classList.toggle('feature-locked', locked);
      }
    }
  }

  //#endregion

}
