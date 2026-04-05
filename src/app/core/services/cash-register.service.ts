import { Injectable, computed, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import {
  AddMovementRequest,
  CashMovement,
  CashRegisterSession,
  CloseSessionRequest,
  OpenSessionRequest,
} from '../models';
import { ApiService } from './api.service';
import { DatabaseService } from './database.service';

/**
 * Manages cash register sessions and movements.
 *
 * Sessions are fetched from the API and cached in Dexie.
 * If the API is unreachable, the local cache is used as fallback.
 */
@Injectable({ providedIn: 'root' })
export class CashRegisterService {

  //#region State

  private readonly _activeSession = signal<CashRegisterSession | null>(null);
  readonly activeSession = this._activeSession.asReadonly();
  readonly hasOpenSession = computed(() => this._activeSession() !== null);

  //#endregion

  //#region Constructor
  constructor(
    private readonly api: ApiService,
    private readonly db: DatabaseService,
  ) {}
  //#endregion

  //#region Public Methods

  /**
   * Loads the active cash session and updates the signal.
   * Call on login to make hasOpenSession available in POS header.
   * @param branchId Branch to query
   */
  async loadActiveSession(branchId: number): Promise<void> {
    const session = await this.getOpenSession(branchId);
    this._activeSession.set(session);
  }

  /**
   * Gets the current open session from API and syncs to Dexie.
   * Returns null if no open session exists.
   * @param branchId Branch to query
   */
  async getOpenSession(branchId: number): Promise<CashRegisterSession | null> {
    try {
      const response = await firstValueFrom(
        this.api.get<CashRegisterSession | null>('/cashregister/session'),
      );

      if (!response) return null;

      await this.db.cashSessions.put(response);
      return response;
    } catch (error) {
      console.warn('[CashRegisterService] API unreachable — using Dexie fallback:', error);

      const local = await this.db.cashSessions
        .where({ branchId, status: 'open' })
        .first();
      return local ?? null;
    }
  }

  /**
   * Opens a new cash register session.
   * @param branchId Branch to open session for
   * @param request Opening details (initial amount, opened by)
   */
  async openSession(branchId: number, request: OpenSessionRequest): Promise<CashRegisterSession> {
    const session = await firstValueFrom(
      this.api.post<CashRegisterSession>('/cashregister/session/open', request),
    );
    await this.db.cashSessions.put(session);
    this._activeSession.set(session);
    return session;
  }

  /**
   * Closes the current open session.
   * @param branchId Branch to close session for
   * @param request Closing details (counted amount, closed by, notes)
   */
  async closeSession(branchId: number, request: CloseSessionRequest): Promise<CashRegisterSession> {
    const session = await firstValueFrom(
      this.api.post<CashRegisterSession>('/cashregister/session/close', request),
    );
    await this.db.cashSessions.put(session);
    this._activeSession.set(null);
    return session;
  }

  /**
   * Adds a cash movement to the current session.
   * @param branchId Branch the session belongs to
   * @param request Movement details (type, amount, description, created by)
   */
  async addMovement(branchId: number, request: AddMovementRequest): Promise<CashMovement> {
    const movement = await firstValueFrom(
      this.api.post<CashMovement>('/cashregister/movement', request),
    );
    await this.db.cashMovements.put(movement);
    return movement;
  }

  /**
   * Gets session history for a date range from API.
   * @param branchId Branch to query
   * @param from Start date (inclusive)
   * @param to End date (inclusive)
   */
  async getHistory(branchId: number, from: Date, to: Date): Promise<CashRegisterSession[]> {
    return firstValueFrom(
      this.api.get<CashRegisterSession[]>(
        `/cashregister/history?from=${from.toISOString()}&to=${to.toISOString()}`,
      ),
    );
  }

  /**
   * Calculates expected amount in cash register.
   * Formula: initialAmount + cashSales - withdrawals - expenses
   * @param session Current open session (with movements)
   * @param cashSalesTotal Total cash sales today in cents
   */
  calculateExpected(session: CashRegisterSession, cashSalesTotal: number): number {
    const movements = session.movements ?? [];
    const outflows = movements
      .filter(m => m.type === 'withdrawal' || m.type === 'expense')
      .reduce((sum, m) => sum + m.amountCents, 0);

    return session.initialAmountCents + cashSalesTotal - outflows;
  }

  /**
   * Formats amount from cents to display string.
   * @param cents Amount in cents
   * @returns Formatted string (e.g. "$1,234.00")
   */
  formatAmount(cents: number): string {
    return (cents / 100).toLocaleString('es-MX', {
      style: 'currency',
      currency: 'MXN',
      minimumFractionDigits: 2,
    });
  }

  //#endregion

}
