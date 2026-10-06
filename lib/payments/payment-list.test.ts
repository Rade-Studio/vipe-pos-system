import { describe, expect, it } from 'vitest'
import {
  invoicePaymentMethod,
  methodLabel,
  parsePaymentRows,
  toCsvRows,
  totalsByMethod,
} from './payment-list'

// -----------------------------------------------------------
// Wire sample: payments with nested payment_tenders.
// -----------------------------------------------------------
// Two paid orders on the same register. The first is a split (cash + nequi),
// the second is a single cash payment with change. Method snapshots are
// frozen at payment time so the report renders them even when the catalog
// row was renamed or deactivated afterwards.
const SAMPLE_RAW = [
  {
    id: 'pay-1',
    order_id: 'ord-1',
    cash_register_id: 'reg-1',
    cashier_profile_id: 'prof-1',
    amount_due: 40000,
    tip_amount: 5000,
    total_charged: 45000,
    change_given: 5000,
    idempotency_key: 'idem-1',
    created_at: '2026-10-06T12:00:00.000Z',
    payment_tenders: [
      {
        id: 't1',
        payment_id: 'pay-1',
        line_no: 1,
        payment_method_id: 'm-cash',
        method_code: 'cash',
        method_kind: 'cash',
        amount: 20000,
        cash_received: 25000,
      },
      {
        id: 't2',
        payment_id: 'pay-1',
        line_no: 2,
        payment_method_id: 'm-nequi',
        method_code: 'nequi',
        method_kind: 'electronic',
        amount: 25000,
        cash_received: null,
      },
    ],
  },
  {
    id: 'pay-2',
    order_id: 'ord-2',
    cash_register_id: 'reg-1',
    cashier_profile_id: 'prof-2',
    amount_due: 30000,
    tip_amount: 0,
    total_charged: 30000,
    change_given: 2000,
    idempotency_key: 'idem-2',
    created_at: '2026-10-06T13:00:00.000Z',
    payment_tenders: [
      {
        id: 't3',
        payment_id: 'pay-2',
        line_no: 1,
        payment_method_id: 'm-cash',
        method_code: 'cash',
        method_kind: 'cash',
        amount: 30000,
        cash_received: 32000,
      },
    ],
  },
]

// Catalog rows the cashier/admin UI renders. sort_order is the same order
// the server returns the methods in. `code` is the legacy free-text that
// is still kept on the snapshot for compatibility.
const CATALOG: ReadonlyArray<{
  id: string
  code: string
  name: string
  kind: 'cash' | 'electronic'
  isActive: boolean
  sortOrder: number
}> = [
  { id: 'm-cash', code: 'cash', name: 'Efectivo', kind: 'cash', isActive: true, sortOrder: 10 },
  { id: 'm-nequi', code: 'nequi', name: 'Nequi', kind: 'electronic', isActive: true, sortOrder: 30 },
  { id: 'm-bancolombia', code: 'bancolombia', name: 'Bancolombia', kind: 'electronic', isActive: true, sortOrder: 40 },
]

describe('parsePaymentRows', () => {
  it('remaps snake_case payment rows to camelCase and keeps the nested tenders in line_no order', () => {
    const [first, second] = parsePaymentRows(SAMPLE_RAW)
    expect(first).toEqual({
      id: 'pay-1',
      orderId: 'ord-1',
      cashRegisterId: 'reg-1',
      cashierProfileId: 'prof-1',
      amountDue: 40000,
      tipAmount: 5000,
      totalCharged: 45000,
      changeGiven: 5000,
      idempotencyKey: 'idem-1',
      createdAt: '2026-10-06T12:00:00.000Z',
      tenders: [
        {
          id: 't1',
          paymentId: 'pay-1',
          lineNo: 1,
          paymentMethodId: 'm-cash',
          methodCode: 'cash',
          methodKind: 'cash',
          amount: 20000,
          cashReceived: 25000,
        },
        {
          id: 't2',
          paymentId: 'pay-1',
          lineNo: 2,
          paymentMethodId: 'm-nequi',
          methodCode: 'nequi',
          methodKind: 'electronic',
          amount: 25000,
          cashReceived: null,
        },
      ],
    })
    expect(second.id).toBe('pay-2')
    expect(second.tenders.map((t) => t.lineNo)).toEqual([1])
    expect(second.changeGiven).toBe(2000)
  })

  it('accepts an empty array and returns no payments', () => {
    expect(parsePaymentRows([])).toEqual([])
  })

  it('throws when a payment row is missing a required money field', () => {
    const broken = [
      { ...SAMPLE_RAW[0], total_charged: undefined },
    ]
    expect(() => parsePaymentRows(broken as any)).toThrow(/total_charged/)
  })

  it('throws when a tender row has a non-integer amount', () => {
    const broken = JSON.parse(JSON.stringify(SAMPLE_RAW))
    broken[0].payment_tenders[0].amount = 1.5
    expect(() => parsePaymentRows(broken)).toThrow(/amount must be a finite integer/)
  })

  it('throws when a tender row has a missing method snapshot', () => {
    const broken = JSON.parse(JSON.stringify(SAMPLE_RAW))
    delete broken[1].payment_tenders[0].method_code
    expect(() => parsePaymentRows(broken)).toThrow(/method_code/)
  })

  it('preserves the input order so the UI does not have to re-sort', () => {
    const out = parsePaymentRows(SAMPLE_RAW)
    expect(out.map((p) => p.id)).toEqual(['pay-1', 'pay-2'])
  })
})

