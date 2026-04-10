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
	private readonly route = inject(ActivatedRoute);

	readonly pendingJobs = this.kitchenService.pendingJobs;

	/** Destination name derived from the first job — shown in the header. */
	readonly destinationName = computed(
		() => this.pendingJobs()[0]?.destinationName ?? 'KDS',
	);

	/** Current time — updated every second for the header clock and elapsed timers */
	readonly now = signal(new Date());

	/** Set of job IDs currently fading out after being marked done */
	readonly fadingOut = signal<Set<string>>(new Set());

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

		const destinationIdParam =
			this.route.snapshot.paramMap.get('destinationId');
		if (destinationIdParam) {
			this.kitchenService.startPolling(+destinationIdParam);
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
	 * Fades the job card out for 3 seconds, then marks it as printed.
	 * @param jobId The print job UUID emitted by the card
	 */
	async onMarkDone(jobId: string): Promise<void> {
		this.fadingOut.update((s) => {
			s.add(jobId);
			return new Set(s);
		});

		setTimeout(async () => {
			await this.kitchenService.markAsPrinted(jobId);
			this.fadingOut.update((s) => {
				s.delete(jobId);
				return new Set(s);
			});
		}, 3000);
	}

	isFading(jobId: string): boolean {
		return this.fadingOut().has(jobId);
	}

	/**
	 * Delegates to the service to mark a job as InProgress.
	 * Triggered by the card's (onStart) output event.
	 * @param jobId The print job UUID emitted by the card
	 */
	async onMarkInProgress(jobId: string): Promise<void> {
		await this.kitchenService.markAsInProgress(jobId);
	}

	//#endregion
}
