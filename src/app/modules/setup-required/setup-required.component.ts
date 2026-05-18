import { Component, inject } from '@angular/core';

import { AuthService } from '../../core/services/auth.service';

/**
 * Splash mostrado al staff (cajeros, meseros, hosts) cuando el negocio
 * no tiene `defaultTaxId` configurado. La caja queda bloqueada hasta
 * que un admin configure los impuestos en `/admin/settings` (Fiscal).
 *
 * Es una ruta lazy-loaded standalone para que sea bookmarkable y
 * shareable: el manager puede mandarle el URL al cajero al teléfono.
 *
 * El admin equivalente NO ve este splash — va directo al dashboard
 * con un banner sticky rojo. La separación está en `DeviceRoutingService`.
 */
@Component({
  selector: 'app-setup-required',
  standalone: true,
  templateUrl: './setup-required.component.html',
  styleUrl: './setup-required.component.scss',
})
export class SetupRequiredComponent {
  private readonly authService = inject(AuthService);

  /** Cierra sesión y vuelve al portal de login */
  logout(): void {
    this.authService.logout();
  }

  /** Reintenta — recarga la página, el guard volverá a evaluar */
  retry(): void {
    window.location.reload();
  }
}
