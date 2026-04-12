import {
	Component,
	OnDestroy,
	OnInit,
	computed,
	inject,
	signal,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { MessageService } from 'primeng/api';
import { ToastModule } from 'primeng/toast';

import { KitchenService } from '../../core/services/kitchen.service';
import { PrinterDestinationService } from '../../core/services/printer-destination.service';
import { NotificationToggleComponent } from '../../shared/components/notification-toggle/notification-toggle.component';
import { KitchenOrderCardComponent } from './kitchen-order-card.component';

@Component({
	selector: 'app-kitchen-display',
	standalone: true,
	imports: [DatePipe, KitchenOrderCardComponent, NotificationToggleComponent, ToastModule],
	providers: [MessageService],
	templateUrl: './kitchen-display.component.html',
	styleUrl: './kitchen-display.component.scss',
})
export class KitchenDisplayComponent implements OnInit, OnDestroy {
	//#region Properties

	private readonly kitchenService = inject(KitchenService);
	private readonly printerDestinationService = inject(PrinterDestinationService);
	private readonly route = inject(ActivatedRoute);

	readonly pendingJobs = this.kitchenService.pendingJobs;
	readonly connectionState = this.kitchenService.connectionState;

	/** Route-level destination ID — parsed once on init */
	private destinationId: number | null = null;

	/** Destination name read from PrinterDestinationService — always accurate */
	readonly destinationName = computed(() => {
		if (this.destinationId === null) return 'KDS';
		const dest = this.printerDestinationService.activeDestinations()
			.find(d => d.id === this.destinationId);
		return dest?.name ?? this.pendingJobs()[0]?.destinationName ?? 'KDS';
	});

	/** Current time — updated every second for the header clock and elapsed timers */
	readonly now = signal(new Date());

	/** Set of job IDs currently fading out after being marked done */
	readonly fadingOut = signal<Set<number>>(new Set());

	/** Whether the device is online — controls offline banner */
	readonly isOnline = signal(navigator.onLine);

	private clockTimerId: ReturnType<typeof setInterval> | null = null;
	private readonly onOnline = () => this.isOnline.set(true);
	private readonly onOffline = () => this.isOnline.set(false);

	//#endregion

	//#region Lifecycle

	ngOnInit(): void {
		window.addEventListener('online', this.onOnline);
		window.addEventListener('offline', this.onOffline);

		const param = this.route.snapshot.paramMap.get('destinationId');
		if (param) {
			this.destinationId = +param;
			this.printerDestinationService.loadFromLocal();
			this.kitchenService.start(this.destinationId);
		}

		this.clockTimerId = setInterval(() => this.now.set(new Date()), 1000);
	}

	ngOnDestroy(): void {
		window.removeEventListener('online', this.onOnline);
		window.removeEventListener('offline', this.onOffline);
		this.kitchenService.stop();
		if (this.clockTimerId !== null) {
			clearInterval(this.clockTimerId);
		}
	}

	//#endregion

	//#region Actions

	/**
	 * Persists the status change immediately (offline-safe), then
	 * triggers the 3-second fade-out animation.
	 * @param jobId The print job numeric ID emitted by the card
	 */
	async onMarkDone(jobId: number): Promise<void> {
		await this.kitchenService.markAsPrinted(jobId);

		this.fadingOut.update(s => {
			s.add(jobId);
			return new Set(s);
		});

		setTimeout(() => {
			this.fadingOut.update(s => {
				s.delete(jobId);
				return new Set(s);
			});
		}, 3000);
	}

	isFading(jobId: number): boolean {
		return this.fadingOut().has(jobId);
	}

	async onMarkInProgress(jobId: number): Promise<void> {
		await this.kitchenService.markAsInProgress(jobId);
	}

	//#endregion
}
