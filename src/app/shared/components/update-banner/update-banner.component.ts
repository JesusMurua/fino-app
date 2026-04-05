import { Component, inject } from '@angular/core';

import { PwaService } from '../../../core/services/pwa.service';

@Component({
  selector: 'app-update-banner',
  standalone: true,
  templateUrl: './update-banner.component.html',
  styleUrl: './update-banner.component.scss',
})
export class UpdateBannerComponent {
  readonly pwaService = inject(PwaService);
}
