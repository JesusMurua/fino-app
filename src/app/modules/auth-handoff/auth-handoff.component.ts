import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';

import { ProgressSpinnerModule } from 'primeng/progressspinner';

import { AuthService } from '../../core/services/auth.service';

/**
 * Impersonation handoff endpoint. Receives a short-lived Owner JWT
 * issued by the super-admin's `/api/Admin/businesses/{id}/impersonate`
 * endpoint in the URL fragment (`#token=<jwt>`) and seeds the local
 * session with it.
 *
 * Why fragment instead of query string: fragments never leave the
 * browser — they are not sent to the server, not logged by intermediate
 * proxies, and stay out of standard access logs. The component clears
 * the fragment from the URL via `history.replaceState` before any
 * subsequent navigation so the token does not linger in `window.location`.
 *
 * Public route (no `authGuard`) — the whole point is to bootstrap a
 * session from an external token. Failure paths bounce to `/` (the
 * auth portal) with a `toast` query flag the portal can read to surface
 * the error.
 */
@Component({
  selector: 'app-auth-handoff',
  standalone: true,
  imports: [CommonModule, ProgressSpinnerModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="handoff-shell">
      <p-progressSpinner styleClass="handoff-spinner" strokeWidth="3"></p-progressSpinner>
      <p class="handoff-message">{{ message() }}</p>
      @if (error()) {
        <p class="handoff-error">{{ error() }}</p>
      }
    </div>
  `,
  styles: [`
    .handoff-shell {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      gap: 16px;
      padding: 24px;
      background: #F8FAFC;
    }
    :host ::ng-deep .handoff-spinner {
      width: 48px;
      height: 48px;
    }
    .handoff-message {
      font-size: 16px;
      color: #374151;
      margin: 0;
    }
    .handoff-error {
      font-size: 14px;
      color: #DC2626;
      margin: 0;
      max-width: 360px;
      text-align: center;
    }
  `],
})
export class AuthHandoffComponent implements OnInit {

  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);

  readonly message = signal('Iniciando sesión...');
  readonly error = signal<string | null>(null);

  ngOnInit(): void {
    const token = this.parseTokenFromFragment();

    // Strip the fragment immediately so the JWT does not linger in the
    // address bar / browser history regardless of what happens next.
    history.replaceState(null, '', window.location.pathname);

    if (!token) {
      this.bounceWithError('No se recibió el token de impersonación.');
      return;
    }

    this.authService.handleImpersonationToken(token).subscribe({
      next: () => {
        // Land on the back office — `welcomeShownGuard` will route to
        // `/welcome` if the impersonated Owner has not yet closed it.
        this.router.navigate(['/admin/dashboard']);
      },
      error: () => {
        this.bounceWithError('No fue posible iniciar la sesión impersonada. El token pudo haber expirado.');
      },
    });
  }

  private parseTokenFromFragment(): string | null {
    const hash = window.location.hash;
    if (!hash || hash.length < 2) return null;
    const params = new URLSearchParams(hash.slice(1));
    const token = params.get('token');
    return token && token.split('.').length === 3 ? token : null;
  }

  private bounceWithError(message: string): void {
    this.error.set(message);
    this.message.set('Redirigiendo...');
    setTimeout(() => this.router.navigate(['/']), 2500);
  }
}
