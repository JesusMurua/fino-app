import { Component, computed, inject, OnInit } from '@angular/core';
import { Router } from '@angular/router';

import { PrinterDestination } from '../../../../core/models';
import { PrinterDestinationService } from '../../../../core/services/printer-destination.service';

/** Icon assigned to each destination based on its sortOrder index */
const DESTINATION_ICONS: Record<number, string> = {
  0: 'pi-shop',
  1: 'pi-coffee',
  2: 'pi-user',
};

const DEFAULT_ICON = 'pi-tag';

interface AreaCard {
  id: number;
  name: string;
  icon: string;
}

@Component({
  selector: 'app-area-selector',
  standalone: true,
  template: `
    <!-- #region Full-screen area selector -->
    <div class="flex align-items-center justify-content-center min-h-screen surface-ground px-3">
      <div class="w-full" style="max-width: 800px">

        <!-- Header -->
        <h1 class="text-900 text-2xl font-semibold text-center mb-5">
          Select your station
        </h1>

        <!-- Area grid -->
        @if (areas().length > 0) {
          <div class="grid">
            @for (area of areas(); track area.id) {
              <div class="col-12 md:col-6 lg:col-4 p-2">
                <div
                  class="flex flex-column align-items-center gap-3
                         border-1 surface-border border-round-xl
                         p-4 cursor-pointer
                         hover:shadow-2 transition-all transition-duration-200"
                  (click)="selectArea(area.id)"
                >
                  <i class="pi {{ area.icon }} text-4xl text-primary"></i>
                  <span class="text-900 text-xl font-medium">{{ area.name }}</span>
                </div>
              </div>
            }
          </div>
        }

        <!-- Empty state -->
        @if (areas().length === 0) {
          <div class="flex flex-column align-items-center gap-3 text-center mt-5">
            <i class="pi pi-inbox text-4xl text-400"></i>
            <span class="text-600 text-lg">
              No active stations configured.
            </span>
          </div>
        }

      </div>
    </div>
    <!-- #endregion -->
  `,
  styles: `
    :host {
      display: block;
    }
  `,
})
export class AreaSelectorComponent implements OnInit {

  //#region Injections

  private readonly router = inject(Router);
  private readonly printerDestinationService = inject(PrinterDestinationService);

  //#endregion

  //#region Signals

  /** Active destinations mapped to area cards with icons */
  readonly areas = computed<AreaCard[]>(() =>
    this.printerDestinationService.activeDestinations().map(
      (dest: PrinterDestination, index: number) => ({
        id: dest.id,
        name: dest.name,
        icon: DESTINATION_ICONS[index] ?? DEFAULT_ICON,
      }),
    ),
  );

  //#endregion

  //#region Lifecycle

  ngOnInit(): void {
    this.printerDestinationService.loadFromLocal();
  }

  //#endregion

  //#region Actions

  /** Navigates to the KDS view for the selected destination */
  selectArea(destinationId: number): void {
    this.router.navigate(['/kitchen', destinationId]);
  }

  //#endregion
}
