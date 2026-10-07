import { describe, expect, it } from 'vitest'
import { computePaymentState, applySurplusAsTip, buildPayOrderTenders } from './tenders'
import type { PaymentMethodOption } from './types'

const CASH: PaymentMethodOption = {
  id: 'cash-id',
  code: 'cash',
  name: 'Efectivo',
  kind: 'cash',
  isActive: true,
  sortOrder: 10,
}
const NEQUI: PaymentMethodOption = {
  id: 'nequi-id',
  code: 'nequi',
  name: 'Nequi',
  kind: 'electronic',
  isActive: true,
  sortOrder: 30,
}
const TRANSFER: PaymentMethodOption = {
  id: 'transfer-id',
  code: 'transfer',
  name: 'Transferencia',
  kind: 'electronic',
  isActive: true,
  sortOrder: 20,
}
const INACTIVE: PaymentMethodOption = {
  id: 'old-id',
  code: 'old_method',
  name: 'Old method',
  kind: 'electronic',
  isActive: false,
  sortOrder: 99,
}
const METHODS: PaymentMethodOption[] = [CASH, NEQUI, TRANSFER, INACTIVE]

const baseInput = {
  amountDue: 47000,
  tip: 0,
  methods: METHODS,
}

// -----------------------------------------------------------
// computePaymentState: basic, happy-path shapes
// -----------------------------------------------------------

describe('computePaymentState - happy paths', () => {
  it('exact single cash tender, no change', () => {
    const state = computePaymentState({
      ...baseInput,
      tenders: [{ methodId: CASH.id, tendered: 47000 }],
    })
    expect(state.totalToCharge).toBe(47000)
    expect(state.applied).toBe(47000)
    expect(state.remaining).toBe(0)
    expect(state.totalChange).toBe(0)
    expect(state.canSubmit).toBe(true)
    expect(state.issues).toEqual([])
    expect(state.lines).toEqual([
      { methodId: CASH.id, kind: 'cash', tendered: 47000, applied: 47000, change: 0 },
    ])
  })

  it('exact single electronic tender', () => {
    const state = computePaymentState({
      ...baseInput,
      tenders: [{ methodId: NEQUI.id, tendered: 47000 }],
    })
    expect(state.canSubmit).toBe(true)
    expect(state.totalChange).toBe(0)
    expect(state.lines[0]).toEqual({
      methodId: NEQUI.id,
      kind: 'electronic',
      tendered: 47000,
      applied: 47000,
      change: 0,
    })
  })

  it('cash overpay returns change; remaining and canSubmit are correct', () => {
    const state = computePaymentState({
      ...baseInput,
      tenders: [{ methodId: CASH.id, tendered: 50000 }],
    })
    expect(state.totalToCharge).toBe(47000)
    expect(state.applied).toBe(47000)
    expect(state.remaining).toBe(0)
    expect(state.totalChange).toBe(3000)
    expect(state.canSubmit).toBe(true)
    expect(state.issues).toEqual([])
  })

  it('tip is added to totalToCharge and can be paid in cash', () => {
    const state = computePaymentState({
      amountDue: 10000,
      tip: 2000,
      methods: METHODS,
      tenders: [{ methodId: CASH.id, tendered: 12000 }],
    })
    expect(state.totalToCharge).toBe(12000)
    expect(state.applied).toBe(12000)
    expect(state.totalChange).toBe(0)
    expect(state.canSubmit).toBe(true)
  })

  it('mixed electronic + cash with change', () => {
    // amountDue 47000, tip 0.
    // electronic 30000 (exact) + cash 20000 overpays 17000 by 3000 -> change 3000.
    const state = computePaymentState({
      ...baseInput,
      tenders: [
        { methodId: NEQUI.id, tendered: 30000 },
        { methodId: CASH.id, tendered: 20000 },
      ],
    })
    expect(state.canSubmit).toBe(true)
    expect(state.applied).toBe(47000)
    expect(state.totalChange).toBe(3000)
    expect(state.lines[0]).toMatchObject({ kind: 'electronic', applied: 30000, change: 0 })
    expect(state.lines[1]).toMatchObject({ kind: 'cash', applied: 17000, change: 3000 })
  })

  it('multiple cash lines cover the bill without change', () => {
    const state = computePaymentState({
      ...baseInput,
      tenders: [
        { methodId: CASH.id, tendered: 20000 },
        { methodId: CASH.id, tendered: 27000 },
      ],
    })
    expect(state.applied).toBe(47000)
    expect(state.totalChange).toBe(0)
    expect(state.canSubmit).toBe(true)
  })

  it('cash after fully paid -> line-not-needed, canSubmit false', () => {
    const state = computePaymentState({
      ...baseInput,
      tenders: [
        { methodId: NEQUI.id, tendered: 47000 },
        { methodId: CASH.id, tendered: 1000 },
      ],
    })
    expect(state.applied).toBe(47000)
    expect(state.remaining).toBe(0)
    expect(state.canSubmit).toBe(false)
    expect(state.issues).toEqual([
      expect.objectContaining({ code: 'line-not-needed', lineIndex: 1 }),
    ])
  })
})

