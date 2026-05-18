import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { TagModule } from 'primeng/tag';

import { CatalogService } from '../../../../core/services/catalog.service';
import { AccessDashboardSignalrService } from '../../../../core/services/access-dashboard.signalr.service';

/**
 * Real-time access control dashboard for gym reception.
 *
 * Subscribes to the `AccessAttempted` SignalR event broadcasted by the
 * backend `BridgeHub` for the receptionist's branch. Renders a live feed
 * of the last 50 access attempts (granted + denied + unknown QR) with a
 * connection-status indicator in the header.
 *
 * Resilient to two failure modes via guards in the SignalR service:
 *   - Tenant plan lacks `RealtimeAccessControl` → renders an upsell banner
 *   - Catalog endpoint unreachable → labels degrade to "Motivo desconocido"
 *     but the live feed keeps working.
 */
@Component({
  selector: 'app-access-dashboard',
  standalone: true,
  imports: [DatePipe, TagModule],
  templateUrl: './access-dashboard.component.html',
  styleUrl: './access-dashboard.component.scss',
})
export class AccessDashboardComponent implements OnInit, OnDestroy {

  //#region Properties

  readonly signalrService = inject(AccessDashboardSignalrService);
  private readonly catalogService = inject(CatalogService);

  /** id → Spanish label map sourced from `/catalog/access-reasons`. */
  readonly reasonMap = signal<Map<number, string>>(new Map());

  //#endregion

  //#region Lifecycle

  async ngOnInit(): Promise<void> {
    try {
      const reasons = await this.catalogService.getAccessReasons();
      this.reasonMap.set(new Map(reasons.map(r => [r.id, r.name])));
    } catch (err) {
      // Non-fatal — labels fall back to "Motivo desconocido" but the
      // live feed keeps working. SignalR start runs unconditionally below.
      console.warn('[AccessDashboard] Catalog load failed:', err);
    } finally {
      void this.signalrService.startConnection();
    }
  }

  ngOnDestroy(): void {
    void this.signalrService.stopConnection();
  }

  //#endregion

  //#region Helpers

  /** Translates a backend `accessReasonId` to a display label. */
  getReasonText(reasonId: number): string {
    return this.reasonMap().get(reasonId) ?? 'Motivo desconocido';
  }

  //#endregion

}
