import { Injectable, OnDestroy, computed, effect, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { MessageService } from 'primeng/api';

import {
  AddMovementRequest,
  CashMovement,
  CashRegister,
  CashRegisterSession,
  CloseSessionRequest,
  OpenSessionRequest,
} from '../models';
import { CashMovementType, CashRegisterStatus } from '../enums';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';
import { DatabaseService } from './database.service';
import { DeviceService } from './device.service';

/** Polling interval to check if the session is still open (3 minutes) */
const SESSION_POLL_MS = 180_000;

/**
 * Manages cash register sessions and movements.
 *
 * Sessions are fetched from the API and cached in Dexie.
 * If the API is unreachable, the local cache is used as fallback.
 */
@Injectable({ providedIn: 'root' })
export class CashRegisterService implements OnDestroy {

  //#region State

  private readonly messageService = inject(MessageService);

  private readonly _activeSession = signal<CashRegisterSession | null>(null);
  readonly activeSession = this._activeSession.asReadonly();
  readonly hasOpenSession = computed(() => this._activeSession() !== null);

  private readonly _linkedRegister = signal<CashRegister | null>(null);
  readonly linkedRegister = this._linkedRegister.asReadonly();

  private pollTimer: ReturnType<typeof setInterval> | null = null;

  //#endregion

  //#region Constructor

  private readonly authService = inject(AuthService);

  /** Guard so the silent recovery runs at most once per service lifetime */
  private hasAttemptedRecovery = false;

  constructor(
    private readonly api: ApiService,
    private readonly db: DatabaseService,
    private readonly deviceService: DeviceService,
  ) {
    // Silent auto-recovery: when the user becomes authenticated (either after
    // login or restored from localStorage on a page refresh), look up the
    // register linked to this device's UUID. This prevents the UI from
    // wrongly asking the user to "Vincular" a register that already exists
    // on the backend, which would crash with a 400 error.
    effect(() => {
      if (this.authService.isAuthenticated() && !this.hasAttemptedRecovery) {
        this.hasAttemptedRecovery = true;
        void this.silentlyRecoverLinkedRegister();
      }
    }, { allowSignalWrites: true });
  }

  ngOnDestroy(): void {
    this.stopPolling();
  }

  /**
   * Best-effort lookup of the register linked to this device's UUID.
   * Silent: never throws, never shows toasts. 404s are treated as "no
   * linked register" and ignored.
   */
  private async silentlyRecoverLinkedRegister(): Promise<void> {
    try {
      const uuid = this.deviceService.deviceUuid;
      if (!uuid) return;
      const register = await this.getRegisterByDevice(uuid);
      if (register) this._linkedRegister.set(register);
    } catch {
      // Silent — recovery is best-effort
    }
  }
  //#endregion

  //#region Public Methods

  /**
   * Loads the active cash session and starts background polling.
   * Call on login to make hasOpenSession available in POS header.
   * @param branchId Branch to query
   */
  async loadActiveSession(branchId: number): Promise<void> {
    const session = await this.getOpenSession(branchId);
    this._activeSession.set(session);
    this.startPolling(branchId);
  }

  /**
   * Reusable guard — checks for an open session and shows a toast if not.
   * Call from any component that needs to block actions without a session.
   * @returns true if a session is open; false otherwise (toast shown)
   */
  requireOpenSession(): boolean {
    if (this.hasOpenSession()) return true;

    this.messageService.add({
      severity: 'warn',
      summary: 'Apertura de caja requerida',
      detail: 'Debes abrir un turno de caja para procesar órdenes.',
      life: 5000,
    });
    return false;
  }

  /**
   * Gets the current open session from API and syncs to Dexie.
   * Returns null if no open session exists.
   * @param branchId Branch to query
   */
  async getOpenSession(branchId: number): Promise<CashRegisterSession | null> {
    try {
      const registerId = this._linkedRegister()?.id;
      const url = registerId
        ? `/cashregister/session?registerId=${registerId}`
        : '/cashregister/session';
      const response = await firstValueFrom(
        this.api.get<CashRegisterSession | null>(url),
      );

      if (!response) return null;

      await this.db.cashSessions.put(response);
      return response;
    } catch (error) {
      console.warn('[CashRegisterService] API unreachable — using Dexie fallback:', error);

      const local = await this.db.cashSessions
        .where({ branchId, cashRegisterStatusId: CashRegisterStatus.Open })
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
    const registerId = this._linkedRegister()?.id;
    if (!registerId) {
      throw new Error('Cannot open session: Device is not linked to a physical register.');
    }
    const payload: OpenSessionRequest = {
      ...request,
      cashRegisterId: registerId,
    };
    const session = await firstValueFrom(
      this.api.post<CashRegisterSession>('/cashregister/session/open', payload),
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
      .filter(m => m.cashMovementTypeId === CashMovementType.In || m.cashMovementTypeId === CashMovementType.Out)
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

  //#region Register Methods

  /**
   * Lists all physical cash registers for the active branch.
   * Results are cached in Dexie for offline access.
   */
  async getRegisters(): Promise<CashRegister[]> {
    try {
      const registers = await firstValueFrom(
        this.api.get<CashRegister[]>('/cashregister/registers'),
      );
      await this.db.cashRegisters.bulkPut(registers);
      return registers;
    } catch (error) {
      console.warn('[CashRegisterService] API unreachable — using Dexie fallback for registers:', error);
      return this.db.cashRegisters.toArray();
    }
  }

  /**
   * Creates a new physical cash register.
   * If a register with the same name already exists, the API returns
   * HTTP 409 with `{ error: 'register_name_taken', existingRegisterId, hasOpenSession }`.
   * Pass `takeover: true` on a follow-up call to reclaim the existing register.
   * @param name Human-readable name (e.g. "Caja 1")
   * @param isActive Whether the register is active
   * @param takeover When true, signals the API to reclaim an existing register with the same name
   */
  async createRegister(name: string, isActive: boolean, takeover = false): Promise<CashRegister> {
    const register = await firstValueFrom(
      this.api.post<CashRegister>('/cashregister/registers', { name, isActive, takeover }),
    );
    await this.db.cashRegisters.put(register);
    return register;
  }

  /**
   * Updates an existing physical cash register (name, isActive).
   * @param id Register ID
   * @param payload Fields to update (name, isActive)
   */
  async updateRegister(id: number, payload: Partial<CashRegister>): Promise<CashRegister> {
    const register = await firstValueFrom(
      this.api.put<CashRegister>(`/cashregister/registers/${id}`, payload),
    );
    await this.db.cashRegisters.put(register);
    return register;
  }

  /**
   * Links a device to a cash register via the dedicated endpoint.
   * @param registerId Register ID to link
   * @param deviceUuid UUID of the device to assign
   */
  async linkDevice(registerId: number, deviceUuid: string): Promise<CashRegister> {
    const register = await firstValueFrom(
      this.api.patch<CashRegister>(`/cashregister/registers/${registerId}/link-device`, { deviceUuid }),
    );
    await this.db.cashRegisters.put(register);
    return register;
  }

  /**
   * Unlinks any device from a cash register via the dedicated endpoint.
   * @param registerId Register ID to unlink
   */
  async unlinkDevice(registerId: number): Promise<CashRegister> {
    const register = await firstValueFrom(
      this.api.patch<CashRegister>(`/cashregister/registers/${registerId}/unlink-device`, {}),
    );
    await this.db.cashRegisters.put(register);
    return register;
  }

  /**
   * Looks up the cash register assigned to a specific device UUID.
   * @param uuid Device UUID to look up
   * @returns The linked register, or null if none is assigned
   *
   * Resolution order:
   *   - 200 → cache and return the register
   *   - 404 → no register linked, return null silently (expected case)
   *   - other errors (offline, 500, timeout) → fall back to Dexie cache
   */
  async getRegisterByDevice(uuid: string): Promise<CashRegister | null> {
    try {
      const register = await firstValueFrom(
        this.api.get<CashRegister | null>(`/cashregister/registers/by-device/${uuid}`),
      );
      if (register) {
        await this.db.cashRegisters.put(register);
      }
      return register ?? null;
    } catch (error: unknown) {
      const status = (error as { status?: number })?.status;

      // 404 = no register linked yet — expected, not an error
      if (status === 404) return null;

      // Other failures (offline, 500, timeout) → try Dexie cache
      console.warn('[CashRegisterService] API unreachable — using Dexie fallback for register lookup:', error);
      const local = await this.db.cashRegisters
        .where({ deviceUuid: uuid })
        .first();
      return local ?? null;
    }
  }

  /**
   * Resolves the cash register linked to the current device.
   * Reads the UUID from DeviceService, queries the backend, and updates
   * the linkedRegister signal.
   */
  async resolveLinkedRegister(): Promise<CashRegister | null> {
    const uuid = this.deviceService.deviceUuid;
    const register = await this.getRegisterByDevice(uuid);
    this._linkedRegister.set(register);
    return register;
  }

  //#endregion

  //#region Session Polling

  /**
   * Starts polling the backend every 3 minutes to detect remote session closure.
   * If the backend reports no open session, the signal is cleared immediately.
   */
  private startPolling(branchId: number): void {
    this.stopPolling();
    this.pollTimer = setInterval(async () => {
      try {
        const registerId = this._linkedRegister()?.id;
        const url = registerId
          ? `/cashregister/session?registerId=${registerId}`
          : '/cashregister/session';
        const session = await firstValueFrom(
          this.api.get<CashRegisterSession | null>(url),
        );
        this._activeSession.set(session ?? null);
      } catch {
        // Offline — keep current state, do not clear
      }
    }, SESSION_POLL_MS);
  }

  /** Stops the polling interval */
  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  //#endregion

}