// -----------------------------------------------------------
// computePaymentState: empty / under-paid
// -----------------------------------------------------------

describe('computePaymentState - empty and under-paid', () => {
  it('empty tenders: remaining = totalToCharge, canSubmit false', () => {
    const state = computePaymentState({ ...baseInput, tenders: [] })
    expect(state.totalToCharge).toBe(47000)
    expect(state.applied).toBe(0)
    expect(state.remaining).toBe(47000)
    expect(state.totalChange).toBe(0)
    expect(state.canSubmit).toBe(false)
    expect(state.issues).toEqual([])
  })

  it('partially paid electronic: remaining = totalToCharge - applied', () => {
    const state = computePaymentState({
      ...baseInput,
      tenders: [{ methodId: NEQUI.id, tendered: 20000 }],
    })
    expect(state.applied).toBe(20000)
    expect(state.remaining).toBe(27000)
    expect(state.canSubmit).toBe(false)
  })
})

// -----------------------------------------------------------
// computePaymentState: issues
// -----------------------------------------------------------

describe('computePaymentState - issues', () => {
  it('electronic overpay -> electronic-overpay issue, canSubmit false', () => {
    const state = computePaymentState({
      ...baseInput,
      tenders: [{ methodId: NEQUI.id, tendered: 50000 }],
    })
    expect(state.applied).toBe(50000) // per spec: electronic applied = tendered
    expect(state.remaining).toBe(0)
    expect(state.canSubmit).toBe(false)
    expect(state.issues).toEqual([
      expect.objectContaining({ code: 'electronic-overpay', lineIndex: 0 }),
    ])
  })

  it('unknown method -> unknown-method issue with the line index', () => {
    const state = computePaymentState({
      ...baseInput,
      tenders: [
        { methodId: CASH.id, tendered: 10000 },
        { methodId: 'does-not-exist', tendered: 37000 },
      ],
    })
    expect(state.canSubmit).toBe(false)
    expect(state.issues).toEqual([
      expect.objectContaining({ code: 'unknown-method', lineIndex: 1 }),
    ])
  })

  it('inactive method -> inactive-method issue with the line index', () => {
    const state = computePaymentState({
      ...baseInput,
      tenders: [{ methodId: INACTIVE.id, tendered: 47000 }],
    })
    expect(state.canSubmit).toBe(false)
    expect(state.issues).toEqual([
      expect.objectContaining({ code: 'inactive-method', lineIndex: 0 }),
    ])
  })

  it('non-positive integer tendered -> invalid-amount', () => {
    const cases: Array<{ tendered: number; label: string }> = [
      { tendered: 0, label: 'zero' },
      { tendered: -1, label: 'negative' },
      { tendered: 1500.5, label: 'fractional' },
      { tendered: Number.NaN, label: 'NaN' },
      { tendered: Number.POSITIVE_INFINITY, label: 'Infinity' },
    ]
    for (const c of cases) {
      const state = computePaymentState({
        ...baseInput,
        tenders: [{ methodId: CASH.id, tendered: c.tendered }],
      })
      expect(state.canSubmit, `case ${c.label}`).toBe(false)
      expect(state.issues, `case ${c.label}`).toEqual([
        expect.objectContaining({ code: 'invalid-amount', lineIndex: 0 }),
      ])
    }
  })

  it('negative or non-integer tip -> invalid-tip', () => {
    for (const tip of [-1, 0.5, Number.NaN]) {
      const state = computePaymentState({
        ...baseInput,
        tip,
        tenders: [{ methodId: NEQUI.id, tendered: 47000 }],
      })
      expect(state.issues, `tip=${tip}`).toEqual([
        expect.objectContaining({ code: 'invalid-tip' }),
      ])
      expect(state.canSubmit, `tip=${tip}`).toBe(false)
    }
  })

  it('more than 20 lines -> too-many-lines', () => {
    const tenders = Array.from({ length: 21 }, () => ({
      methodId: CASH.id,
      tendered: 1,
    }))
    const state = computePaymentState({ ...baseInput, tenders })
    expect(state.canSubmit).toBe(false)
    expect(state.issues).toEqual([expect.objectContaining({ code: 'too-many-lines' })])
  })

  it('amountDue <= 0 -> nothing-to-charge, canSubmit false', () => {
    const state = computePaymentState({
      amountDue: 0,
      tip: 0,
      methods: METHODS,
      tenders: [],
    })
    expect(state.canSubmit).toBe(false)
    expect(state.issues).toEqual([expect.objectContaining({ code: 'nothing-to-charge' })])
    expect(state.applied).toBe(0)
    expect(state.remaining).toBe(0)
  })
})

