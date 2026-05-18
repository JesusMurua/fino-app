import { Injectable, OnDestroy, Signal, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { from, firstValueFrom } from 'rxjs';
import { liveQuery } from 'dexie';
import { MessageService } from 'primeng/api';

import {
  AddMovementRequest,
  CashMovement,
  CashRegister,
  CashRegisterSession,
  CloseSessionRequest,
  GenerateLinkCodeResponse,
  OpenSessionRequest,
} from '../models';
import { CashMovementType, CashRegisterStatus } from '../enums';
import { toLocalIsoDate } from '../utils/date.utils';
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

  /**
   * Single shared promise that resolves the device's linked register.
   * Both the constructor effect (post-auth recovery) and explicit callers
   * (`loadActiveSession`) await this same instance, guaranteeing a single
   * `/by-device/{uuid}` round-trip per session lifetime even when multiple
   * cold-boot paths fire concurrently. Reset to `null` on `clear()` /
   * logout so a subsequent login resolves freshly.
   */
  private linkedRegisterResolution: Promise<CashRegister | null> | null = null;

  /**
   * Today's cash sales total (cents) — live-reactive via Dexie `liveQuery`.
   *
   * The query re-runs on every write to the `orders` table (new sale,
   * sync pull, cancellation), so consumers (the admin cash page, the POS
   * header chip, the shared shift panel) all read a single source of
   * truth without each subscribing to their own liveQuery.
   *
   * Initialised in the constructor because `toSignal` requires an
   * injection context and the helper depends on `this.db`, which is
   * a constructor parameter.
   */
  readonly cashSalesTotalCents: Signal<number>;

  /**
   * Expected amount in the cash drawer (cents) — composed from the
   * active session's initial float, today's cash sales, and recorded
   * movements. Returns 0 when there is no open session so consumers can
   * render `$0.00` without null-guarding.
   */
  readonly expectedAmount: Signal<number>;

  /**
   * UI-state signal driving the POS shift sidebar's visibility. Mirrors
   * the pattern used by `DeliveryService.isOpen` so the POS header can
   * toggle the panel through the same domain service that owns session
   * state — no separate UI store is needed for a single boolean.
   */
  private readonly _isPanelOpen = signal(false);
  readonly isPanelOpen = this._isPanelOpen.asReadonly();

  /**
   * Monotonic counter that lets external triggers (the full-screen
   * session-blocker, a future home-screen tile, a keyboard shortcut)
   * ask the shared `<app-shift-management>` to open its "Open Shift"
   * dialog. The shared component subscribes via effect and reacts on
   * each increment, so the same value emitted twice still re-fires the
   * dialog — no need to reset the counter.
   *
   * Centralising the trigger here means the blocker no longer carries
   * its own inline input, drawer-pop, $0-confirm or error mapping —
   * the shared component owns the entire flow regardless of the entry
   * point.
   */
  private readonly _openDialogTrigger = signal(0);
  readonly openDialogTrigger = this._openDialogTrigger.asReadonly();

  //#endregion

  //#region Constructor

  private readonly authService = inject(AuthService);

  constructor(
    private readonly api: ApiService,
    private readonly db: DatabaseService,
    private readonly deviceService: DeviceService,
  ) {
    // Lift the cash-sales liveQuery to the service so every consumer
    // (admin shift page, POS header chip, sidebar shift panel) shares
    // a single Dexie subscription. Without this, each consumer that
    // displayed the chip would spin up its own toSignal/liveQuery and
    // double-render on every order write.
    this.cashSalesTotalCents = toSignal(
      from(liveQuery(() => this.computeCashSalesTotal())),
      { initialValue: 0 },
    );

    this.expectedAmount = computed(() => {
      const session = this._activeSession();
      if (!session) return 0;
      return this.calculateExpected(session, this.cashSalesTotalCents());
    });

    // Auth state mirror:
    //   - Auth → true  : kick the post-auth recovery (resolve linked
    //                    register + refresh active session). Idempotent
    //                    via the `linkedRegisterResolution` promise cache.
    //   - Auth → false : invalidate caches so a subsequent login on the
    //                    same browser does not inherit the previous
    //                    user/device's register/session state.
    effect(() => {
      const authed = this.authService.isAuthenticated();
      if (authed && this.linkedRegisterResolution === null) {
        void this.runPostAuthRecovery();
      } else if (!authed) {
        this.resetLinkedRegisterCache();
      }
    }, { allowSignalWrites: true });

    // Auto-open the shift sidebar on the *transition* from no-session →
    // open-session, so the cashier sees the freshly opened shift summary
    // at a glance. Cold-boot guard: the very first time this effect
    // runs (page load with a session already persisted) we suppress the
    // pop so refreshing the page does not slap the panel open every
    // time. Only subsequent transitions trigger the auto-open.
    let initialSettled = false;
    let prevHasSession = false;
    effect(() => {
      const has = this.hasOpenSession();
      if (!initialSettled) {
        initialSettled = true;
        prevHasSession = has;
        return;
      }
      if (!prevHasSession && has) {
        this.openPanel();
      }
      prevHasSession = has;
    }, { allowSignalWrites: true });
  }

  /**
   * Clears the linked-register promise cache and reactive signals so a
   * subsequent login resolves freshly from the backend. Called by the
   * auth-state effect whenever `isAuthenticated()` flips to false (logout
   * or token expiry). Also stops the polling timer — there is no signed-in
   * session to keep alive.
   */
  private resetLinkedRegisterCache(): void {
    this.linkedRegisterResolution = null;
    this._linkedRegister.set(null);
    this._activeSession.set(null);
    this.stopPolling();
  }

  ngOnDestroy(): void {
    this.stopPolling();
  }

  /**
   * Composes the post-auth recovery: resolve the linked register first,
   * then refresh the active session scoped to it. Kept as a standalone
   * method so the effect can fire-and-forget without inlining a second
   * await chain in the constructor.
   */
  private async runPostAuthRecovery(): Promise<void> {
    try {
      await this.ensureLinkedRegisterResolved();
      await this.refreshActiveSession();
    } catch {
      // Silent — recovery is best-effort
    }
  }

  /**
   * Returns the in-flight (or completed) promise that resolves the
   * device's linked register. Subsequent callers within the same session
   * lifetime share the same promise, eliminating the cold-boot race where
   * `loadActiveSession()` and the constructor effect would otherwise fire
   * `/by-device/{uuid}` twice in parallel and potentially set `_linkedRegister`
   * out of order.
   */
  private ensureLinkedRegisterResolved(): Promise<CashRegister | null> {
    if (!this.linkedRegisterResolution) {
      this.linkedRegisterResolution = this.silentlyRecoverLinkedRegister();
    }
    return this.linkedRegisterResolution;
  }

  /**
   * Best-effort lookup of the register linked to this device's UUID.
   * Silent: never throws, never shows toasts. 404s are treated as "no
   * linked register" and the result is null.
   *
   * Sets `_linkedRegister` on success so reactive consumers (the session
   * blocker setup state machine) flip immediately. Does NOT refresh the
   * active session — that responsibility belongs to the caller, so the
   * recovery + refresh order is explicit at the call site instead of
   * being a hidden side-effect inside this helper.
   */
  private async silentlyRecoverLinkedRegister(): Promise<CashRegister | null> {
    try {
      const uuid = this.deviceService.deviceUuid;
      if (!uuid) return null;

      const register = await this.getRegisterByDevice(uuid);
      if (register) {
        this._linkedRegister.set(register);
      }
      return register;
    } catch {
      return null;
    }
  }
  //#endregion

  //#region Public Methods

  /**
   * Loads the active cash session and starts background polling.
   * Call on login to make hasOpenSession available in POS header.
   *
   * Awaits the linked-register resolution before querying the session
   * endpoint so the request always carries the correct `?registerId=`
   * filter on cold-boot. Without this ordering, the first query would
   * race against the constructor effect and could miss an open session
   * scoped to a register the client hadn't yet hydrated from
   * `/by-device/{uuid}`.
   *
   * @param branchId Branch to query
   */
  async loadActiveSession(branchId: number): Promise<void> {
    await this.ensureLinkedRegisterResolved();
    const session = await this.getOpenSession(branchId);
    this._activeSession.set(session);
    this.startPolling();
  }

  /**
   * Re-queries the open session for the current branch and updates the
   * `_activeSession` signal. Call this after the linked register changes
   * (auto-recovery, takeover, manual link) so the session lookup runs
   * with the correct `registerId` filter.
   */
  async refreshActiveSession(): Promise<void> {
    const branchId = this.authService.branchId;
    const session = await this.getOpenSession(branchId);
    this._activeSession.set(session);
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
   * Opens a new cash register session. The target register is resolved
   * from the device's linked register — callers no longer need to pass
   * a branch id because the backend derives scope from `cashRegisterId`.
   *
   * @param request Opening details (initial amount, opened by)
   */
  async openSession(request: OpenSessionRequest): Promise<CashRegisterSession> {
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
   * Closes the currently open session. The caller is expected to
   * provide the explicit `sessionId` in the request so the backend
   * can reject a stale close attempt with a precise 409 instead of
   * silently closing whatever session happens to be active server-side.
   *
   * @param request Closing details — `sessionId` is now required
   */
  async closeSession(request: CloseSessionRequest): Promise<CashRegisterSession> {
    const session = await firstValueFrom(
      this.api.post<CashRegisterSession>('/cashregister/session/close', request),
    );
    await this.db.cashSessions.put(session);
    this._activeSession.set(null);
    return session;
  }

  /**
   * Adds a cash movement to the current session. The backend resolves
   * scope from the caller's JWT + active session — `branchId` is not
   * needed client-side.
   *
   * @param request Movement details (type, amount, description, created by)
   */
  async addMovement(request: AddMovementRequest): Promise<CashMovement> {
    const movement = await firstValueFrom(
      this.api.post<CashMovement>('/cashregister/movement', request),
    );
    await this.db.cashMovements.put(movement);
    return movement;
  }

  /**
   * Gets session history for a date range from the API. The backend
   * scopes the query to the caller's branch via the JWT.
   *
   * @param from Start date (inclusive)
   * @param to End date (inclusive)
   */
  async getHistory(from: Date, to: Date): Promise<CashRegisterSession[]> {
    return firstValueFrom(
      this.api.get<CashRegisterSession[]>('/cashregister/history', {
        from: toLocalIsoDate(from),
        to: toLocalIsoDate(to),
      }),
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
   * Issues a short-lived 6-character alphanumeric pairing code (secure
   * alphabet `[A-HJKMNP-TV-Z2-9]`, ambiguous chars excluded) that an
   * unattended device (no Owner/Manager physically present) can redeem to
   * bind itself to this cash register. Same UX language and alphabet as the
   * device activation code, scoped to caja-binding instead of device
   * provisioning. Backend invalidates any previously-issued code for the
   * same register on each call so there is at most one active code per caja.
   *
   * @param registerId Register the new code will be scoped to
   */
  async generateLinkCode(registerId: number): Promise<GenerateLinkCodeResponse> {
    return firstValueFrom(
      this.api.post<GenerateLinkCodeResponse>(
        `/cashregister/registers/${registerId}/generate-link-code`,
        {},
      ),
    );
  }

  /**
   * Redeems a pairing code generated by `generateLinkCode`, binding the
   * caller's device (resolved server-side from the device JWT) to the
   * code's target register.
   *
   * The backend response shape is intentionally minimal — the caller
   * should follow up with `resolveLinkedRegister()` to refresh the
   * `_linkedRegister` signal, then `refreshActiveSession()` so the
   * session blocker reactively flips out of `needsLinking`.
   *
   * @param code 6-char code from the secure alphabet `[A-HJKMNP-TV-Z2-9]`
   *             (BDD-017 unified contract) dictated by the admin
   */
  async redeemLinkCode(code: string): Promise<void> {
    await firstValueFrom(
      this.api.post<unknown>(
        '/cashregister/registers/redeem-link-code',
        { code },
      ),
    );
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
  private startPolling(): void {
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

  //#region Shift Panel (UI state)

  /** Opens the POS shift sidebar. */
  openPanel(): void {
    this._isPanelOpen.set(true);
  }

  /** Closes the POS shift sidebar. */
  closePanel(): void {
    this._isPanelOpen.set(false);
  }

  /** Toggles the POS shift sidebar — bound to the chip click handler. */
  togglePanel(): void {
    this._isPanelOpen.update(v => !v);
  }

  /**
   * Asks any mounted `<app-shift-management>` instance to open its
   * "Open Shift" dialog. Used by the full-screen session-blocker so a
   * single click from "Caja Cerrada" lands the cashier directly on the
   * full-fidelity dialog (drawer-pop, $0-confirm, error mapping) instead
   * of duplicating that flow inline.
   */
  requestOpenDialog(): void {
    this._openDialogTrigger.update(v => v + 1);
  }

  //#endregion

  //#region Cash Sales (Dexie liveQuery)

  /**
   * Computes today's cash sales total in cents using the `createdAt`
   * index to narrow the scan, then a non-cancelled / has-cash-payment
   * predicate during the index walk. The accumulator is built with
   * `Collection.each` to avoid materialising an intermediate array.
   *
   * Called by the constructor's `liveQuery` subscription — the returned
   * value flows into the `cashSalesTotalCents` signal automatically on
   * every `orders` table write.
   */
  private async computeCashSalesTotal(): Promise<number> {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    let cashTotal = 0;
    await this.db.orders
      .where('createdAt')
      .aboveOrEqual(todayStart)
      .and(o => !o.cancelledAt && (o.payments ?? []).some(p => p.method === 'Cash'))
      .each(o => { cashTotal += o.totalCents; });

    return cashTotal;
  }

  //#endregion

}
