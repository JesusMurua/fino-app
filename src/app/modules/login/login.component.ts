import { Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { InputTextModule } from 'primeng/inputtext';
import { PasswordModule } from 'primeng/password';

import { AuthService } from '../../core/services/auth.service';

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
  //#endregion

  //#region Constructor
  constructor(
    private readonly authService: AuthService,
    private readonly router: Router,
  ) {}
  //#endregion

  //#region Auth

  /** Attempts email login and redirects to /admin on success */
  async submit(): Promise<void> {
    if (!this.email || !this.password) return;

    this.isLoading.set(true);
    this.hasError.set(false);

    const user = await this.authService.emailLogin(this.email, this.password);

    this.isLoading.set(false);

    if (user) {
      const returnUrl = this.authService.consumeReturnUrl();
      this.router.navigateByUrl(returnUrl ?? '/admin');
    } else {
      this.hasError.set(true);
      this.errorMessage.set('Correo o contraseña incorrectos.');
    }
  }

  //#endregion

}
