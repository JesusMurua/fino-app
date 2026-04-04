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
  id: string;
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
