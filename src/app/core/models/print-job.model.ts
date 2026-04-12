/**
 * A single item included in a print job, extracted from the order.
 * Stored as a JSON array in PrintJobDto.structuredContent.
 */
export interface PrintJobItem {
  id: string;
  quantity: number;
  productName: string;
  sizeLabel?: string;
  extras: string[];
  notes?: string;
}

/**
 * Represents a single pending or completed print ticket
 * for a specific printer destination.
 *
 * Created by the backend when an order is completed.
 * One PrintJob per destination per order.
 */
export interface PrintJobDto {
  /** Backend auto-increment integer — NOT a UUID (the order has the UUID). */
  id: number;
  orderNumber: number;
  destinationId: number;
  destinationName: string;
  status: 'Pending' | 'Printed' | 'Failed' | 'InProgress';
  ticketType: 'Kitchen' | 'Receipt';
  /** ISO 8601 string — used to calculate elapsed time on the KDS. */
  createdAt: string;
  /** JSON-serialized PrintJobItem[] filtered to this destination. */
  structuredContent: string;
}

/** Queued status transition for a PrintJob — written to Dexie when offline */
export interface PrintJobUpdateRecord {
  /** Auto-increment local ID */
  id?: number;
  /** The backend print job ID to patch */
  printJobId: number;
  /** Target status to apply when connectivity returns */
  status: 'InProgress' | 'Printed';
  /** ISO 8601 timestamp of when the chef performed the action */
  createdAt: string;
}
