import { describe, expect, it } from 'vitest'
import { renderInvoice, renderKitchenOrder } from './renderKitchenOrder'

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
