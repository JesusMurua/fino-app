import { inject, Injectable, signal } from '@angular/core';
import { HubConnection, HubConnectionBuilder, HubConnectionState, LogLevel } from '@microsoft/signalr';
import { firstValueFrom } from 'rxjs';
import { MessageService } from 'primeng/api';

import { PrintJobDto } from '../models';
import { SIGNALR_BASE_URL } from '../utils/signalr.utils';
import { ApiService } from './api.service';
import { DatabaseService } from './database.service';
import { DeviceService } from './device.service';
import { KitchenAudioService } from './kitchen-audio.service';

/** How often the fallback polling fires when SignalR is down (15 s) */
const POLL_INTERVAL_MS = 15_000;

/** How often to retry connecting SignalR while in polling mode (60 s) */
const HUB_RETRY_INTERVAL_MS = 60_000;

/** Connection health exposed to the UI */
export type KdsConnectionState = 'connected' | 'reconnecting' | 'disconnected';

/**
 * Manages pending print jobs for the KDS (Kitchen Display System).
 *
 * - Fetches jobs from GET /api/print-jobs/pending?destination={id}
 * - Falls back to Dexie `pendingPrintJobs` when offline
 * - Real-time updates via SignalR hub `/hubs/kds`
 * - Fallback HTTP polling every 15 s when SignalR is dead
 * - Periodically retries SignalR (60 s) while in polling mode
 * - Plays an audio beep on each new PrintJobCreated event
 * - Provides optimistic updates for markAsInProgress() and markAsPrinted()
 * - Queues failed status transitions in Dexie and drains them on reconnect
 * - Filters out Receipt tickets — KDS only shows Kitchen jobs
 */
@Injectable({ providedIn: 'root' })
export class KitchenService {
    //#region Properties

    /** Active kitchen-only print jobs for the KDS display */
    readonly pendingJobs = signal<PrintJobDto[]>([]);

    /** SignalR connection health — drives the UI indicator in the header */
    readonly connectionState = signal<KdsConnectionState>('disconnected');

    /** Destination currently connected — used by refresh() */
    private currentDestinationId: number | null = null;

    /** Active SignalR connection to the /hubs/kds endpoint */
    private hubConnection: HubConnection | null = null;

    /** True while syncPendingUpdates is running — prevents concurrent drains */
    private isSyncing = false;

    /** Fallback polling timer — active only when SignalR is dead */
    private pollingTimerId: ReturnType<typeof setInterval> | null = null;

    /** Periodic SignalR retry timer — active only while in polling mode */
    private hubRetryTimerId: ReturnType<typeof setInterval> | null = null;

    //#endregion

    //#region Constructor & Lifecycle

    private readonly messageService = inject(MessageService, { optional: true });
    private readonly deviceService = inject(DeviceService);
    private readonly kitchenAudio = inject(KitchenAudioService);

    constructor(
        private readonly api: ApiService,
        private readonly db: DatabaseService,
    ) { }

    //#endregion

    //#region Public Methods

    /**
     * Loads jobs immediately and opens a SignalR connection to receive
     * real-time PrintJobCreated events for the given destination.
     * If SignalR fails, falls back to HTTP polling automatically.
     * @param destinationId The printer destination to display jobs for
     */
    start(destinationId: number): void {
        this.currentDestinationId = destinationId;
        void this.loadPendingPrintJobs(destinationId);
        void this.connectHub(destinationId);
    }

    /**
     * Closes the SignalR connection, stops polling, and clears state.
     * Call from the KDS component on destroy.
     */
    stop(): void {
        this.stopPolling();
        if (this.hubConnection) {
            void this.hubConnection.stop();
            this.hubConnection = null;
        }
        this.pendingJobs.set([]);
        this.connectionState.set('disconnected');
        this.currentDestinationId = null;
    }

    /**
     * Triggers an immediate reload of jobs for the current destination.
     * Called by NotificationService when a push notification arrives.
     */
    async refresh(): Promise<void> {
        if (this.currentDestinationId !== null) {
            await this.loadPendingPrintJobs(this.currentDestinationId);
        }
    }

    /**
     * Advances a job to InProgress with offline-first semantics.
     * @param id The print job numeric ID
     */
    async markAsInProgress(id: number): Promise<void> {
        this.pendingJobs.update(jobs =>
            jobs.map(j => j.id === id ? { ...j, status: 'InProgress' as const } : j),
        );
        await this.db.pendingPrintJobs.update(id, { status: 'InProgress' });

        try {
            await firstValueFrom(this.api.patch(`/print-jobs/${id}/in-progress`, {}));
        } catch {
            await this.queueOfflineUpdate(id, 'InProgress');
        }
    }

    /**
     * Removes a job from the display with offline-first semantics.
     * @param id The print job numeric ID
     */
    async markAsPrinted(id: number): Promise<void> {
        this.pendingJobs.update(jobs => jobs.filter(j => j.id !== id));
        await this.db.pendingPrintJobs.delete(id);

        try {
            await firstValueFrom(this.api.patch(`/print-jobs/${id}/printed`, {}));
        } catch {
            await this.queueOfflineUpdate(id, 'Printed');
        }
    }

    //#endregion

    //#region Offline Sync Queue

