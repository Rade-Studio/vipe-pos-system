import { describe, expect, it } from 'vitest'
import { renderInvoice, renderKitchenOrder } from './renderKitchenOrder'
import type { DeliveryPrintInfo } from '@/types'

// -----------------------------------------------------------
// renderInvoice: legacy single-label output unchanged
// -----------------------------------------------------------
describe('renderInvoice - legacy single label', () => {
  it('prints FORMA DE PAGO + RECIBIDO / CAMBIO for a single cash payment', () => {
    const result = renderInvoice({
      invoiceNumber: 'INV-abc12345',
      invoice: {
        businessInfo: {
          name: 'Mi Restaurante',
          nit: '900.000.000-1',
          address: 'Calle 1 #2-3',
          phone: '3001234567',
        },
        bill: {
          subtotal: 10000,
          tax: 1900,
          taxPercentage: 19,
          tip: 0,
          tipPercentage: 0,
          total: 11900,
          totalDiscounts: 0,
        },
        table: 5,
        waiter: 'Juan',
        paymentMethod: 'cash',
        cashReceived: 20000,
        cashChange: 8100,
      },
      displayItems: [{ name: 'Hamburguesa', quantity: 1, price: 10000 }],
    })
    const text = result.lines.map((l) => l.text).join('\n')
    expect(text).toContain('FORMA DE PAGO: Efectivo')
    expect(text).toContain('RECIBIDO: 20.000')
    expect(text).toContain('CAMBIO: 8.100')
    // No tender list on legacy output.
    expect(text).not.toContain('FORMAS DE PAGO:')
  })

  it('does not print RECIBIDO / CAMBIO for a non-cash single payment', () => {
    const result = renderInvoice({
      invoiceNumber: 'INV-abc12345',
      invoice: {
        businessInfo: {
          name: 'Mi Restaurante',
          nit: '900.000.000-1',
          address: 'Calle 1 #2-3',
          phone: '3001234567',
        },
        bill: {
          subtotal: 10000,
          tax: 1900,
          taxPercentage: 19,
          tip: 0,
          tipPercentage: 0,
          total: 11900,
          totalDiscounts: 0,
        },
        paymentMethod: 'nequi',
      },
      displayItems: [{ name: 'Hamburguesa', quantity: 1, price: 10000 }],
    })
    const text = result.lines.map((l) => l.text).join('\n')
    expect(text).toContain('FORMA DE PAGO: Nequi')
    expect(text).not.toContain('RECIBIDO:')
    expect(text).not.toContain('CAMBIO:')
    expect(text).not.toContain('FORMAS DE PAGO:')
  })

  it('prints "MÚLTIPLES" for the legacy multiple label', () => {
    // The admin reprints some pre-pay-order orders that only have the
    // legacy `paymentMethod: 'multiple'` label; the label must read
    // "MÚLTIPLES" (uppercase, matching the rest of the ticket).
    const result = renderInvoice({
      invoiceNumber: 'INV-abc12345',
      invoice: {
        businessInfo: {
          name: 'Mi Restaurante',
          nit: '900.000.000-1',
          address: 'Calle 1 #2-3',
          phone: '3001234567',
        },
        bill: {
          subtotal: 10000,
          tax: 1900,
          taxPercentage: 19,
          tip: 0,
          tipPercentage: 0,
          total: 11900,
          totalDiscounts: 0,
        },
        paymentMethod: 'multiple',
      },
      displayItems: [],
    })
    const text = result.lines.map((l) => l.text).join('\n')
    expect(text).toContain('FORMA DE PAGO: MÚLTIPLES')
  })
})

