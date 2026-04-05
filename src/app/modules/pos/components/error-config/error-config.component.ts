import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';

import { ConfigService } from '../../../../core/services/config.service';

@Component({
  selector: 'app-error-config',
  standalone: true,
  template: `
    <div class="error-config">
      <i class="pi pi-exclamation-triangle error-config__icon"></i>
      <h1 class="error-config__title">No se pudo cargar la configuración</h1>
      <p class="error-config__text">Verifica tu conexión e intenta de nuevo.</p>
      <button
        type="button"
        class="error-config__btn"
        [disabled]="isRetrying()"
        (click)="retry()"
      >
        @if (isRetrying()) {
          <i class="pi pi-spinner pi-spin"></i>
        }
        Reintentar
      </button>
    </div>
  `,
  styles: [`
    .error-config {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 80dvh;
      padding: 24px;
      text-align: center;
      gap: 12px;
    }
    .error-config__icon { font-size: 48px; color: #D97706; }
    .error-config__title { margin: 0; font-size: 20px; font-weight: 700; color: #111827; }
    .error-config__text { margin: 0; font-size: 16px; color: #6B7280; }
    .error-config__btn {
      display: inline-flex; align-items: center; gap: 8px;
      margin-top: 16px; padding: 12px 32px;
      border: none; border-radius: 12px;
      background: #16A34A; color: white;
      font-size: 16px; font-weight: 600; font-family: inherit;
      cursor: pointer;
    }
    .error-config__btn:disabled { opacity: 0.6; cursor: not-allowed; }
    .error-config__btn:active { background: #15803D; }
  `],
})
export class ErrorConfigComponent {

  private readonly configService = inject(ConfigService);
  private readonly router = inject(Router);

  readonly isRetrying = signal(false);

  /** Retries loading config and navigates back to /pin on success */
  async retry(): Promise<void> {
    this.isRetrying.set(true);
    try {
      await this.configService.load();
      const experience = this.configService.posExperience();
      if (experience) {
        this.router.navigate(['/pin']);
      }
    } catch { /* stay on this page */ }
    this.isRetrying.set(false);
  }
}
