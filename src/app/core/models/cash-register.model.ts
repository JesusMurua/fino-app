/** A cash register session (turno de caja) */
export interface CashRegisterSession {
  id: number;
  branchId: number;
  openedBy: string;
  openedAt: Date;
  initialAmountCents: number;
  closedBy?: string;
  closedAt?: Date;
  countedAmountCents?: number;
  notes?: string;
  status: 'open' | 'closed';
  movements?: CashMovement[];
}

/** A cash movement within an open session */
export interface CashMovement {
  id: number;
  sessionId: number;
  type: 'withdrawal' | 'expense' | 'adjustment';
  amountCents: number;
  description: string;
  createdBy: string;
  createdAt: Date;
}

/** Request body for opening a new session */
export interface OpenSessionRequest {
  initialAmountCents: number;
  openedBy: string;
}

/** Request body for closing the current session */
export interface CloseSessionRequest {
  countedAmountCents: number;
  closedBy: string;
  notes?: string;
}

/** Request body for adding a cash movement */
export interface AddMovementRequest {
  type: 'withdrawal' | 'expense' | 'adjustment';
  amountCents: number;
  description: string;
  createdBy: string;
}
