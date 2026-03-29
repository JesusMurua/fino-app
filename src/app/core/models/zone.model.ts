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

/** Enriched table status — derived from backend displayStatus */
export enum TableStatus {
  Free = 'Free',
  WithOrder = 'WithOrder',
  InKitchen = 'InKitchen',
  Ready = 'Ready',
  WaitingBill = 'WaitingBill',
  Paid = 'Paid',
  Reserved = 'Reserved',
}

/** Snake_case display status values returned by the backend API */
export type DisplayStatus =
  | 'free'
  | 'with_order'
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
 * Maps the backend displayStatus string to the frontend TableStatus enum.
 * Falls back to Free for unknown values.
 */
export function mapDisplayStatus(s: string): TableStatus {
  switch (s) {
    case 'free':         return TableStatus.Free;
    case 'with_order':   return TableStatus.WithOrder;
    case 'in_kitchen':   return TableStatus.InKitchen;
    case 'ready':        return TableStatus.Ready;
    case 'waiting_bill': return TableStatus.WaitingBill;
    case 'paid':         return TableStatus.Paid;
    case 'reserved':     return TableStatus.Reserved;
    default:             return TableStatus.Free;
  }
}