// -----------------------------------------------------------
// renderInvoice: tender path
// -----------------------------------------------------------
describe('renderInvoice - tender path', () => {
  it('mixed cash + nequi prints FORMAS DE PAGO with one line per tender and a total CAMBIO', () => {
    const result = renderInvoice({
      invoiceNumber: 'INV-abc12345',
      invoice: {
        businessInfo: {
          name: 'Mi Restaurante',
          nit: '900.000.000-1',
          address: 'Calle 1 #2-3',
          phone: '3001234567',
        },
        bill: {
          subtotal: 10000,
          tax: 1900,
          taxPercentage: 19,
          tip: 0,
          tipPercentage: 0,
          total: 11900,
          totalDiscounts: 0,
        },
        paymentMethod: 'multiple',
        tenders: [
          {
            methodCode: 'nequi',
            methodName: 'Nequi',
            methodKind: 'electronic',
            amount: 30000,
            cashReceived: null,
          },
          {
            methodCode: 'cash',
            methodName: 'Efectivo',
            methodKind: 'cash',
            amount: 17000,
            cashReceived: 20000,
          },
        ],
        change: 3000,
      },
      displayItems: [{ name: 'Hamburguesa', quantity: 1, price: 10000 }],
    })
    const text = result.lines.map((l) => l.text).join('\n')
    expect(text).toContain('FORMAS DE PAGO:')
    expect(text).toMatch(/NEQUI\s+30\.000/)
    expect(text).toMatch(/EFECTIVO\s+17\.000/)
    expect(text).toMatch(/RECIBIDO\s+20\.000\s*\/\s*CAMBIO\s+3\.000/)
    expect(text).toContain('CAMBIO: 3.000')
    // The legacy single-label block must not appear alongside the
    // tender list (it would print a duplicate "FORMA DE PAGO:" line).
    expect(text).not.toMatch(/^FORMA DE PAGO: /m)
  })

  it('single nequi line prints the tender path and omits the cash RECIBIDO block', () => {
    const result = renderInvoice({
      invoiceNumber: 'INV-abc12345',
      invoice: {
        businessInfo: {
          name: 'Mi Restaurante',
          nit: '900.000.000-1',
          address: 'Calle 1 #2-3',
          phone: '3001234567',
        },
        bill: {
          subtotal: 10000,
          tax: 1900,
          taxPercentage: 19,
          tip: 0,
          tipPercentage: 0,
          total: 11900,
          totalDiscounts: 0,
        },
        paymentMethod: 'nequi',
        tenders: [
          {
            methodCode: 'nequi',
            methodName: 'Nequi',
            methodKind: 'electronic',
            amount: 11900,
            cashReceived: null,
          },
        ],
      },
      displayItems: [{ name: 'Hamburguesa', quantity: 1, price: 10000 }],
    })
    const text = result.lines.map((l) => l.text).join('\n')
    expect(text).toContain('FORMAS DE PAGO:')
    expect(text).toMatch(/NEQUI\s+11\.900/)
    expect(text).not.toContain('CAMBIO:')
    expect(text).not.toMatch(/^FORMA DE PAGO: /m)
  })

  it('exact cash payment (no overpay) omits the cash RECIBIDO sub-line and the total CAMBIO', () => {
    const result = renderInvoice({
      invoiceNumber: 'INV-abc12345',
      invoice: {
        businessInfo: {
          name: 'Mi Restaurante',
          nit: '900.000.000-1',
          address: 'Calle 1 #2-3',
          phone: '3001234567',
        },
        bill: {
          subtotal: 10000,
          tax: 1900,
          taxPercentage: 19,
          tip: 0,
          tipPercentage: 0,
          total: 11900,
          totalDiscounts: 0,
        },
        paymentMethod: 'cash',
        tenders: [
          {
            methodCode: 'cash',
            methodName: 'Efectivo',
            methodKind: 'cash',
            amount: 11900,
            cashReceived: 11900,
          },
        ],
      },
      displayItems: [{ name: 'Hamburguesa', quantity: 1, price: 10000 }],
    })
    const text = result.lines.map((l) => l.text).join('\n')
    expect(text).toContain('FORMAS DE PAGO:')
    expect(text).toMatch(/EFECTIVO\s+11\.900/)
    expect(text).not.toContain('RECIBIDO')
    expect(text).not.toContain('CAMBIO:')
  })
})

// -----------------------------------------------------------
// renderKitchenOrder: untouched, regression
// -----------------------------------------------------------
describe('renderKitchenOrder', () => {
  it('builds a centered COMANDA with a single item', () => {
    const result = renderKitchenOrder({
      orderNumber: 'ORD-1',
      table: 3,
      waiter: 'Ana',
      items: [{ name: 'Pizza', quantity: 2, comments: 'sin cebolla' }],
    })
    const text = result.lines.map((l) => l.text).join('\n')
    expect(text).toContain('COMANDA — Mesa 3')
    expect(text).toContain('Mesero: Ana')
    expect(text).toContain('PIZZA')
    expect(text).toContain('2x')
    expect(text).toContain('  sin cebolla')
  })
})

// -----------------------------------------------------------
// Delivery (domicilios): additive `delivery` block
// -----------------------------------------------------------
const DELIVERY: DeliveryPrintInfo = {
  customerName: 'Ana Perez',
  phone: '3101234567',
  address: 'Calle 10 #5-20, Centro (Porton verde)',
  notes: 'Sin cebolla',
  paymentMode: 'cash_on_delivery',
  cashChangeFor: 50000,
  deliveryFee: 3000,
}
const KITCHEN_ITEMS = [
  { name: 'Arepa', quantity: 2, comments: 'sin queso' },
  { name: 'Jugo', quantity: 1 },
]
const BUSINESS = { name: 'Mi Rest', nit: '900', address: 'Calle 1', phone: '300' }

function invoiceTexts(delivery: DeliveryPrintInfo | undefined, bill: { tip: number; total: number }) {
  return renderInvoice({
    invoiceNumber: 'INV-1',
    invoice: {
      businessInfo: BUSINESS,
      bill: {
        subtotal: 10000,
        tax: 1900,
        taxPercentage: 19,
        tip: bill.tip,
        tipPercentage: bill.tip > 0 ? 10 : 0,
        total: bill.total,
        totalDiscounts: 0,
      },
      date: '2025-01-15T12:30:00',
      table: '—',
      waiter: 'uuid-should-not-print',
      paymentMethod: 'cash',
      ...(delivery ? { delivery } : {}),
    },
    displayItems: [{ name: 'Hamburguesa', quantity: 1, price: 10000 }],
  }).lines
    .map((l) => l.text)
    .filter((t) => !t.startsWith('FECHA:'))
}