// -----------------------------------------------------------
// buildPayOrderTenders
// -----------------------------------------------------------

describe('buildPayOrderTenders', () => {
  it('throws when the state is not submittable', () => {
    const state = computePaymentState({ ...baseInput, tenders: [] })
    expect(() => buildPayOrderTenders(state)).toThrow(/not submittable/i)
  })

  it('maps each line to the wire format with cash_received only for cash', () => {
    const state = computePaymentState({
      amountDue: 47000,
      tip: 0,
      methods: METHODS,
      tenders: [
        { methodId: NEQUI.id, tendered: 30000 },
        { methodId: CASH.id, tendered: 17000 },
      ],
    })
    expect(state.canSubmit).toBe(true)
    expect(buildPayOrderTenders(state)).toEqual([
      { payment_method_id: NEQUI.id, amount: 30000, cash_received: null },
      { payment_method_id: CASH.id, amount: 17000, cash_received: 17000 },
    ])
  })

  it('cash overpay: amount = applied, cash_received = tendered', () => {
    // due 47000, tip 0, cash 50000 -> applied 47000, change 3000.
    const state = computePaymentState({
      amountDue: 47000,
      tip: 0,
      methods: METHODS,
      tenders: [{ methodId: CASH.id, tendered: 50000 }],
    })
    expect(buildPayOrderTenders(state)).toEqual([
      { payment_method_id: CASH.id, amount: 47000, cash_received: 50000 },
    ])
  })
})

// -----------------------------------------------------------
// applySurplusAsTip
// -----------------------------------------------------------

describe('applySurplusAsTip', () => {
  it('due 47000, tip 0, cash 50000 -> new tip 3000', () => {
    const newTip = applySurplusAsTip({
      amountDue: 47000,
      tip: 0,
      methods: METHODS,
      tenders: [{ methodId: CASH.id, tendered: 50000 }],
    })
    expect(newTip).toBe(3000)
  })

  it('due 47000, tip 2000, cash 50000 -> default change 1000; surplus-as-tip -> 3000', () => {
    const state = computePaymentState({
      amountDue: 47000,
      tip: 2000,
      methods: METHODS,
      tenders: [{ methodId: CASH.id, tendered: 50000 }],
    })
    expect(state.totalChange).toBe(1000)
    expect(applySurplusAsTip({
      amountDue: 47000,
      tip: 2000,
      methods: METHODS,
      tenders: [{ methodId: CASH.id, tendered: 50000 }],
    })).toBe(3000)
  })

  it('no cash change -> new tip equals original tip', () => {
    expect(applySurplusAsTip({
      amountDue: 47000,
      tip: 0,
      methods: METHODS,
      tenders: [{ methodId: NEQUI.id, tendered: 47000 }],
    })).toBe(0)
    expect(applySurplusAsTip({
      amountDue: 47000,
      tip: 2000,
      methods: METHODS,
      tenders: [{ methodId: CASH.id, tendered: 49000 }],
    })).toBe(2000)
  })
})
