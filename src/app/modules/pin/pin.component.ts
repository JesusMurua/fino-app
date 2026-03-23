import { Component, signal } from '@angular/core';
import { Router, RouterModule } from '@angular/router';

import { AuthService } from '../../core/services/auth.service';

/** Branch ID — hardcoded until multi-branch support is implemented */
const BRANCH_ID = 1;

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

  /** Verifies the entered PIN via API and redirects by role */
  async submit(): Promise<void> {
    const pin = this.digits().join('');
    this.isLoading.set(true);

    const user = await this.authService.pinLogin(BRANCH_ID, pin);

    this.isLoading.set(false);

    if (user) {
      const returnUrl = this.authService.consumeReturnUrl();
      if (returnUrl) {
        this.router.navigateByUrl(returnUrl);
        return;
      }

      const raw = localStorage.getItem('pos-device-config');
      const mode = raw ? JSON.parse(raw).mode : 'counter';

      switch (user.role) {
        case 'Owner':
        case 'Manager':
          this.router.navigate(['/admin']);
          break;
        case 'Kitchen':
          this.router.navigate(['/kitchen']);
          break;
        case 'Waiter':
          this.router.navigate([mode === 'waiter' || mode === 'tables' ? '/tables' : '/pos']);
          break;
        case 'Cashier':
        default: {
          const dest = (mode === 'tables' || mode === 'waiter') ? '/tables'
            : mode === 'kitchen' ? '/kitchen'
            : '/pos';
          this.router.navigate([dest]);
          break;
        }
      }
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
