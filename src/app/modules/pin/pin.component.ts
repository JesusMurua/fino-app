import { Component, inject, signal } from '@angular/core';
import { Router, RouterModule } from '@angular/router';

import { AuthService } from '../../core/services/auth.service';
import { ConfigService } from '../../core/services/config.service';
import { InventoryService } from '../../core/services/inventory.service';
import { NotificationService } from '../../core/services/notification.service';
import { ProductService } from '../../core/services/product.service';
import { TableService } from '../../core/services/table.service';

/** Keys available on the PIN numpad */
type NumpadKey = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | 'del';

@Component({
  selector: 'app-pin',
  standalone: true,
  imports: [RouterModule],
  templateUrl: './pin.component.html',
  styleUrl: './pin.component.scss',
})
export class PinComponent {

  //#region Properties

  /** Current digits entered (max 4) */
  readonly digits = signal<string[]>([]);

  /** True while showing the shake + error state */
  readonly hasError = signal(false);

  /** True while waiting for API response */
  readonly isLoading = signal(false);

  /** Flat key list for the 3x4 grid (last row: empty slot, 0, del) */
  readonly keys: (NumpadKey | null)[] = [
    '1', '2', '3',
    '4', '5', '6',
    '7', '8', '9',
    null, '0', 'del',
  ];

  //#endregion

  private readonly configService = inject(ConfigService);
  private readonly productService = inject(ProductService);
  private readonly inventoryService = inject(InventoryService);
  private readonly notificationService = inject(NotificationService);
  private readonly tableService = inject(TableService);

  //#region Constructor
  constructor(
    private readonly authService: AuthService,
    private readonly router: Router,
  ) {}
  //#endregion

  //#region Numpad Actions

  /** Adds a digit if fewer than 4 have been entered, then auto-submits at 4 */
  addDigit(digit: string): void {
    if (this.digits().length >= 4 || this.isLoading()) return;
    this.digits.update(d => [...d, digit]);

    if (this.digits().length === 4) {
      this.submit();
    }
  }

  /** Removes the last entered digit */
  removeDigit(): void {
    this.digits.update(d => d.slice(0, -1));
    this.hasError.set(false);
  }

  /** Handles a numpad key press */
  onKey(key: NumpadKey | null): void {
    if (!key) return;
    if (key === 'del') {
      this.removeDigit();
    } else {
      this.addDigit(key);
    }
  }

  //#endregion

  //#region Auth

  /**
   * Verifies the entered PIN via API, preloads essential data into Dexie,
   * and redirects by role. Preload runs in parallel and never blocks navigation.
   */
  async submit(): Promise<void> {
    const pin = this.digits().join('');
    this.isLoading.set(true);

    const deviceBranchId = this.configService.deviceConfig$.getValue().branchId;
    const branchId = deviceBranchId > 0 ? deviceBranchId : this.authService.branchId;
    const user = await this.authService.pinLogin(branchId, pin);

    this.isLoading.set(false);

    if (user) {
      // Preload essential data into Dexie (best-effort, non-blocking)
      try {
        await Promise.all([
          this.productService.loadCatalog(),
          this.inventoryService.loadFromApi(),
          this.tableService.loadTables(this.authService.activeBranchId()),
        ]);
      } catch (error) {
        console.warn('[PinComponent] Preload failed — components will retry on mount:', error);
      }

      const returnUrl = this.authService.consumeReturnUrl();
      if (returnUrl) {
        this.router.navigateByUrl(returnUrl);
        return;
      }

      const raw = localStorage.getItem('pos-device-config');
      const mode = raw ? JSON.parse(raw).mode : 'cashier';

      switch (user.role) {
        case 'Owner':
        case 'Manager':
          this.router.navigate(['/admin']);
          break;
        case 'Kitchen':
          this.router.navigate(['/kitchen']);
          break;
        case 'Waiter':
          this.router.navigate([mode === 'tables' ? '/tables' : '/pos']);
          break;
        case 'Cashier':
        default: {
          const dest = mode === 'tables' ? '/tables'
            : mode === 'kitchen' ? '/kitchen'
            : '/pos';
          this.router.navigate([dest]);
          break;
        }
      }

      // Request push notification permission (best-effort, non-blocking)
      this.notificationService.requestPermission();
    } else {
      this.hasError.set(true);
      setTimeout(() => {
        this.digits.set([]);
        this.hasError.set(false);
      }, 600);
    }
  }

  //#endregion

}
