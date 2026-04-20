import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { InputTextModule } from 'primeng/inputtext';
import { PasswordModule } from 'primeng/password';

import { AuthService } from '../../core/services/auth.service';
import { DeviceRoutingService } from '../../core/services/device-routing.service';
import { DeviceService } from '../../core/services/device.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule, RouterModule, InputTextModule, PasswordModule],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss',
})
export class LoginComponent {

  //#region Properties
  email = '';
  password = '';

  readonly isLoading = signal(false);
  readonly hasError = signal(false);
  readonly errorMessage = signal('');

  /** True when this device has been provisioned — shows "Volver al PIN" */
  readonly isDeviceBound = inject(DeviceService).getDeviceToken() !== null;
  //#endregion

  //#region Constructor
  constructor(
    private readonly authService: AuthService,
    private readonly deviceRoutingService: DeviceRoutingService,
    private readonly router: Router,
  ) {}
  //#endregion

  //#region Auth

  /** Attempts email login and redirects based on role */
  async submit(): Promise<void> {
    if (!this.email || !this.password) return;

    this.isLoading.set(true);
    this.hasError.set(false);

    const user = await this.authService.emailLogin(this.email, this.password);

    this.isLoading.set(false);

    if (user) {
      const returnUrl = this.authService.consumeReturnUrl();
      const resolved = this.deviceRoutingService.getPostLoginRoute(user.roleId);

      // Email login users are Back Office by definition. They never trip
      // the hardware-shell error path; if they somehow did, fall back to
      // /admin rather than locking them out.
      const defaultRoute = resolved.kind === 'route' ? resolved.route : '/admin';
      this.router.navigateByUrl(returnUrl ?? defaultRoute);
    } else {
      this.hasError.set(true);
      this.errorMessage.set('Correo o contraseña incorrectos.');
    }
  }

  //#endregion

}
