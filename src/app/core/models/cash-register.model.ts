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
