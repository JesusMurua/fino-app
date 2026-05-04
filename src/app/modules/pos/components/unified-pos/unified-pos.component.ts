import { Component, OnDestroy, OnInit, effect, inject } from '@angular/core';
import { Router } from '@angular/router';
import { Subject, Subscription, takeUntil } from 'rxjs';
import { MessageService } from 'primeng/api';
import { ToastModule } from 'primeng/toast';

import { CartService } from '../../../../core/services/cart.service';
import { ConfigService } from '../../../../core/services/config.service';
import { PosViewModeService } from '../../../../core/services/pos-view-mode.service';
import { ProductService } from '../../../../core/services/product.service';
import { ScannerService } from '../../../../core/services/scanner.service';
import { TenantContextService } from '../../../../core/services/tenant-context.service';
import { CartPanelComponent } from '../cart-panel/cart-panel.component';
import { DeliveryPanelComponent } from '../delivery-panel/delivery-panel.component';
import { KeypadStageComponent } from '../keypad-stage/keypad-stage.component';
import { PosHeaderComponent } from '../pos-header/pos-header.component';
import { ProductGridInnerComponent } from '../product-grid-inner/product-grid-inner.component';

/**
 * Unified POS shell — the "Invisible Chameleon".
 *
 * Single component that absorbs the legacy `quick-pos`, `retail-pos`, and
 * `quick-service` (product-grid) shells. Renders `<app-pos-header>`,
 * a swappable stage (`<app-keypad-stage>` ↔ `<app-product-grid-inner>`)
 * driven by `PosViewModeService.viewMode`, and the shared
 * `<app-cart-panel>` on the right.
 *
 * View-mode default is seeded from `tenantContext.posExperience()`:
 *   - 'Services' / 'Quick'  → keypad
 *   - 'Retail' / 'Counter' (and any other) → grid
 * The cashier's last manual override always wins on subsequent mounts.
 *
 * Scanner integration only listens while `viewMode === 'grid'` — keypad
 * mode is text-input-heavy and a keyboard-wedge scanner would inject
 * phantom characters into the description / price fields.
 */
@Component({
  selector: 'app-unified-pos',
  standalone: true,
  imports: [
    ToastModule,
    PosHeaderComponent,
    KeypadStageComponent,
    ProductGridInnerComponent,
    CartPanelComponent,
    DeliveryPanelComponent,
  ],
  templateUrl: './unified-pos.component.html',
  styleUrl: './unified-pos.component.scss',
  providers: [MessageService],
})
export class UnifiedPosComponent implements OnInit, OnDestroy {

  //#region Properties

  private readonly cartService = inject(CartService);
  readonly configService = inject(ConfigService);
  private readonly messageService = inject(MessageService);
  private readonly productService = inject(ProductService);
  private readonly scannerService = inject(ScannerService);
  private readonly tenantContext = inject(TenantContextService);
  private readonly viewModeService = inject(PosViewModeService);
  private readonly router = inject(Router);

  /** Active view mode — proxied from the cross-component service */
  readonly viewMode = this.viewModeService.viewMode;

  private readonly destroy$ = new Subject<void>();
  private scanSubscription: Subscription | null = null;

  //#endregion

  //#region Constructor

  constructor() {
    // Seed default from posExperience whenever it resolves (cold-boot may
    // start undefined and hydrate later from sub-giro fetch). Only seeds
    // when the user has not yet overridden — see PosViewModeService.
    effect(() => {
      const experience = this.tenantContext.posExperience();
      if (experience) {
        this.viewModeService.initializeDefault(experience);
      }
    }, { allowSignalWrites: true });

    // Scanner gating — start listener only in grid mode, stop in keypad
    // mode so a keyboard-wedge scanner does not inject phantom chars
    // into the keypad description / price inputs.
    effect(() => {
      const mode = this.viewMode();
      if (mode === 'grid') {
        this.startScannerListener();
      } else {
        this.stopScannerListener();
      }
    }, { allowSignalWrites: true });
  }

  //#endregion

  //#region Lifecycle

  ngOnInit(): void {
    this.viewModeService.setToggleVisible(true);
  }

  ngOnDestroy(): void {
    this.viewModeService.setToggleVisible(false);
    this.destroy$.next();
    this.destroy$.complete();
    this.stopScannerListener();
  }

  //#endregion

  //#region Scanner integration

  private startScannerListener(): void {
    if (this.scanSubscription) return;
    this.scanSubscription = this.scannerService.onScan()
      .pipe(takeUntil(this.destroy$))
      .subscribe(code => this.handleBarcodeScan(code));
    this.scannerService.startListening();
  }

  private stopScannerListener(): void {
    if (this.scanSubscription) {
      this.scanSubscription.unsubscribe();
      this.scanSubscription = null;
    }
    this.scannerService.stopListening();
  }

  /**
   * Handles a scanned barcode in grid mode. Products with sizes/extras
   * navigate to the detail screen so the cashier can configure; simple
   * products are added to the cart directly with a confirmation toast.
   */
  private handleBarcodeScan(code: string): void {
    this.productService.findByBarcode(code).subscribe({
      next: (product) => {
        if (!product) {
          this.showBarcodeNotFound(code);
          return;
        }
        const hasOptions = product.sizes.length > 0
          || (product.modifierGroups?.some(g => g.extras.length > 0) ?? false);
        if (hasOptions) {
          this.router.navigate(['/pos/add-meal', product.id]);
          return;
        }
        this.cartService.addItem(product);
        this.messageService.add({
          severity: 'success',
          summary: 'Producto agregado',
          detail: product.name,
          life: 2000,
        });
      },
      error: () => this.showBarcodeNotFound(code),
    });
  }

  private showBarcodeNotFound(code: string): void {
    this.messageService.add({
      severity: 'warn',
      summary: 'Código no registrado',
      detail: `"${code}" — ve al catálogo para asignarlo a un producto`,
      life: 5000,
    });
  }

  //#endregion
}
