import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { EnrollQrRequestDto, QrStatusResponseDto } from '../models/qr-access.model';
import { ApiService } from './api.service';

/**
 * HTTP surface for the Gym Access Control QR enrollment flow.
 *
 * Phase 3 backend contract (auth: Owner/Manager):
 *   - GET    `/AccessControl/customers/{id}/qr-status`
 *   - POST   `/AccessControl/enroll-qr`
 *   - DELETE `/AccessControl/customers/{id}/qr`
 *
 * Enroll validates the token against the active `QrSecret` and stores its
 * HMAC digest; revoke logs a forensic audit row post-SaveChanges.
 */
@Injectable({ providedIn: 'root' })
export class QrAccessService {

  private readonly api = inject(ApiService);

  /** Fetches whether the customer currently has an enrolled QR token. */
  async getQrStatus(customerId: number): Promise<QrStatusResponseDto> {
    return firstValueFrom(
      this.api.get<QrStatusResponseDto>(`/AccessControl/customers/${customerId}/qr-status`),
    );
  }

  /** Enrolls a raw QR token for the given customer. */
  async enrollQr(request: EnrollQrRequestDto): Promise<void> {
    await firstValueFrom(this.api.post<void>('/AccessControl/enroll-qr', request));
  }

  /** Revokes the enrolled QR token. Backend records a forensic audit row. */
  async revokeQr(customerId: number): Promise<void> {
    await firstValueFrom(
      this.api.delete<void>(`/AccessControl/customers/${customerId}/qr`),
    );
  }
}
