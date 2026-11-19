import { ApiProperty } from '@nestjs/swagger';
import { TAX_REGIMES, type TaxRegime } from '../settings/business-config';

/**
 * H-014 / S2 (odd/tasks/qa-noviembre-2026.md T12): the invoice number of a
 * payment is assigned by the payments_assign_invoice_number trigger (0043)
 * inside pay_order, with a snapshot of the DIAN data in force. Running out of
 * range or past the validity only warns (S2: payments are never blocked).
 */
export const INVOICE_WARNINGS = ['range_ending', 'range_exceeded', 'resolution_expiring', 'resolution_expired'] as const;
export type InvoiceWarning = (typeof INVOICE_WARNINGS)[number];

/** A range is ending when at most this share of it is left (and never fewer than RANGE_ENDING_MIN numbers). */
export const RANGE_ENDING_SHARE = 0.1;
export const RANGE_ENDING_MIN = 10;
/** A resolution is expiring this many days before its last valid day. */
export const RESOLUTION_EXPIRING_DAYS = 30;

export class InvoiceFiscal {
  @ApiProperty({ description: 'Prefix used for the number.' }) prefix!: string;
  @ApiProperty({ type: String, nullable: true, description: 'DIAN resolution number; null when it was not configured.' })
  resolution!: string | null;
  @ApiProperty({ type: 'integer' }) rangeFrom!: number;
  @ApiProperty({ type: 'integer', nullable: true }) rangeTo!: number | null;
  @ApiProperty({ type: String, format: 'date', nullable: true }) validFrom!: string | null;
  @ApiProperty({ type: String, format: 'date', nullable: true }) validTo!: string | null;
  @ApiProperty({ enum: TAX_REGIMES, nullable: true }) taxRegime!: TaxRegime | null;
}

type Json = Record<string, unknown>;
const textOrNull = (value: unknown) => (value === null || value === undefined ? null : String(value));
const numberOrNull = (value: unknown) => (value === null || value === undefined ? null : Number(value));

/** payments.invoice_fiscal (snake_case jsonb) in camelCase; null for a payment made before 0043. */
export function toInvoiceFiscal(raw: unknown): InvoiceFiscal | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const row = raw as Json;
  return {
    prefix: String(row.prefix),
    resolution: textOrNull(row.resolution),
    rangeFrom: Number(row.range_from ?? 1),
    rangeTo: numberOrNull(row.range_to),
    validFrom: textOrNull(row.valid_from),
    validTo: textOrNull(row.valid_to),
    taxRegime: textOrNull(row.tax_regime) as TaxRegime | null,
  };
}

const dayNumber = (iso: string) => Math.round(Date.parse(`${iso}T00:00:00Z`) / 86_400_000);

/**
 * The warnings of a numbered payment, in a stable order (range, then
 * validity). `today` is the restaurant's local date (YYYY-MM-DD).
 */
export function invoiceWarnings(seq: number | null, fiscal: InvoiceFiscal | null, today: string): InvoiceWarning[] {
  if (seq === null || fiscal === null) {
    return [];
  }
  const warnings: InvoiceWarning[] = [];
  if (fiscal.rangeTo !== null) {
    const size = fiscal.rangeTo - fiscal.rangeFrom + 1;
    const remaining = fiscal.rangeTo - seq;
    if (remaining < 0) {
      warnings.push('range_exceeded');
    } else if (remaining <= Math.max(RANGE_ENDING_MIN, Math.ceil(size * RANGE_ENDING_SHARE))) {
      warnings.push('range_ending');
    }
  }
  if (fiscal.validTo !== null) {
    const daysLeft = dayNumber(fiscal.validTo) - dayNumber(today);
    if (daysLeft < 0) {
      warnings.push('resolution_expired');
    } else if (daysLeft <= RESOLUTION_EXPIRING_DAYS) {
      warnings.push('resolution_expiring');
    }
  }
  return warnings;
}
