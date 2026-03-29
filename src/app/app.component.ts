import { Component, OnInit, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ToastModule } from 'primeng/toast';
import { NgHttpLoaderComponent } from 'ng-http-loader';

import { PrinterService } from './core/services/printer.service';
import { SyncService } from './core/services/sync.service';
import { InstallBannerComponent } from './shared/components/install-banner/install-banner.component';
import { UpdateBannerComponent } from './shared/components/update-banner/update-banner.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, InstallBannerComponent, UpdateBannerComponent, ToastModule, NgHttpLoaderComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent implements OnInit {

  private readonly printerService = inject(PrinterService);
  private readonly syncService = inject(SyncService);

  /** URLs excluded from the global loading spinner (polling endpoints) */
  readonly filteredUrls = [
    'table/status',
    'orders/pull',
    'orders/last-number',
    'branch/.*/config',
  ];

  ngOnInit(): void {
    this.printerService.tryAutoConnect();
  }

}
