import { Injectable, OnDestroy, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { PrintJobDto } from '../models';
import { ApiService } from './api.service';
import { DatabaseService } from './database.service';

/** Polling interval for KDS print jobs refresh (milliseconds) */
const KDS_POLL_INTERVAL_MS = 5_000;

/**
 * Manages pending print jobs for the KDS (Kitchen Display System).
 *
 * - Fetches jobs from GET /api/print-jobs/pending?destination={id}
 * - Falls back to Dexie `pendingPrintJobs` when offline
 * - Polls every 5 seconds via startPolling()
 * - Provides optimistic updates for markAsInProgress() and markAsPrinted()
 */
@Injectable({ providedIn: 'root' })
export class KitchenService implements OnDestroy {
    //#region Properties

    /** Active print jobs for the KDS display */
    readonly pendingJobs = signal<PrintJobDto[]>([]);

    /** Destination currently being polled — used by refresh() */
    private currentDestinationId: number | null = null;

    private pollTimerId: ReturnType<typeof setInterval> | null = null;

    //#endregion

    //#region Constructor & Lifecycle

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
     * Loads jobs immediately and starts the 5-second polling loop.
     * Call from the KDS component on init when a destinationId is present.
     * @param destinationId The printer destination to display jobs for
     */
    startPolling(destinationId: number): void {
        this.currentDestinationId = destinationId;
        void this.loadPendingPrintJobs(destinationId);
        this.pollTimerId = setInterval(
            () => void this.loadPendingPrintJobs(destinationId),
            KDS_POLL_INTERVAL_MS,
        );
    }

    /**
     * Stops the polling loop and clears the jobs signal.
     * Call from the KDS component on destroy.
     */
    stop(): void {
        if (this.pollTimerId !== null) {
            clearInterval(this.pollTimerId);
            this.pollTimerId = null;
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
     * Updates a job to InProgress status.
     * Applies an optimistic UI update and syncs to Dexie, then hits the API best-effort.
     * @param id The print job UUID
     */
    async markAsInProgress(id: string): Promise<void> {
        this.pendingJobs.update((jobs) =>
            jobs.map((j) =>
                j.id === id ? { ...j, status: 'InProgress' as const } : j,
            ),
        );
        await this.db.pendingPrintJobs.update(id, { status: 'InProgress' });

        try {
            await firstValueFrom(this.api.patch(`/print-jobs/${id}/in-progress`, {}));
        } catch {
            console.warn(
                '[KitchenService] API unreachable — job marked InProgress locally only',
            );
        }
    }

    /**
     * Removes a job from the display (optimistic) and notifies the backend.
     * If offline, the job is deleted from Dexie and the backend sync is best-effort.
     * @param id The print job UUID
     */
    async markAsPrinted(id: string): Promise<void> {
        this.pendingJobs.update((jobs) => jobs.filter((j) => j.id !== id));
        await this.db.pendingPrintJobs.delete(id);

        try {
            await firstValueFrom(this.api.patch(`/print-jobs/${id}/printed`, {}));
        } catch {
            console.warn(
                '[KitchenService] API unreachable — job removed locally only',
            );
        }
    }

    //#endregion

    //#region Private Helpers

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