describe('dine-in output is unchanged (golden, captured before the delivery block)', () => {
  it('kitchen ticket', () => {
    const { lines } = renderKitchenOrder({
      invoiceNumber: '1234',
      table: 5,
      waiter: 'Juan',
      items: KITCHEN_ITEMS,
    })
    expect(lines[0]).toEqual({ text: 'COMANDA — Mesa 5', bold: true, align: 'center' })
    expect(lines.slice(2).map((l) => l.text)).toEqual([
      'Mesero: Juan',
      '--------------------------------',
      'AREPA                         2x',
      '  sin queso',
      'JUGO                          1x',
      '--------------------------------',
    ])
  })

  it('invoice', () => {
    expect(invoiceTexts(undefined, { tip: 1000, total: 12900 })).toEqual([
      'MI REST',
      'NIT: 900',
      'Calle 1',
      'Tel: 300',
      '--------------------------------',
      'FACTURA: INV-1',
      'MESA: —',
      'MESERO: uuid-should-not-print',
      '--------------------------------',
      'CANT DESCRIPCION            IMPORTE',
      '1   Hamburguesa             10.000',
      '--------------------------------',
      'SUBTOTAL: 10.000',
      'IVA: 1.900',
      'TOTAL SIN PROPINA: 11.900',
      'PROPINA VOLUNTARIA (10%): 1.000',
      'TOTAL A PAGAR: 12.900',
      '--------------------------------',
      'FORMA DE PAGO: Efectivo',
      '--------------------------------',
      '¡GRACIAS POR SU COMPRA!',
      'VUELVA PRONTO',
    ])
  })
})

describe('renderKitchenOrder - delivery', () => {
  const render = (delivery: DeliveryPrintInfo | undefined = DELIVERY) =>
    renderKitchenOrder({
      invoiceNumber: '1234',
      table: null,
      waiter: 'Luis',
      items: KITCHEN_ITEMS,
      delivery,
    }).lines.map((l) => l.text)

  it('prints DOMICILIO + customer instead of Mesa, and no address', () => {
    const texts = render()
    expect(texts[0]).toBe('COMANDA — DOMICILIO')
    expect(texts[2]).toBe('Cliente: Ana Perez')
    expect(texts.join('\n')).not.toContain('Mesa')
    expect(texts.join('\n')).not.toContain('Calle 10')
  })

  it('prints the order notes only when present', () => {
    expect(render()).toContain('NOTAS: Sin cebolla')
    const noNotes: DeliveryPrintInfo = { ...DELIVERY, notes: undefined }
    expect(render(noNotes).join('\n')).not.toContain('NOTAS')
  })
})

describe('renderInvoice - delivery', () => {
  it('prints customer, phone and address instead of MESA / MESERO', () => {
    const texts = invoiceTexts(DELIVERY, { tip: 0, total: 14900 })
    expect(texts).toContain('CLIENTE: Ana Perez')
    expect(texts).toContain('TEL: 3101234567')
    expect(texts).toContain('DIRECCION: Calle 10 #5-20, Centro (Porton verde)')
    expect(texts.join('\n')).not.toMatch(/MESA:|MESERO:/)
  })

  it('adds the fee line and includes it in TOTAL SIN PROPINA', () => {
    const texts = invoiceTexts(DELIVERY, { tip: 0, total: 14900 })
    expect(texts).toContain('DOMICILIO: 3.000')
    expect(texts).toContain('TOTAL SIN PROPINA: 14.900')
    expect(texts).toContain('TOTAL A PAGAR: 14.900')
    expect(texts.indexOf('IVA: 1.900')).toBeLessThan(texts.indexOf('DOMICILIO: 3.000'))
  })

  it('total equals subtotal + tax + fee + tip (what pay_order charges)', () => {
    const texts = invoiceTexts(DELIVERY, { tip: 1000, total: 15900 })
    expect(texts).toContain('TOTAL SIN PROPINA: 14.900')
    expect(texts).toContain('TOTAL A PAGAR: 15.900')
  })

  it('prints CAMBIO PARA only for COD with a cashChangeFor', () => {
    expect(invoiceTexts(DELIVERY, { tip: 0, total: 14900 })).toContain('CAMBIO PARA: 50.000')
    const prepaid: DeliveryPrintInfo = { ...DELIVERY, paymentMode: 'prepaid' }
    expect(invoiceTexts(prepaid, { tip: 0, total: 14900 }).join('\n')).not.toContain('CAMBIO PARA')
    const noChange: DeliveryPrintInfo = { ...DELIVERY, cashChangeFor: undefined }
    expect(invoiceTexts(noChange, { tip: 0, total: 14900 }).join('\n')).not.toContain(
      'CAMBIO PARA',
    )
  })
})
