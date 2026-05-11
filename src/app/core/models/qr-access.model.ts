/**
 * Response from `GET /AccessControl/customers/{id}/qr-status`.
 *
 * The backend stores the QR token as an HMAC-irreversible digest, so the
 * admin surface only ever knows whether a token is enrolled — never the
 * raw value or a masked preview. Phase 3 contract.
 */
export interface QrStatusResponseDto {
  hasEnrolledQr: boolean;
}

/**
 * Request body for `POST /AccessControl/enroll-qr`.
 *
 * `customerId` lives in the body (RPC-style endpoint) rather than the URL.
 */
export interface EnrollQrRequestDto {
  customerId: number;
  qrToken: string;
}
