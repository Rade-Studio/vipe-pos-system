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
    expect(text).toContain('COMANDA #ORD-1 — Mesa 3')
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

describe('renderKitchenOrder - comanda header (orderNumber, station)', () => {
  const texts = (order: Partial<Parameters<typeof renderKitchenOrder>[0]>) =>
    renderKitchenOrder({ table: 1, waiter: 'Ana', items: KITCHEN_ITEMS, ...order }).lines.map((l) => l.text)

  it('prints the order number and the station, then Fecha and Mesero', () => {
    const lines = texts({ invoiceNumber: 'job-id', orderNumber: 130, station: { id: 's1', name: 'Cocina' } })
    expect(lines[0]).toBe('COMANDA #130 — Mesa 1')
    expect(lines[1]).toBe('Estación: Cocina')
    expect(lines[2]).toMatch(/^Fecha: {2}/)
    expect(lines[3]).toBe('Mesero: Ana')
  })

  it('prints the number on a delivery comanda', () => {
    const lines = texts({ table: null, orderNumber: 131, station: { name: 'Bar' }, delivery: DELIVERY })
    expect(lines.slice(0, 2)).toEqual(['COMANDA #131 — DOMICILIO', 'Estación: Bar'])
    expect(lines[3]).toBe('Cliente: Ana Perez')
  })

  it('never prints the job id (invoiceNumber) as the number, and adds no station line without one', () => {
    const lines = texts({ invoiceNumber: 'job-id', orderNumber: 7 })
    expect(lines[0]).toBe('COMANDA #7 — Mesa 1')
    expect(lines.join('\n')).not.toContain('Estación')
    expect(texts({ invoiceNumber: 'job-id' })[0]).toBe('COMANDA — Mesa 1')
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

// -----------------------------------------------------------
// F7 T4: a line's options under it (print payload or cart shape)
// -----------------------------------------------------------
describe('modifier lines (F7)', () => {
  const printMods = [
    { group: 'Término', name: 'Medio', price: 0 },
    { group: 'Adiciones', name: 'Queso cheddar', price: 3000 },
    { group: 'Sin', name: 'Sin cebolla', price: 0 },
  ]
  const cartMods = printMods.map(({ group, ...rest }, i) => ({ groupId: `g-${i}`, groupName: group, optionId: `o-${i}`, ...rest }))
  const bill = { subtotal: 50000, tax: 0, taxPercentage: 0, tip: 0, tipPercentage: 0, total: 50000, totalDiscounts: 0 }
  const business = { name: 'R', nit: '1', address: 'A', phone: 'P' }

  it.each([['print payload', printMods], ['cart line', cartMods]])('comanda: one indented line per option before the comments (%s)', (_, modifiers) => {
    const { lines } = renderKitchenOrder({
      table: 1,
      waiter: 'Ana',
      items: [{ name: 'Hamburguesa', quantity: 2, comments: 'bien caliente', modifiers }],
    })
    const at = lines.findIndex((l) => l.text.startsWith('HAMBURGUESA'))
    expect(lines.slice(at + 1, at + 5).map((l) => l.text)).toEqual([
      '  Término: Medio',
      '  + Queso cheddar',
      '  Sin cebolla',
      '  bien caliente',
    ])
  })

  it.each([['print payload', printMods], ['cart line', cartMods]])('invoice: the options with their price under the line (%s)', (_, modifiers) => {
    const { lines } = renderInvoice({
      invoiceNumber: 'I',
      invoice: { businessInfo: business, bill, paymentMethod: 'cash' },
      displayItems: [{ name: 'Hamburguesa', quantity: 2, price: 25000, modifiers }],
    })
    const at = lines.findIndex((l) => l.text.startsWith('2   Hamburguesa'))
    expect(lines[at].text).toBe('2   Hamburguesa             50.000')
    expect(lines.slice(at + 1, at + 4).map((l) => l.text)).toEqual([
      '  Término: Medio',
      '  + Queso cheddar           $3.000',
      '  Sin cebolla',
    ])
  })

  it('lines without options render exactly as before', () => {
    const plain = { table: 5, waiter: 'Juan', items: [{ name: 'Arepa', quantity: 2, comments: 'sin queso' }] }
    const withEmpty = { ...plain, items: [{ ...plain.items[0], modifiers: [] }] }
    expect(renderKitchenOrder(withEmpty).lines.slice(1)).toEqual(renderKitchenOrder(plain).lines.slice(1))
    const inv = { invoiceNumber: 'I', invoice: { businessInfo: business, bill, date: new Date().toISOString() } }
    const item = { name: 'Arepa', quantity: 1, price: 5000 }
    expect(renderInvoice({ ...inv, displayItems: [{ ...item, modifiers: [] }] })).toEqual(renderInvoice({ ...inv, displayItems: [item] }))
  })
})

// -----------------------------------------------------------
// S14: discount lines on the invoice, never on the comanda
// -----------------------------------------------------------
describe('renderInvoice - discounts (S14)', () => {
  const base = {
    businessInfo: { name: 'Casa', nit: '1', address: 'a', phone: 'p' },
    table: 7,
    waiter: 'Andrés',
    paymentMethod: 'cash',
  }
  const discounted = () =>
    renderInvoice({
      invoiceNumber: 'FE-1',
      invoice: {
        ...base,
        bill: { subtotal: 24000, grossSubtotal: 62000, tax: 0, taxPercentage: 0, tip: 0, tipPercentage: 0, total: 24000, totalDiscounts: 38000 },
        discounts: [
          { label: 'Happy hour 2x1', amount: 24000, orderItemId: 'm-1' },
          { label: 'Cortesía cumpleaños', amount: 14000, orderItemId: null },
        ],
      },
      displayItems: [
        { name: 'Mojito', quantity: 2, price: 24000, discounts: [{ label: 'Happy hour 2x1', amount: 24000 }] },
        { name: 'Tres leches', quantity: 1, price: 14000 },
      ],
    }).lines.map((l) => l.text)

  it('prints the line discount under its item and the bill discount after the items', () => {
    const text = discounted()
    const mojito = text.findIndex((t) => t.includes('Mojito'))
    expect(text[mojito + 1]).toBe('  Happy hour 2x1           -24.000')
    const leches = text.findIndex((t) => t.includes('Tres leches'))
    expect(text[leches + 1]).toBe('  Cortesía cumpleaños      -14.000')
    expect(text[leches + 2]).toBe('--------------------------------')
  })

  it('prints SUBTOTAL (gross), DESCUENTOS, BASE then IVA, and HOY AHORRASTE before the footer', () => {
    const text = discounted()
    const at = text.indexOf('SUBTOTAL: 62.000')
    expect(text.slice(at, at + 4)).toEqual(['SUBTOTAL: 62.000', 'DESCUENTOS: -38.000', 'BASE: 24.000', 'IVA: 0'])
    expect(text.slice(-3)).toEqual(['HOY AHORRASTE $38.000', '¡GRACIAS POR SU COMPRA!', 'VUELVA PRONTO'])
  })

  it('falls back to net + discounts when the payload has no grossSubtotal', () => {
    const text = renderInvoice({
      invoiceNumber: 'FE-2',
      invoice: {
        ...base,
        bill: { subtotal: 10000, tax: 0, taxPercentage: 0, tip: 0, tipPercentage: 0, total: 10000, totalDiscounts: 2000 },
        discounts: [{ label: 'Cortesía', amount: 2000 }],
      },
      displayItems: [{ name: 'Sopa', quantity: 1, price: 12000 }],
    }).lines.map((l) => l.text)
    expect(text).toContain('SUBTOTAL: 12.000')
  })

  it('keeps the previous totals for a payload without discount fields (desktop golden parity)', () => {
    const text = renderInvoice({
      invoiceNumber: 'FE-4',
      invoice: { ...base, bill: { subtotal: 10000, tax: 0, taxPercentage: 0, tip: 0, tipPercentage: 0, total: 10000, totalDiscounts: 2000 } },
      displayItems: [{ name: 'Sopa', quantity: 1, price: 12000 }],
    }).lines.map((l) => l.text)
    const at = text.indexOf('SUBTOTAL: 10.000')
    expect(text.slice(at, at + 3)).toEqual(['SUBTOTAL: 10.000', 'IVA: 0', 'DESCUENTOS: -2.000'])
    expect(text.some((t) => /BASE|AHORRASTE/.test(t))).toBe(false)
  })

  it('keeps the old output without discounts', () => {
    const text = renderInvoice({
      invoiceNumber: 'FE-3',
      invoice: { ...base, bill: { subtotal: 10000, tax: 0, taxPercentage: 0, tip: 0, tipPercentage: 0, total: 10000, totalDiscounts: 0 } },
      displayItems: [{ name: 'Sopa', quantity: 1, price: 10000 }],
    }).lines.map((l) => l.text)
    expect(text).toContain('SUBTOTAL: 10.000')
    expect(text.some((t) => /DESCUENTOS|BASE|AHORRASTE/.test(t))).toBe(false)
  })
})

describe('renderKitchenOrder - no prices or discounts (S14)', () => {
  it('prints a discounted line without price, discount or promotion', () => {
    const { lines, footer } = renderKitchenOrder({
      orderNumber: 12,
      table: 7,
      waiter: 'Andrés',
      items: [
        {
          name: 'Mojito',
          quantity: 2,
          price: 24000,
          discounts: [{ label: 'Happy hour 2x1', amount: 24000 }],
          promotionName: 'Happy hour 2x1',
        } as unknown as { name: string; quantity: number },
      ],
    })
    const text = [...lines, ...footer].map((l) => l.text).join('\n')
    expect(text).toContain('MOJITO')
    expect(text).not.toMatch(/24\.000|Happy hour|-\d|\$/)
  })
})
