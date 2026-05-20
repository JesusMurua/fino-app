/**
 * Device-level configuration stored in localStorage.
 * Each physical device (tablet, POS terminal, kiosk screen) keeps its own
 * copy — changes here never affect other devices.
 *
 * Operating modes:
 *   cashier   — Quick cashier mode, no table selection
 *   kiosk     — Self-service touch screen; customer places their own order
 *   tables    — Table management with table selection
 *   kitchen   — Kitchen display mode
 *   mobile    — Handheld used by floor staff (waiter on foot, host tablet)
 *   reception — Member check-in screen (Gym / Services vertical); resolves
 *               a customer by scan or search and renders the access banner
 *
 * Back Office (Owner/Manager) is NOT a device mode — laptops that hit
 * `/admin` never persist a DeviceConfig; `terminalGuard` bypasses the
 * hardware check based on role, not on a synthetic mode value.
 */
export interface DeviceConfig {
  mode: 'cashier' | 'kiosk' | 'tables' | 'kitchen' | 'mobile' | 'reception';
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
  /**
   * Hybrid print routing mode:
   *   browser — bytes go straight from this browser to the printer via
   *             Web Serial / Web Bluetooth (legacy default).
   *   bridge  — bytes are POSTed (Base64) to `/api/Hardware/print` and
   *             relayed by the Fino Bridge Windows service over SignalR.
   */
  printMode?: 'browser' | 'bridge';
  /** Logical printer ID forwarded to the Fino Bridge when `printMode === 'bridge'`. */
  bridgePrinterId?: string;
  /** Saved Bluetooth device ID for auto-reconnect */
  bluetoothDeviceId?: string;
  /** Saved Bluetooth device display name */
  bluetoothDeviceName?: string;
  /** ID of the physical cash register linked to this device */
  linkedRegisterId?: number;
  /** Display name of the linked cash register (cached) */
  linkedRegisterName?: string;
  /** Hybrid scale operating mode: none / serial (USB) / cloud (Fino module) */
  scaleType?: 'none' | 'serial' | 'cloud';
  /** Wire-level protocol for serial-mode scales */
  scaleProtocol?: 'toledo' | 'epson' | 'generic';
}

/** localStorage key used to persist DeviceConfig */
export const DEVICE_CONFIG_KEY = 'pos-device-config';

/** Default device config applied on first launch */
export const DEFAULT_DEVICE_CONFIG: DeviceConfig = {
  mode:           'cashier',
  deviceName:     'Dispositivo principal',
  businessId:     0,
  branchId:       0,
  businessName:   '',
  branchName:     '',
  configuredAt:   '',
};

/** Default printer ID used by the cloud bridge when no specific ID is configured. */
export const DEFAULT_BRIDGE_PRINTER_ID = 'DEFAULT_PRINTER';
