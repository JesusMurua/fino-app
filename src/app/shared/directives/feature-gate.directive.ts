import {
  Directive,
  EmbeddedViewRef,
  Input,
  OnDestroy,
  OnInit,
  TemplateRef,
  ViewContainerRef,
  inject,
} from '@angular/core';

import { FeatureKey } from '../../core/models';
import { FeatureFlagService } from '../../core/services/feature-flag.service';

/**
 * Structural directive that conditionally renders content
 * based on feature availability for the current plan/giro.
 *
 * If the feature is not available, shows a "locked" placeholder.
 *
 * Usage:
 *   <div *featureGate="FeatureKey.Promotions">
 *     <!-- content shown only if Promotions is available -->
 *   </div>
 */
@Directive({
  selector: '[featureGate]',
  standalone: true,
})
export class FeatureGateDirective implements OnInit, OnDestroy {

  //#region Properties

  private readonly templateRef = inject(TemplateRef<unknown>);
  private readonly viewContainer = inject(ViewContainerRef);
  private readonly featureFlagService = inject(FeatureFlagService);

  private feature!: FeatureKey;
  private embeddedView: EmbeddedViewRef<unknown> | null = null;
  private lockedElement: HTMLElement | null = null;

  //#endregion

  //#region Input

  /** The feature key to gate on */
  @Input()
  set featureGate(feature: FeatureKey) {
    this.feature = feature;
    this.updateView();
  }

  //#endregion

  //#region Lifecycle

  ngOnInit(): void {
    this.updateView();
  }

  ngOnDestroy(): void {
    this.removeLocked();
  }

  //#endregion

  //#region Private Helpers

  /** Renders the template or the locked placeholder */
  private updateView(): void {
    if (!this.feature) return;

    this.viewContainer.clear();
    this.removeLocked();

    if (this.featureFlagService.canUse(this.feature)) {
      this.embeddedView = this.viewContainer.createEmbeddedView(this.templateRef);
    } else {
      this.renderLocked();
    }
  }

  /** Creates and inserts the locked placeholder element */
  private renderLocked(): void {
    const message = this.featureFlagService.upgradeMessage(this.feature);

    const el = document.createElement('div');
    el.className = 'feature-locked';
    el.innerHTML = `<i class="pi pi-lock"></i> <span>${message}</span>`;

    // Insert after the directive's anchor comment node
    const anchor = this.viewContainer.element.nativeElement;
    if (anchor?.parentNode) {
      anchor.parentNode.insertBefore(el, anchor.nextSibling);
      this.lockedElement = el;
    }
  }

  /** Removes the locked placeholder from the DOM */
  private removeLocked(): void {
    if (this.lockedElement?.parentNode) {
      this.lockedElement.parentNode.removeChild(this.lockedElement);
      this.lockedElement = null;
    }
  }

  //#endregion

}
