import { describe, expect, it } from 'vitest'
import { fiscalLines, invoiceWarningMessages, type InvoiceFiscal } from './invoice-fiscal'

const FULL: InvoiceFiscal = {
  prefix: 'POS',
  resolution: '18764000001234',
  rangeFrom: 1,
  rangeTo: 5000,
  validFrom: '2026-01-01',
  validTo: '2027-12-31',
  taxRegime: 'responsable_iva',
}
const EMPTY: InvoiceFiscal = {
  prefix: 'POS',
  resolution: null,
  rangeFrom: 1,
  rangeTo: null,
  validFrom: null,
  validTo: null,
  taxRegime: null,
}

describe('fiscalLines', () => {
  it('prints regime, resolution, validity and range, each in at most 32 characters', () => {
    const lines = fiscalLines(FULL)
    expect(lines).toEqual([
      'RESPONSABLE DE IVA',
      'RES. DIAN No. 18764000001234',
      'DEL 01/01/2026 AL 31/12/2027',
      'NUMERACIÓN POS-1 AL POS-5000',
    ])
    expect(lines.every((line) => line.length <= 32)).toBe(true)
  })

  it('names each regime', () => {
    expect(fiscalLines({ ...EMPTY, taxRegime: 'no_responsable_iva' })).toEqual(['NO RESPONSABLE DE IVA'])
    expect(fiscalLines({ ...EMPTY, taxRegime: 'regimen_simple' })).toEqual(['RÉGIMEN SIMPLE DE TRIBUTACIÓN'])
  })

  it('prints only what is configured', () => {
    expect(fiscalLines(EMPTY)).toEqual([])
    expect(fiscalLines({ ...EMPTY, validTo: '2027-12-31' })).toEqual(['VIGENTE HASTA 31/12/2027'])
    expect(fiscalLines({ ...EMPTY, validFrom: '2026-01-01' })).toEqual(['VIGENTE DESDE 01/01/2026'])
  })

  it('prints nothing for a payment without a snapshot (before numbering existed)', () => {
    expect(fiscalLines(null)).toEqual([])
    expect(fiscalLines(undefined)).toEqual([])
  })
})

describe('invoiceWarningMessages', () => {
  it('says what to do for each warning, in Spanish', () => {
    expect(
      invoiceWarningMessages(['range_ending', 'resolution_expiring'], FULL, 'POS-004600'),
    ).toEqual([
      'Quedan pocos números de factura autorizados (hasta POS-5000). Pide a la DIAN una nueva resolución.',
      'La resolución DIAN vence el 31/12/2027. Renuévala a tiempo.',
    ])
    expect(invoiceWarningMessages(['range_exceeded', 'resolution_expired'], FULL, 'POS-005001')).toEqual([
      'La factura POS-005001 supera el rango autorizado por la DIAN (hasta POS-5000). Actualiza la resolución en Ajustes.',
      'La resolución DIAN venció el 31/12/2027. Actualízala en Ajustes.',
    ])
  })

  it('is empty without warnings or a snapshot', () => {
    expect(invoiceWarningMessages(undefined, FULL, 'POS-000001')).toEqual([])
    expect(invoiceWarningMessages(['range_ending'], null, 'POS-000001')).toEqual([])
  })
})
