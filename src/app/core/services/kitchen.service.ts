import { inject, Injectable, OnDestroy, signal } from '@angular/core';
import { HubConnection, HubConnectionBuilder, HubConnectionState, LogLevel } from '@microsoft/signalr';
import { firstValueFrom } from 'rxjs';
import { MessageService } from 'primeng/api';

import { environment } from '../../../environments/environment';
import { PrintJobDto } from '../models';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';
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

    //#endregion

    //#region Constructor & Lifecycle

    private readonly messageService = inject(MessageService, { optional: true });
    private readonly authService = inject(AuthService);
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
    startPolling(destinationId: number): void {
        this.currentDestinationId = destinationId;
        void this.loadPendingPrintJobs(destinationId);
        void this.connectHub(destinationId);
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
     * Updates a job to InProgress status with optimistic UI.
     * Reverts the local state and shows a Toast if the API call fails.
     * @param id The print job UUID
     */
    async markAsInProgress(id: string): Promise<void> {
        const snapshot = this.pendingJobs();

        this.pendingJobs.update((jobs) =>
            jobs.map((j) =>
                j.id === id ? { ...j, status: 'InProgress' as const } : j,
            ),
        );
        await this.db.pendingPrintJobs.update(id, { status: 'InProgress' });

        try {
            const numericId = parseInt(id, 10);
            await firstValueFrom(this.api.patch(`/print-jobs/${numericId}/in-progress`, {}));
        } catch {
            this.pendingJobs.set(snapshot);
            await this.db.pendingPrintJobs.update(id, { status: 'Pending' });
            this.showError('Could not update status — reverted to Pending.');
        }
    }

    /**
     * Removes a job from the display (optimistic) and notifies the backend.
     * Reverts the local state and shows a Toast if the API call fails.
     * @param id The print job UUID
     */
    async markAsPrinted(id: string): Promise<void> {
        const snapshot = this.pendingJobs();
        const removedJob = snapshot.find((j) => j.id === id);

        this.pendingJobs.update((jobs) => jobs.filter((j) => j.id !== id));
        await this.db.pendingPrintJobs.delete(id);

        try {
            const numericId = parseInt(id, 10);
            await firstValueFrom(this.api.patch(`/print-jobs/${numericId}/printed`, {}));
        } catch {
            this.pendingJobs.set(snapshot);
            if (removedJob) {
                await this.db.pendingPrintJobs.put(removedJob);
            }
            this.showError('Could not complete order — restored to list.');
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
                // Prefer the long-lived device token when this is a KDS
                // machine (no human logged in). Fall back to the user
                // token for backward-compatibility with devices that
                // have not yet been re-provisioned against the new
                // backend contract.
                accessTokenFactory: () =>
                    this.deviceService.getDeviceToken()
                    ?? this.authService.getToken()
                    ?? '',
            })
            .withAutomaticReconnect()
            .configureLogging(LogLevel.Warning)
            .build();

        // Real-time event: a new print job was created for this destination
        this.hubConnection.on('PrintJobCreated', () => {
            if (this.currentDestinationId !== null) {
                void this.loadPendingPrintJobs(this.currentDestinationId);
            }
            this.kitchenAudio.playNewOrderBeep();
        });

        // After automatic reconnect, refresh state in case events were missed
        this.hubConnection.onreconnected(() => {
            if (this.currentDestinationId !== null) {
                void this.loadPendingPrintJobs(this.currentDestinationId);
            }
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
    }

    //#endregion
}
