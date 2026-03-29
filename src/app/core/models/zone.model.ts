/** Physical zone types within a venue */
export enum ZoneType {
  Salon = 'Salon',
  BarSeats = 'BarSeats',
  Other = 'Other',
}

/** A named zone/area within a branch */
export interface Zone {
  id: number;
  branchId: number;
  name: string;
  type: ZoneType;
  sortOrder: number;
  isActive: boolean;
}

/** Snake_case display status values returned by the backend API */
export type DisplayStatus =
  | 'free'
  | 'in_kitchen'
  | 'ready'
  | 'waiting_bill'
  | 'paid'
  | 'reserved';

/** DTO returned by GET /api/table/status — pre-computed by backend */
export interface TableStatusDto {
  tableId: number;
  tableName: string;
  zoneId?: number;
  zoneName?: string;
  displayStatus: DisplayStatus;
  orderTotalCents?: number;
  guestName?: string;
  reservationTime?: string;
  orderId?: string;
}

/**
 * Normalizes backend displayStatus string to a valid DisplayStatus.
 * Falls back to 'free' for unknown values.
 */
export function normalizeDisplayStatus(s: string): DisplayStatus {
  switch (s) {
    case 'free':
    case 'in_kitchen':
    case 'ready':
    case 'waiting_bill':
    case 'paid':
    case 'reserved':
      return s;
    default:
      return 'free';
  }
}
