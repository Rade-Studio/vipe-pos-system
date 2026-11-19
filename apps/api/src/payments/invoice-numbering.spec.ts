import { describe, expect, it } from 'vitest';
import { type InvoiceFiscal, invoiceWarnings, toInvoiceFiscal } from './invoice-numbering';

const fiscal = (over: Partial<InvoiceFiscal> = {}): InvoiceFiscal => ({
  prefix: 'POS',
  resolution: '18764000001234',
  rangeFrom: 1,
  rangeTo: 1000,
  validFrom: '2026-01-01',
  validTo: '2026-12-31',
  taxRegime: 'responsable_iva',
  ...over,
});

describe('invoiceWarnings', () => {
  it('says nothing for a legacy payment or without range and validity', () => {
    expect(invoiceWarnings(null, null, '2026-11-18')).toEqual([]);
    expect(invoiceWarnings(5, fiscal({ rangeTo: null, validTo: null }), '2026-11-18')).toEqual([]);
  });

  it('warns the range is ending from 10 % left (at least 10 numbers), and exceeded past its end', () => {
    expect(invoiceWarnings(899, fiscal(), '2026-01-10')).toEqual([]);
    expect(invoiceWarnings(900, fiscal(), '2026-01-10')).toEqual(['range_ending']);
    expect(invoiceWarnings(1000, fiscal(), '2026-01-10')).toEqual(['range_ending']);
    expect(invoiceWarnings(1001, fiscal(), '2026-01-10')).toEqual(['range_exceeded']);
    expect(invoiceWarnings(39, fiscal({ rangeTo: 50 }), '2026-01-10')).toEqual([]);
    expect(invoiceWarnings(40, fiscal({ rangeTo: 50 }), '2026-01-10')).toEqual(['range_ending']);
  });

  it('warns the resolution is expiring from 30 days before its last day, and expired after it', () => {
    expect(invoiceWarnings(1, fiscal(), '2026-11-30')).toEqual([]);
    expect(invoiceWarnings(1, fiscal(), '2026-12-01')).toEqual(['resolution_expiring']);
    expect(invoiceWarnings(1, fiscal(), '2026-12-31')).toEqual(['resolution_expiring']);
    expect(invoiceWarnings(1, fiscal(), '2027-01-01')).toEqual(['resolution_expired']);
  });

  it('lists the range warning before the validity one', () => {
    expect(invoiceWarnings(1001, fiscal(), '2027-01-01')).toEqual(['range_exceeded', 'resolution_expired']);
  });
});

describe('toInvoiceFiscal', () => {
  it('maps the snapshot and keeps unset values null', () => {
    expect(
      toInvoiceFiscal({ prefix: 'POS', resolution: null, range_from: 1, range_to: null, valid_from: null, valid_to: null, tax_regime: null }),
    ).toEqual({ prefix: 'POS', resolution: null, rangeFrom: 1, rangeTo: null, validFrom: null, validTo: null, taxRegime: null });
    expect(toInvoiceFiscal(null)).toBeNull();
  });
});