describe('totalsByMethod', () => {
  it('sums amounts per payment_method_id using the tender snapshot as label', () => {
    const payments = parsePaymentRows(SAMPLE_RAW)
    const totals = totalsByMethod(payments)
    expect(totals).toEqual({
      'm-cash': { code: 'cash', name: 'cash', kind: 'cash', amount: 50000, tendersCount: 2 },
      'm-nequi': { code: 'nequi', name: 'nequi', kind: 'electronic', amount: 25000, tendersCount: 1 },
    })
  })

  it('returns an empty object for no payments', () => {
    expect(totalsByMethod([])).toEqual({})
  })

  it('uses the catalog name and code when one is supplied, ordered by sort_order', () => {
    const payments = parsePaymentRows(SAMPLE_RAW)
    const totals = totalsByMethod(payments, CATALOG)
    // The catalog declares m-bancolombia too: included with amount=0 so the
    // admin report renders the full picker.
    expect(Object.keys(totals)).toEqual(['m-cash', 'm-nequi', 'm-bancolombia'])
    expect(totals['m-cash']).toEqual({
      code: 'cash',
      name: 'Efectivo',
      kind: 'cash',
      amount: 50000,
      tendersCount: 2,
    })
    expect(totals['m-nequi']).toEqual({
      code: 'nequi',
      name: 'Nequi',
      kind: 'electronic',
      amount: 25000,
      tendersCount: 1,
    })
  })

  it('orders by name when no catalog is supplied', () => {
    const payments = parsePaymentRows(SAMPLE_RAW)
    const totals = totalsByMethod(payments)
    // Only keys that have a tender; with no catalog we have cash (m-cash) and
    // nequi (m-nequi); names match the snapshot so the order is alphabetic.
    expect(Object.keys(totals)).toEqual(['m-cash', 'm-nequi'])
  })

  it('still includes catalog rows the catalog declared but that have no tenders yet', () => {
    const payments = parsePaymentRows(SAMPLE_RAW)
    const totals = totalsByMethod(payments, CATALOG)
    // m-bancolombia is in the catalog with no tenders: included with amount 0
    // so the cashier/admin reports render the full picker.
    expect(totals['m-bancolombia']).toEqual({
      code: 'bancolombia',
      name: 'Bancolombia',
      kind: 'electronic',
      amount: 0,
      tendersCount: 0,
    })
  })
})

describe('methodLabel', () => {
  it('returns the single method name when there is exactly one tender line', () => {
    const [, second] = parsePaymentRows(SAMPLE_RAW)
    expect(methodLabel(second)).toBe('cash')
  })

  it('returns the single method catalog name when a catalog is passed', () => {
    const [, second] = parsePaymentRows(SAMPLE_RAW)
    expect(methodLabel(second, CATALOG)).toBe('Efectivo')
  })

  it('returns "Múltiples" when more than one distinct method was used', () => {
    const [first] = parsePaymentRows(SAMPLE_RAW)
    expect(methodLabel(first)).toBe('Múltiples')
  })

  it('returns the single method name when the same method was used twice', () => {
    const payments = parsePaymentRows([
      {
        ...SAMPLE_RAW[0],
        id: 'pay-3',
        payment_tenders: [
          { ...SAMPLE_RAW[0].payment_tenders[0] },
          { ...SAMPLE_RAW[0].payment_tenders[0], id: 't-other', line_no: 2 },
        ],
      },
    ])
    expect(methodLabel(payments[0])).toBe('cash')
  })

  it('returns "Sin método" when no tender lines are present', () => {
    const payments = parsePaymentRows([
      {
        ...SAMPLE_RAW[0],
        id: 'pay-empty',
        payment_tenders: [],
      },
    ])
    expect(methodLabel(payments[0])).toBe('Sin método')
  })
})

