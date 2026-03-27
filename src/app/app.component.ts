import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ToastModule } from 'primeng/toast';

import { InstallBannerComponent } from './shared/components/install-banner/install-banner.component';
import { UpdateBannerComponent } from './shared/components/update-banner/update-banner.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, InstallBannerComponent, UpdateBannerComponent, ToastModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent {}
