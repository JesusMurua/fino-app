import { CashMovementType, CashRegisterStatus } from '../enums';

/** A physical cash register (caja fisica) */
export interface CashRegister {
  id: number;
  branchId: number;
  name: string;
  isActive: boolean;
  deviceUuid?: string;
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

/** Request body for opening a new session */
export interface OpenSessionRequest {
  initialAmountCents: number;
  openedBy: string;
  cashRegisterId?: number;
}

/** Request body for closing the current session */
export interface CloseSessionRequest {
  countedAmountCents: number;
  closedBy: string;
  notes?: string;
}

/** Request body for adding a cash movement */
export interface AddMovementRequest {
  /** 1=In, 2=Out, 3=Adjustment */
  cashMovementTypeId: CashMovementType;
  amountCents: number;
  description: string;
  createdBy: string;
}