describe('invoicePaymentMethod', () => {
  it('returns "multiple" when more than one distinct method was used', () => {
    const [first] = parsePaymentRows(SAMPLE_RAW)
    expect(invoicePaymentMethod(first)).toBe('multiple')
  })

  it('passes a default catalog code straight through', () => {
    const [, second] = parsePaymentRows(SAMPLE_RAW)
    expect(invoicePaymentMethod(second)).toBe('cash')
  })

  it('keeps a non-default catalog code instead of relabelling it as cash', () => {
    const payments = parsePaymentRows([
      {
        ...SAMPLE_RAW[1],
        payment_tenders: [
          {
            ...SAMPLE_RAW[1].payment_tenders[0],
            payment_method_id: 'm-card',
            method_code: 'datafono',
            method_kind: 'electronic',
            cash_received: null,
          },
        ],
      },
    ])
    expect(invoicePaymentMethod(payments[0])).toBe('datafono')
  })

  it('returns undefined when no tender lines are present', () => {
    const payments = parsePaymentRows([{ ...SAMPLE_RAW[0], payment_tenders: [] }])
    expect(invoicePaymentMethod(payments[0])).toBeUndefined()
  })
})

describe('toCsvRows', () => {
  it('produces a header row and one data row per payment', () => {
    const payments = parsePaymentRows(SAMPLE_RAW)
    const csv = toCsvRows(payments)
    const lines = csv.split('\n')
    expect(lines[0]).toBe(
      'ID,Orden,Caja,Mesero,Monto,Propina,Cambio,Métodos,Monto total cargado,Fecha',
    )
    expect(lines).toHaveLength(3)
  })

  it('summarises tenders as method:amount joined by semicolons in catalog order', () => {
    const payments = parsePaymentRows(SAMPLE_RAW)
    const csv = toCsvRows(payments, CATALOG)
    const lines = csv.split('\n')
    // pay-1 has cash then nequi (line_no order); catalog order is the same.
    expect(lines[1]).toContain('cash:20000;nequi:25000')
    expect(lines[2]).toContain('cash:30000')
  })

  it('escapes fields containing commas, double quotes, or newlines', () => {
    const tricky = parsePaymentRows([
      {
        ...SAMPLE_RAW[0],
        id: 'pay-tricky',
        // snapshot with a comma in method name to force quoting
        payment_tenders: [
          {
            ...SAMPLE_RAW[0].payment_tenders[0],
            method_code: 'weird,name',
            method_kind: 'cash',
          },
        ],
      },
    ])
    const csv = toCsvRows(tricky)
    const lines = csv.split('\n')
    // The field containing a comma must be wrapped in double quotes.
    expect(lines[1]).toContain('"weird,name:20000"')
  })

  it('escapes fields with embedded double quotes', () => {
    const tricky = parsePaymentRows([
      {
        ...SAMPLE_RAW[0],
        id: 'pay-quote',
        cashier_profile_id: 'name "with" quotes',
        payment_tenders: [
          {
            ...SAMPLE_RAW[0].payment_tenders[0],
            method_code: 'quoted"name',
            method_kind: 'cash',
          },
        ],
      },
    ])
    const csv = toCsvRows(tricky, CATALOG)
    // Inner double quotes are doubled per RFC 4180
    expect(csv).toContain('""with""')
    expect(csv).toContain('"quoted""name:20000"')
  })

  it('escapes fields with embedded newlines', () => {
    const tricky = parsePaymentRows([
      {
        ...SAMPLE_RAW[0],
        id: 'pay-nl',
        payment_tenders: [
          {
            ...SAMPLE_RAW[0].payment_tenders[0],
            method_code: 'nl\nname',
            method_kind: 'cash',
          },
        ],
      },
    ])
    const csv = toCsvRows(tricky)
    // Header + one row. The row contains a quoted field with an embedded
    // newline; verify the escaped form wraps the embedded \n inside double
    // quotes and the payment id is on the first logical record (start of
    // the row).
    expect(csv).toContain('"nl\nname:20000"')
    expect(csv.startsWith('ID,Orden,Caja,Mesero,Monto,Propina,Cambio,M\u00e9todos,Monto total cargado,Fecha\npay-nl,')).toBe(true)
  })

  it('emits only the header when there are no payments', () => {
    expect(toCsvRows([])).toBe(
      'ID,Orden,Caja,Mesero,Monto,Propina,Cambio,Métodos,Monto total cargado,Fecha',
    )
  })

  it('uses the snapshot name when no catalog is supplied', () => {
    const payments = parsePaymentRows(SAMPLE_RAW)
    const csv = toCsvRows(payments)
    const lines = csv.split('\n')
    expect(lines[1]).toContain('cash:20000;nequi:25000')
  })
})