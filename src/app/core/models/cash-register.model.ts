import { CashMovementType, CashRegisterStatus } from '../enums';

/** A physical cash register (caja fisica) */
export interface CashRegister {
  id: number;
  branchId: number;
  name: string;
  isActive: boolean;
  deviceUuid?: string;
  /**
   * Server-side strict device identifier. The backend resolves the
   * caller's `deviceUuid` to this `deviceId` and exposes both on the
   * DTO so future flows can prefer the strict ID for queries while
   * the device itself only ever knows its local UUID. Optional until
   * the backend always emits it.
   */
  deviceId?: number;
  /**
   * True when the register currently has an OPEN cash session.
   *
   * Optional because not every backend response populates it — the
   * `/cashregister/registers` list endpoint may include it for the
   * admin view, while `/by-device/{uuid}` may omit it. Consumers MUST
   * fall back to a session-fetch when this field is undefined and the
   * decision depends on session state (see admin-registers' device
   * reassignment flow).
   */
  hasOpenSession?: boolean;
  createdAt?: string;
}

/** A cash register session (turno de caja) */
export interface CashRegisterSession {
  id: number;
  branchId: number;
  cashRegisterId?: number;
  openedBy: string;
  openedAt: Date;
  initialAmountCents: number;
  closedBy?: string;
  closedAt?: Date;
  countedAmountCents?: number;
  notes?: string;
  /** 1=Open, 2=Closed, 3=Auditing */
  cashRegisterStatusId: CashRegisterStatus;
  movements?: CashMovement[];
}

/** A cash movement within an open session */
export interface CashMovement {
  id: number;
  sessionId: number;
  /** 1=In, 2=Out, 3=Adjustment */
  cashMovementTypeId: CashMovementType;
  amountCents: number;
  description: string;
  createdBy: string;
  createdAt: Date;
}

/**
 * Request body for opening a new session.
 *
 * The acting user (`openedBy` on the response) is resolved server-side
 * from the JWT — the client must NOT send it in the body. The backend
 * also resolves the caller's device UUID into a strict `deviceId`, so
 * `cashRegisterId` is the only register-scoping field the client needs
 * to provide.
 */
export interface OpenSessionRequest {
  initialAmountCents: number;
  cashRegisterId?: number;
}

/**
 * Request body for closing the current session.
 *
 * The acting user (`closedBy` on the response) is resolved server-side
 * from the JWT — the client must NOT send it in the body.
 */
export interface CloseSessionRequest {
  /**
   * Explicit identifier of the session being closed. Making this
   * required (rather than letting the backend infer it from the
   * JWT + device) closes the race where a stale frontend tries to
   * close a session that was already closed remotely — the backend
   * can now reject with a precise 409 "session mismatch" instead
   * of silently closing the wrong record.
   */
  sessionId: number;
  countedAmountCents: number;
  notes?: string;
}

/**
 * Request body for adding a cash movement.
 *
 * The acting user (`createdBy` on the response) is resolved server-side
 * from the JWT — the client must NOT send it in the body. The backend
 * scopes the movement to the active session via the JWT + device.
 */
export interface AddMovementRequest {
  /** 1=In, 2=Out, 3=Adjustment */
  cashMovementTypeId: CashMovementType;
  amountCents: number;
  description: string;
}

/**
 * Response from `POST /api/cashregister/registers/{id}/generate-link-code`.
 *
 * Issues a short-lived, one-shot pairing code that an unattended device
 * (no Owner/Manager physically present) can redeem to bind itself to the
 * cash register. The admin reads the `code` to the cashier, the cashier
 * types it on the iPad's session blocker — same UX language as the
 * device activation code, distinct domain (caja-binding, not device
 * provisioning).
 */
export interface GenerateLinkCodeResponse {
  /** Alphanumeric uppercase code (charset excludes O/I/0/1) */
  code: string;
  /** Cash register the code is scoped to */
  cashRegisterId: number;
  /** ISO date — when the code was issued */
  createdAt: string;
  /** ISO date — when the code stops being valid */
  expiresAt: string;
}

/** Request body for `POST /api/cashregister/registers/redeem-link-code`. */
export interface RedeemLinkCodeRequest {
  /** Alphanumeric uppercase 6-char code dictated by the admin */
  code: string;
}
