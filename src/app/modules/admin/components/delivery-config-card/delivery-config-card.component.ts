import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { InputTextModule } from 'primeng/inputtext';
import { InputSwitchModule } from 'primeng/inputswitch';
import { TooltipModule } from 'primeng/tooltip';

import { BranchDeliveryConfig, UpsertDeliveryConfigRequest } from '../../../../core/models';
import { OrderSource } from '../../../../core/enums';

interface PlatformMeta {
  label: string;
  letter: string;
  color: string;
  bgColor: string;
}

@Component({
  selector: 'app-delivery-config-card',
  standalone: true,
  imports: [FormsModule, InputTextModule, InputSwitchModule, TooltipModule],
  templateUrl: './delivery-config-card.component.html',
  styleUrl: './delivery-config-card.component.scss',
})
export class DeliveryConfigCardComponent implements OnChanges {

  @Input({ required: true }) platform!: OrderSource;
  @Input() config: BranchDeliveryConfig | null = null;
  @Input({ required: true }) branchId!: number;
  @Input() saving = false;
  @Output() onSave = new EventEmitter<UpsertDeliveryConfigRequest>();
  @Output() onDelete = new EventEmitter<OrderSource>();

  //#region Internal State

  readonly isExpanded = signal(false);
  readonly isActive = signal(false);
  readonly storeId = signal('');
  readonly apiKeyInput = signal('');
  readonly webhookSecretInput = signal('');
  readonly showApiKey = signal(false);
  readonly showWebhookSecret = signal(false);
  readonly showDeleteConfirm = signal(false);
  readonly copiedFeedback = signal(false);

  //#endregion

  //#region Platform Metadata

  private readonly platformMap: Record<string, PlatformMeta> = {
    [OrderSource.UberEats]: { label: 'Uber Eats',  letter: 'U', color: '#06C167', bgColor: '#000000' },
    [OrderSource.Rappi]:    { label: 'Rappi',       letter: 'R', color: '#FF441B', bgColor: '#FFF1EE' },
    [OrderSource.DidiFood]: { label: 'Didi Food',   letter: 'D', color: '#FF6B00', bgColor: '#FFF4EE' },
    [OrderSource.Direct]:   { label: 'Directo',     letter: 'D', color: '#16A34A', bgColor: '#F0FDF4' },
  };

  readonly meta = computed<PlatformMeta>(() =>
    this.platformMap[this.platform] ?? this.platformMap[OrderSource.Direct],
  );

  readonly isConfigured = computed(() => this.config !== null);

  //#endregion

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['config']) {
      const cfg = this.config;
      this.isActive.set(cfg?.isActive ?? false);
      this.storeId.set(cfg?.storeId ?? '');
      this.apiKeyInput.set('');
      this.webhookSecretInput.set('');
      this.showApiKey.set(false);
      this.showWebhookSecret.set(false);
      this.showDeleteConfirm.set(false);

      // Auto-expand configured + active cards for discoverability
      if (cfg?.isActive) {
        this.isExpanded.set(true);
      }
    }
  }

  toggleExpand(): void {
    this.isExpanded.update(v => !v);
  }

  emitSave(): void {
    const request: UpsertDeliveryConfigRequest = {
      platform: this.platform,
      isActive: this.isActive(),
      storeId: this.storeId().trim() || undefined,
    };
    const key = this.apiKeyInput().trim();
    const secret = this.webhookSecretInput().trim();
    if (key) request.apiKey = key;
    if (secret) request.webhookSecret = secret;
    this.onSave.emit(request);
  }

  emitDelete(): void {
    this.onDelete.emit(this.platform);
    this.showDeleteConfirm.set(false);
  }

  copyWebhookUrl(): void {
    if (!this.config?.webhookUrl) return;
    navigator.clipboard.writeText(this.config.webhookUrl);
    this.copiedFeedback.set(true);
    setTimeout(() => this.copiedFeedback.set(false), 2000);
  }
}
