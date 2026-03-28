import { Component, OnInit, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ToastModule } from 'primeng/toast';

import { PrinterService } from './core/services/printer.service';
import { InstallBannerComponent } from './shared/components/install-banner/install-banner.component';
import { UpdateBannerComponent } from './shared/components/update-banner/update-banner.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, InstallBannerComponent, UpdateBannerComponent, ToastModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent implements OnInit {

  private readonly printerService = inject(PrinterService);

  ngOnInit(): void {
    this.printerService.tryAutoConnect();
  }

}
