/**
 * Device-level configuration stored in localStorage.
 * Each physical device (tablet, POS terminal, kiosk screen) keeps its own
 * copy — changes here never affect other devices.
 *
 * Operating modes:
 *   counter — Counter service with order number display (fondas, taquerías)
 *   cashier — Quick cashier mode, no table selection
 *   kiosk   — Self-service touch screen; customer places their own order
 *   tables  — Table management with table selection
 *   waiter  — Waiter mode with table assignment
 *   kitchen — Kitchen display mode
 */
export interface DeviceConfig {
  mode: 'counter' | 'cashier' | 'kiosk' | 'tables' | 'waiter' | 'kitchen';
  /** Human-readable name for this device, e.g. "Caja 1" or "Kiosko Entrada" */
  deviceName: string;
  /** Business this device belongs to (set during /setup) */
  businessId: number;
  /** Branch this device operates under (set during /setup) */
  branchId: number;
  /** Business display name (cached from setup response) */
  businessName: string;
  /** Branch display name (cached from setup response) */
  branchName: string;
  /** ISO date string of when the device was first configured */
  configuredAt: string;
  /** Saved printer vendor ID for auto-reconnect */
  printerVendorId?: number;
  /** Saved printer product ID for auto-reconnect */
  printerProductId?: number;
  /** Saved printer display name */
  printerName?: string;
  /** Connection type: serial (USB) or bluetooth */
  printerType?: 'serial' | 'bluetooth';
  /** Saved Bluetooth device ID for auto-reconnect */
  bluetoothDeviceId?: string;
  /** Saved Bluetooth device display name */
  bluetoothDeviceName?: string;
}

/** localStorage key used to persist DeviceConfig */
export const DEVICE_CONFIG_KEY = 'pos-device-config';

/** Default device config applied on first launch */
export const DEFAULT_DEVICE_CONFIG: DeviceConfig = {
  mode:           'counter',
  deviceName:     'Dispositivo principal',
  businessId:     0,
  branchId:       0,
  businessName:   '',
  branchName:     '',
  configuredAt:   '',
};
