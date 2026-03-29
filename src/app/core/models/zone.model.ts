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

/** DTO returned by GET /api/table/status — pre-computed by backend */
export interface TableStatusDto {
  tableId: number;
  tableName: string;
  zoneId?: number;
  zoneName?: string;
  displayStatus: string;
  orderTotalCents?: number;
  guestName?: string;
  reservationTime?: string;
  orderId?: string;
}

/**
 * Maps the backend displayStatus string to the frontend TableStatus enum.
 * Handles both PascalCase and snake_case formats from the API.
 * Falls back to Free for unknown values.
 */
export function mapDisplayStatus(s: string): TableStatus {
  switch (s) {
    case 'Free':
    case 'free':         return TableStatus.Free;
    case 'WithOrder':
    case 'with_order':   return TableStatus.WithOrder;
    case 'InKitchen':
    case 'in_kitchen':   return TableStatus.InKitchen;
    case 'Ready':
    case 'ready':        return TableStatus.Ready;
    case 'WaitingBill':
    case 'waiting_bill': return TableStatus.WaitingBill;
    case 'Paid':
    case 'paid':         return TableStatus.Paid;
    case 'Reserved':
    case 'reserved':     return TableStatus.Reserved;
    default:             return TableStatus.Free;
  }
}
