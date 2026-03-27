import { Component, inject } from '@angular/core';

import { PwaService } from '../../../core/services/pwa.service';

@Component({
  selector: 'app-install-banner',
  standalone: true,
  templateUrl: './install-banner.component.html',
  styleUrl: './install-banner.component.scss',
})
export class InstallBannerComponent {
  readonly pwaService = inject(PwaService);
}