    private async queueOfflineUpdate(
        printJobId: number,
        status: 'InProgress' | 'Printed',
    ): Promise<void> {
        await this.db.pendingPrintJobUpdates.add({
            printJobId,
            status,
            createdAt: new Date().toISOString(),
        });
        this.messageService?.add({
            severity: 'info',
            summary: 'Guardado offline',
            detail: 'Se sincronizará automáticamente.',
            life: 3000,
        });
    }

    async syncPendingUpdates(): Promise<void> {
        if (this.isSyncing) return;
        this.isSyncing = true;

        try {
            const pending = await this.db.pendingPrintJobUpdates.toArray();
            for (const record of pending) {
                const endpoint = record.status === 'InProgress'
                    ? `/print-jobs/${record.printJobId}/in-progress`
                    : `/print-jobs/${record.printJobId}/printed`;

                try {
                    await firstValueFrom(this.api.patch(endpoint, {}));
                    await this.db.pendingPrintJobUpdates.delete(record.id!);
                } catch {
                    // Still offline — leave in queue for next attempt
                }
            }
        } finally {
            this.isSyncing = false;
        }
    }

    //#endregion

    //#region SignalR + Fallback Polling

    /**
     * Opens a SignalR connection. On success sets `connected` and kills
     * any active polling. On failure or permanent close, falls back to
     * HTTP polling and periodically retries SignalR.
     */
    private async connectHub(destinationId: number): Promise<void> {
        if (this.hubConnection) {
            await this.hubConnection.stop().catch(() => undefined);
            this.hubConnection = null;
        }

        const hubUrl = `${SIGNALR_BASE_URL}/hubs/kds?destination=${destinationId}`;

        this.hubConnection = new HubConnectionBuilder()
            .withUrl(hubUrl, {
                accessTokenFactory: () => this.deviceService.getDeviceToken() ?? '',
            })
            .withAutomaticReconnect()
            .configureLogging(LogLevel.Warning)
            .build();

        // Real-time event: refresh + beep
        this.hubConnection.on('PrintJobCreated', () => {
            if (this.currentDestinationId !== null) {
                void this.loadPendingPrintJobs(this.currentDestinationId);
            }
            this.kitchenAudio.playNewOrderBeep();
        });

        this.hubConnection.onreconnecting(() => {
            this.connectionState.set('reconnecting');
        });

        this.hubConnection.onreconnected(() => {
            this.connectionState.set('connected');
            this.stopPolling();
            if (this.currentDestinationId !== null) {
                void this.loadPendingPrintJobs(this.currentDestinationId);
            }
            void this.syncPendingUpdates();
        });

        // SignalR gave up after its default 4 retries — fall back to polling
        this.hubConnection.onclose(() => {
            this.connectionState.set('disconnected');
            this.startFallbackPolling();
        });

        try {
            await this.hubConnection.start();
            this.connectionState.set('connected');
            this.stopPolling();
        } catch (error) {
            console.warn('[KitchenService] SignalR connection failed:', error);
            this.connectionState.set('disconnected');
            this.startFallbackPolling();
        }
    }

    /**
     * Starts the fallback HTTP polling loop AND a slower SignalR retry loop.
     * Both are cleared when SignalR reconnects or the service stops.
     */
    private startFallbackPolling(): void {
        if (this.pollingTimerId !== null) return;

        this.pollingTimerId = setInterval(() => {
            if (this.currentDestinationId !== null) {
                void this.loadPendingPrintJobs(this.currentDestinationId);
            }
        }, POLL_INTERVAL_MS);

        this.hubRetryTimerId = setInterval(() => {
            if (this.currentDestinationId !== null) {
                void this.connectHub(this.currentDestinationId);
            }
        }, HUB_RETRY_INTERVAL_MS);
    }

    /** Clears both the polling and the hub-retry timers */
    private stopPolling(): void {
        if (this.pollingTimerId !== null) {
            clearInterval(this.pollingTimerId);
            this.pollingTimerId = null;
        }
        if (this.hubRetryTimerId !== null) {
            clearInterval(this.hubRetryTimerId);
            this.hubRetryTimerId = null;
        }
    }

    //#endregion

    //#region Private Helpers

    /**
     * Fetches pending jobs from the API, filters to Kitchen-only tickets,
     * caches in Dexie, and drains any queued offline transitions.
     * On failure, falls back to Dexie local data.
     */
    private async loadPendingPrintJobs(destinationId: number): Promise<void> {
        try {
            const allJobs = await firstValueFrom(
                this.api.get<PrintJobDto[]>(
                    `/print-jobs/pending?destination=${destinationId}`,
                ),
            );

            // KDS only shows kitchen tickets — filter out receipts
            const jobs = allJobs.filter(j => j.ticketType === 'Kitchen');

            // Refresh the local cache for this destination
            await this.db.pendingPrintJobs
                .where('destinationId')
                .equals(destinationId)
                .delete();
            if (jobs.length > 0) {
                await this.db.pendingPrintJobs.bulkPut(jobs);
            }

            this.pendingJobs.set(jobs);
        } catch {
            // Offline fallback: show locally cached jobs (already filtered on write)
            const local = await this.db.pendingPrintJobs
                .where('destinationId')
                .equals(destinationId)
                .filter(j => j.status === 'Pending' || j.status === 'InProgress')
                .toArray();

            this.pendingJobs.set(local);
        }

        void this.syncPendingUpdates();
    }

    //#endregion
}
