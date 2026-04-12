import { inject, Injectable, OnDestroy, signal } from '@angular/core';
import { HubConnection, HubConnectionBuilder, HubConnectionState, LogLevel } from '@microsoft/signalr';
import { firstValueFrom } from 'rxjs';
import { MessageService } from 'primeng/api';

import { environment } from '../../../environments/environment';
import { PrintJobDto } from '../models';
import { ApiService } from './api.service';
import { DatabaseService } from './database.service';
import { DeviceService } from './device.service';
import { KitchenAudioService } from './kitchen-audio.service';

/**
 * Manages pending print jobs for the KDS (Kitchen Display System).
 *
 * - Fetches jobs from GET /api/print-jobs/pending?destination={id}
 * - Falls back to Dexie `pendingPrintJobs` when offline
 * - Real-time updates via SignalR hub `/hubs/kds`
 * - Plays an audio beep on each new PrintJobCreated event
 * - Provides optimistic updates for markAsInProgress() and markAsPrinted()
 * - Queues failed status transitions in Dexie and drains them on reconnect
 */
@Injectable({ providedIn: 'root' })
export class KitchenService implements OnDestroy {
    //#region Properties

    /** Active print jobs for the KDS display */
    readonly pendingJobs = signal<PrintJobDto[]>([]);

    /** Destination currently connected — used by refresh() */
    private currentDestinationId: number | null = null;

    /** Active SignalR connection to the /hubs/kds endpoint */
    private hubConnection: HubConnection | null = null;

    /** True while syncPendingUpdates is running — prevents concurrent drains */
    private isSyncing = false;

    //#endregion

    //#region Constructor & Lifecycle

    private readonly messageService = inject(MessageService, { optional: true });
    private readonly deviceService = inject(DeviceService);
    private readonly kitchenAudio = inject(KitchenAudioService);

    constructor(
        private readonly api: ApiService,
        private readonly db: DatabaseService,
    ) { }

    ngOnDestroy(): void {
        this.stop();
    }

    //#endregion

    //#region Public Methods

    /**
     * Loads jobs immediately and opens a SignalR connection to receive
     * real-time PrintJobCreated events for the given destination.
     * Call from the KDS component on init when a destinationId is present.
     * @param destinationId The printer destination to display jobs for
     */
    start(destinationId: number): void {
        this.currentDestinationId = destinationId;
        void this.loadPendingPrintJobs(destinationId);
        void this.connectHub(destinationId);
    }

    /**
     * @deprecated Use start() instead. Kept as alias during migration.
     */
    startPolling(destinationId: number): void {
        this.start(destinationId);
    }

    /**
     * Closes the SignalR connection and clears the jobs signal.
     * Call from the KDS component on destroy.
     */
    stop(): void {
        if (this.hubConnection) {
            void this.hubConnection.stop();
            this.hubConnection = null;
        }
        this.pendingJobs.set([]);
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
     * UI updates optimistically; if the API call fails, the transition
     * is queued in Dexie and will be retried on reconnect.
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
     * UI updates optimistically; if the API call fails, the transition
     * is queued in Dexie and will be retried on reconnect.
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

    /**
     * Inserts a status transition into the offline queue and shows
     * a non-blocking info toast so the chef knows the change was saved.
     */
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

    /**
     * Drains every queued status transition, patching the backend one
     * by one. Successfully synced rows are deleted from Dexie.
     * Failures remain in the queue for the next attempt.
     * Called after every job reload and on SignalR reconnect.
     */
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

    //#region Private Helpers

    /** Displays an error Toast if MessageService is available */
    private showError(detail: string): void {
        this.messageService?.add({
            severity: 'error',
            summary: 'Error',
            detail,
            life: 4000,
        });
    }

    /**
     * Opens a SignalR connection to /hubs/kds for the given destination.
     * On `PrintJobCreated` events, refreshes the job list and plays a beep.
     */
    private async connectHub(destinationId: number): Promise<void> {
        // Tear down any existing connection before reconnecting
        if (this.hubConnection) {
            await this.hubConnection.stop().catch(() => undefined);
            this.hubConnection = null;
        }

        const hubUrl = `${environment.apiUrl}/hubs/kds?destination=${destinationId}`;

        this.hubConnection = new HubConnectionBuilder()
            .withUrl(hubUrl, {
                accessTokenFactory: () => this.deviceService.getDeviceToken() ?? '',
            })
            .withAutomaticReconnect()
            .configureLogging(LogLevel.Warning)
            .build();

        this.hubConnection.on('PrintJobCreated', () => {
            if (this.currentDestinationId !== null) {
                void this.loadPendingPrintJobs(this.currentDestinationId);
            }
            this.kitchenAudio.playNewOrderBeep();
        });

        this.hubConnection.onreconnected(() => {
            if (this.currentDestinationId !== null) {
                void this.loadPendingPrintJobs(this.currentDestinationId);
            }
            void this.syncPendingUpdates();
        });

        try {
            await this.hubConnection.start();
        } catch (error) {
            console.warn('[KitchenService] SignalR connection failed:', error);
        }
    }

    /** True when the SignalR hub is connected */
    get isHubConnected(): boolean {
        return this.hubConnection?.state === HubConnectionState.Connected;
    }

    /**
     * Fetches pending jobs from the API and caches them in Dexie.
     * On any failure (offline, timeout), falls back to Dexie local data.
     * After loading, drains any queued offline transitions.
     * @param destinationId The printer destination to query
     */
    private async loadPendingPrintJobs(destinationId: number): Promise<void> {
        try {
            const jobs = await firstValueFrom(
                this.api.get<PrintJobDto[]>(
                    `/print-jobs/pending?destination=${destinationId}`,
                ),
            );

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
            // Offline fallback: show locally cached jobs
            const local = await this.db.pendingPrintJobs
                .where('destinationId')
                .equals(destinationId)
                .filter((j) => j.status === 'Pending' || j.status === 'InProgress')
                .toArray();

            this.pendingJobs.set(local);
        }

        // Drain queued transitions after every load attempt
        void this.syncPendingUpdates();
    }

    //#endregion
}
