/**
 * Printer connection type.
 * Only 'none' is fully implemented in Phase 19 (uses window.print()).
 * Remaining types are stubs for future driver implementations (Phase 20+).
 */
export type PrinterConnectionType = 'none' | 'usb' | 'network' | 'bluetooth';

/**
 * A named print destination that can be assigned to products.
 * When an order is completed, items are grouped by destination
 * and kitchen tickets are dispatched in parallel.
 */
export interface PrinterDestination {
  id: number;
  /** Display name shown in dropdowns and the config table. E.g. "Cocina", "Barra", "Caja" */
  name: string;
  connectionType: PrinterConnectionType;
  /** IP:port for 'network' type. E.g. "192.168.1.100:9100" */
  address?: string;
  /** If true, this destination receives the customer receipt ticket. Only one may be true. */
  isDefault: boolean;
  isActive: boolean;
  sortOrder: number;
}

/**
 * Form shape used in the printer destination create/edit dialog.
 */
export interface PrinterDestinationForm {
  name: string;
  connectionType: PrinterConnectionType;
  /** Raw address string — stored as undefined when empty */
  address: string;
  isActive: boolean;
}

/** Options for the connection type dropdown in the printer settings dialog */
export const PRINTER_CONNECTION_TYPE_OPTIONS: { label: string; value: PrinterConnectionType }[] = [
  { label: 'Ninguna (ventana del navegador)', value: 'none' },
  { label: 'Red (IP:Puerto)', value: 'network' },
  { label: 'USB', value: 'usb' },
  { label: 'Bluetooth', value: 'bluetooth' },
];
