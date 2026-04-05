import { OrderSource } from '../enums';

/** A delivery platform configuration for a branch */
export interface BranchDeliveryConfig {
  id: number;
  platform: OrderSource;
  isActive: boolean;
  storeId?: string;
  /** True if an API key has been set (never exposed) */
  hasApiKey: boolean;
  /** True if a webhook secret has been set (never exposed) */
  hasWebhookSecret: boolean;
  /** The webhook URL that the platform should call */
  webhookUrl: string;
  createdAt: string;
  updatedAt?: string;
}

/** Request body for creating or updating a delivery config */
export interface UpsertDeliveryConfigRequest {
  platform: OrderSource;
  isActive: boolean;
  storeId?: string;
  /** Only sent when user types a new key */
  apiKey?: string;
  /** Only sent when user types a new secret */
  webhookSecret?: string;
}
