import { Component, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { ButtonModule } from 'primeng/button';

import { PlanTypeId } from '../../../../core/enums';
import { PLAN_DISPLAY_NAME } from '../../../../core/models';
import { AuthService } from '../../../../core/services/auth.service';
import { environment } from '../../../../../environments/environment';

/** Feature highlight shown in the upgrade landing */
interface ProFeature {
  icon: string;
  title: string;
  description: string;
}

@Component({
  selector: 'app-upgrade',
  standalone: true,
  imports: [ButtonModule],
  templateUrl: './upgrade.component.html',
  styleUrl: './upgrade.component.scss',
})
export class UpgradeComponent {

  //#region Injections

  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);

  //#endregion

  //#region Properties

  /** Human-readable name for the current plan */
  readonly currentPlanName = computed(() =>
    PLAN_DISPLAY_NAME[this.authService.planTypeId()] ?? 'Gratuito',
  );

  /** True when the user is already on Pro or higher */
  readonly isAlreadyPro = computed(() =>
    this.authService.planTypeId() !== PlanTypeId.Free,
  );

  /** Pro feature highlights sourced from the architecture manual */
  readonly proFeatures: ProFeature[] = [
    {
      icon: 'pi-users',
      title: 'Usuarios y productos ilimitados',
      description: 'Quita el tope de 3 usuarios y 100 productos. Crece sin restricciones.',
    },
    {
      icon: 'pi-building',
      title: 'Hasta 3 sucursales',
      description: 'Administra varias ubicaciones desde la misma cuenta con catálogo sincronizado.',
    },
    {
      icon: 'pi-mobile',
      title: 'Modo Mesero',
      description: 'Tus meseros toman órdenes en el celular y la comanda llega directo a la Caja y a la Cocina.',
    },
    {
      icon: 'pi-desktop',
      title: 'Pantallas de Cocina (KDS)',
      description: 'Vincula tablets en cocina y barra para ver las órdenes en tiempo real por área.',
    },
    {
      icon: 'pi-receipt',
      title: 'Facturación Electrónica (CFDI)',
      description: 'Emite facturas al SAT desde el POS con los datos fiscales de tus clientes.',
    },
    {
      icon: 'pi-chart-line',
      title: 'Reportes avanzados',
      description: 'Gráficas, analítica de ventas y exportación a Excel para tomar mejores decisiones.',
    },
    {
      icon: 'pi-id-card',
      title: 'Clientes, Fiado y Lealtad',
      description: 'Base de datos de clientes, cuentas por cobrar y programa de puntos para retener.',
    },
    {
      icon: 'pi-tag',
      title: 'Promociones y combos',
      description: 'Crea descuentos, 2x1, bundles y promociones por horario.',
    },
  ];

  //#endregion

  //#region Actions

  /** Opens the landing page pricing section in a new tab */
  openCheckout(): void {
    window.open(`${environment.landingUrl}/#precios`, '_blank');
  }

  /** Returns to admin dashboard */
  goBack(): void {
    this.router.navigate(['/admin']);
  }

  //#endregion

}
