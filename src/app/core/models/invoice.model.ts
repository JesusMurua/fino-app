import { PaymentMethod } from './order.model';

// ---------------------------------------------------------------------------
// Customer Fiscal Data — SAT CFDI receptor fields
// ---------------------------------------------------------------------------

/** Fiscal data for the order receiver (receptor CFDI) */
export interface CustomerFiscalData {
  /** RFC del receptor (12 chars persona moral, 13 chars persona física) */
  rfc: string;
  /** Razón social o nombre del receptor */
  razonSocial: string;
  /** Clave del régimen fiscal SAT (e.g. "626") */
  regimenFiscal: string;
  /** Clave del uso CFDI SAT (e.g. "G03") */
  usoCfdi: string;
  /** Código postal del domicilio fiscal (5 dígitos) */
  codigoPostal: string;
  /** Email para envío de la factura */
  email: string;
}

// ---------------------------------------------------------------------------
// Invoice Request — attached to an Order
// ---------------------------------------------------------------------------

/** Status of an invoice request lifecycle */
export type InvoiceRequestStatus = 'pending' | 'processing' | 'completed' | 'failed';

/** An invoice request attached to an order */
export interface InvoiceRequest {
  /** Customer fiscal data captured by the cashier */
  fiscalData: CustomerFiscalData;
  /** Current status of the invoice request */
  status: InvoiceRequestStatus;
  /** UUID of the generated invoice (from backend) */
  invoiceId?: string;
  /** CFDI UUID stamped by the PAC (36-char SAT format) */
  cfdiUuid?: string;
  /** When the request was submitted */
  requestedAt: Date;
  /** When the CFDI was successfully stamped */
  completedAt?: Date;
  /** Error message if the request failed */
  errorMessage?: string;
}

/** Result returned by InvoicingService after requesting an invoice */
export interface InvoiceResult {
  success: boolean;
  invoiceId?: string;
  cfdiUuid?: string;
  errorMessage?: string;
}

// ---------------------------------------------------------------------------
// Business Fiscal Config — stored in BusinessConfig
// ---------------------------------------------------------------------------

/** Fiscal configuration for the business (CFDI issuer) */
export interface BusinessFiscalConfig {
  /** RFC del emisor */
  rfc: string;
  /** Razón social del emisor */
  razonSocial: string;
  /** Clave del régimen fiscal del emisor */
  regimenFiscal: string;
  /** Código postal del domicilio fiscal del emisor */
  codigoPostal: string;
}

// ---------------------------------------------------------------------------
// SAT Catalogs — hardcoded, updated annually at most
// ---------------------------------------------------------------------------

/** A SAT catalog option for dropdowns */
export interface SatCatalogOption {
  clave: string;
  descripcion: string;
}

/** Régimen Fiscal (c_RegimenFiscal) — most common for Mexican businesses */
export const REGIMEN_FISCAL_OPTIONS: SatCatalogOption[] = [
  { clave: '601', descripcion: 'General de Ley Personas Morales' },
  { clave: '603', descripcion: 'Personas Morales con Fines no Lucrativos' },
  { clave: '605', descripcion: 'Sueldos y Salarios' },
  { clave: '606', descripcion: 'Arrendamiento' },
  { clave: '612', descripcion: 'Personas Físicas con Actividades Empresariales y Profesionales' },
  { clave: '616', descripcion: 'Sin obligaciones fiscales' },
  { clave: '621', descripcion: 'Incorporación Fiscal' },
  { clave: '625', descripcion: 'Actividades Empresariales (Plataformas Tecnológicas)' },
  { clave: '626', descripcion: 'Régimen Simplificado de Confianza (RESICO)' },
];

/** Uso CFDI (c_UsoCFDI) — most common for restaurant customers */
export const USO_CFDI_OPTIONS: SatCatalogOption[] = [
  { clave: 'G01', descripcion: 'Adquisición de mercancías' },
  { clave: 'G03', descripcion: 'Gastos en general' },
  { clave: 'I04', descripcion: 'Equipo de cómputo y accesorios' },
  { clave: 'P01', descripcion: 'Por definir' },
  { clave: 'S01', descripcion: 'Sin efectos fiscales' },
];

/** Unidad SAT (c_ClaveUnidad) — most common for food businesses */
export const SAT_UNIT_OPTIONS: SatCatalogOption[] = [
  { clave: 'H87', descripcion: 'Pieza' },
  { clave: 'EA',  descripcion: 'Elemento' },
  { clave: 'E48', descripcion: 'Unidad de servicio' },
  { clave: 'KGM', descripcion: 'Kilogramo' },
  { clave: 'LTR', descripcion: 'Litro' },
  { clave: 'XBX', descripcion: 'Caja' },
  { clave: 'ACT', descripcion: 'Actividad' },
];

/** IVA tax rate options */
export const IVA_RATE_OPTIONS: { value: number; label: string }[] = [
  { value: 16, label: '16% (General)' },
  { value: 8,  label: '8% (Frontera norte)' },
  { value: 0,  label: '0% (Tasa cero)' },
];

// ---------------------------------------------------------------------------
// SAT Payment Method Mapping
// ---------------------------------------------------------------------------

/** Maps PaymentMethod enum to SAT c_FormaPago code */
export const PAYMENT_METHOD_SAT_MAP: Record<string, string> = {
  [PaymentMethod.Cash]:          '01',
  [PaymentMethod.Card]:          '04',
  [PaymentMethod.Transfer]:      '03',
  [PaymentMethod.Clip]:          '04',
  [PaymentMethod.MercadoPagoQR]: '31',
  [PaymentMethod.Other]:         '99',
};

// ---------------------------------------------------------------------------
// RFC Validation
// ---------------------------------------------------------------------------

/**
 * Regex for Mexican RFC validation.
 * Personas Morales: 3 letters + 6 digits + 3 alphanumeric (12 chars)
 * Personas Físicas: 4 letters + 6 digits + 3 alphanumeric (13 chars)
 */
export const RFC_REGEX = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/i;

/** RFC genérico para público en general */
export const RFC_PUBLICO_GENERAL = 'XAXX010101000';

/** RFC genérico para extranjeros */
export const RFC_EXTRANJEROS = 'XEXX010101000';
