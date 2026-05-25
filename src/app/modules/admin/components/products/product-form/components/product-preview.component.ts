import { CommonModule, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

import { PreviewVariant } from '../schemas/product-form.schema';

/**
 * Snapshot of the product values consumed by the preview pane.
 *
 * Mirrors the shape produced by `ProductFormComponent.previewProduct`
 * (the legacy component remains the source of truth — this interface
 * is only the typed contract for what `<app-product-preview>` reads).
 */
export interface PreviewProductSnapshot {
  name: string;
  category: string;
  barcode: string;
  pricePesos: number;
  isAvailable: boolean;
  currentStock: number;
  isMembership: boolean;
  membershipDays: number;
  image: string | null;
}

/**
 * Polymorphic product preview pane.
 *
 * AUDIT-058 Vector B POC: replaces the legacy
 * `@switch (currentMacro()) { @case (FoodBeverage) ... }` block in
 * `product-form.component.html` with a single component that switches
 * on `PreviewVariant`.
 *
 * Adding a new vertical preview (e.g. Hospitality "room-card") means
 * adding ONE entry to the `PreviewVariant` union and ONE `@case` here
 * — never touching the legacy product-form template again.
 *
 * Visual styles ride on existing SCSS classes that live in
 * `product-form.component.scss` (`.preview-card`, `.preview-quick-btn`,
 * `.preview-row`, `.preview-service`) — keeping the SCSS in place avoids
 * a parallel-stylesheet migration that would inflate POC scope.
 */
@Component({
  selector: 'app-product-preview',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, DecimalPipe],
  template: `
    @switch (variant) {

      @case ('card-fb') {
        <div class="preview-card preview-card--fb">
          <div class="preview-card__image">
            @if (product.image) {
              <img [src]="product.image" [alt]="product.name" />
            } @else {
              <i class="pi pi-image"></i>
            }
          </div>
          <div class="preview-card__body">
            @if (product.category) {
              <div class="preview-card__category">{{ product.category }}</div>
            }
            <div class="preview-card__name">
              {{ product.name || 'Nombre del producto' }}
            </div>
            <div class="preview-card__price">
              \${{ product.pricePesos | number:'1.2-2' }}
            </div>
          </div>
          @if (!product.isAvailable) {
            <span class="preview-card__unavailable">No disponible</span>
          }
        </div>
      }

      @case ('button-counter') {
        <button class="preview-quick-btn" type="button" disabled>
          <span class="preview-quick-btn__name">
            {{ product.name || 'Nombre del producto' }}
          </span>
          <span class="preview-quick-btn__price">
            \${{ product.pricePesos | number:'1.2-2' }}
          </span>
          @if (!product.isAvailable) {
            <span class="preview-quick-btn__unavailable">No disponible</span>
          }
        </button>
      }

      @case ('row-retail') {
        <div class="preview-row">
          <div class="preview-row__image">
            @if (product.image) {
              <img [src]="product.image" [alt]="product.name" />
            } @else {
              <i class="pi pi-image"></i>
            }
          </div>
          <div class="preview-row__info">
            <div class="preview-row__name">
              {{ product.name || 'Nombre del producto' }}
            </div>
            <div class="preview-row__sku">
              SKU: {{ product.barcode || '—' }}
            </div>
            @if (showStock) {
              <div class="preview-row__stock">
                Stock: {{ product.currentStock }}
              </div>
            }
          </div>
          <div class="preview-row__price">
            \${{ product.pricePesos | number:'1.2-2' }}
          </div>
        </div>
      }

      @case ('service-tile') {
        <div class="preview-service">
          <i class="pi pi-clock preview-service__icon"></i>
          <div class="preview-service__name">
            {{ product.name || 'Nombre del producto' }}
          </div>
          @if (product.isMembership && product.membershipDays > 0) {
            <div class="preview-service__duration">
              {{ product.membershipDays }} días de vigencia
            </div>
          }
          <div class="preview-service__price">
            \${{ product.pricePesos | number:'1.2-2' }}
          </div>
          @if (!product.isAvailable) {
            <span class="preview-service__unavailable">No disponible</span>
          }
        </div>
      }
    }
  `,
})
export class ProductPreviewComponent {

  /** Selects which preview layout to render — comes from the schema's `previewVariant`. */
  @Input({ required: true }) variant!: PreviewVariant;

  /** Live snapshot of the product's typed values — usually a computed signal in the parent. */
  @Input({ required: true }) product!: PreviewProductSnapshot;

  /**
   * Whether to render the stock line in the retail row variant. Provided
   * by the parent based on the live `trackStock` toggle so this preview
   * component stays free of FormGroup dependencies.
   */
  @Input() showStock = false;

}
