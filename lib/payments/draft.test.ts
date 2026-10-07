import { describe, expect, it } from 'vitest'
import {
  paymentDraftReducer,
  initialPaymentDraft,
  selectView,
  computeSurplusAsTip,
} from './draft'
import type {
  PayOrderResult,
  PaymentMethodOption,
} from './types'

// -----------------------------------------------------------
// Test catalog (mirrors the shape lib/supabase/payments-service
// returns). Cash + two electronic + one inactive (filtered out).
// -----------------------------------------------------------
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

// Helper: build a draft the way the dialog will (idempotency key injected
// from the view, so the reducer stays pure and testable).
function newDraft(amountDue = 47000, suggestedTip = 4700, key = 'key-1') {
  return initialPaymentDraft({ amountDue, suggestedTip, idempotencyKey: key })
}

// -----------------------------------------------------------
// initialPaymentDraft
// -----------------------------------------------------------
describe('initialPaymentDraft', () => {
  it('preloads tip with the suggested amount, empty tenders, no method selected', () => {
    const s = newDraft(47000, 4700)
    expect(s.amountDue).toBe(47000)
    expect(s.suggestedTip).toBe(4700)
    expect(s.tip).toBe(4700)
    expect(s.tenders).toEqual([])
    expect(s.selectedMethodId).toBeNull()
    expect(s.amountInput).toBe('')
    expect(s.idempotencyKey).toBe('key-1')
    expect(s.submitting).toBe(false)
    expect(s.lastError).toBeNull()
    expect(s.lastResult).toBeNull()
  })

  it('keeps the caller-supplied idempotency key verbatim', () => {
    const s = newDraft(1000, 0, 'caller-uuid-abc')
    expect(s.idempotencyKey).toBe('caller-uuid-abc')
  })
})

// -----------------------------------------------------------
// selection + amount input + addLine
// -----------------------------------------------------------
describe('selectMethod / setAmountInput / addLine', () => {
  it('addLine with no method selected is a no-op (cannot add without a method)', () => {
    const s0 = newDraft()
    const s1 = paymentDraftReducer(s0, { type: 'setAmountInput', value: '47000' })
    const s2 = paymentDraftReducer(s1, { type: 'addLine' })
    expect(s2.tenders).toEqual([])
  })

  it('addLine with an invalid amount is a no-op (zero or empty)', () => {
    // setAmountInput sanitizes non-digits ('-1' -> '1', '4700.5' -> '47005',
    // 'abc' -> ''), so after sanitization only 0 and '' can still leave
    // addLine a no-op. The keyboard never produces them, but the reducer
    // guards against them anyway.
    for (const bad of ['0', '']) {
      const s0 = newDraft()
      const s1 = paymentDraftReducer(s0, { type: 'selectMethod', methodId: CASH.id })
      const s2 = paymentDraftReducer(s1, { type: 'setAmountInput', value: bad })
      const s3 = paymentDraftReducer(s2, { type: 'addLine' })
      expect(s3.tenders, `amount="${bad}"`).toEqual([])
    }
  })

  it('addLine appends a cash line and clears the in-progress input', () => {
    const s0 = newDraft(47000, 0)
    const s1 = paymentDraftReducer(s0, { type: 'selectMethod', methodId: CASH.id })
    const s2 = paymentDraftReducer(s1, { type: 'setAmountInput', value: '50000' })
    const s3 = paymentDraftReducer(s2, { type: 'addLine' })
    expect(s3.tenders).toEqual([{ methodId: CASH.id, tendered: 50000 }])
    expect(s3.selectedMethodId).toBeNull()
    expect(s3.amountInput).toBe('')
  })

  it('addLine appends an electronic line for an electronic method', () => {
    const s0 = newDraft(47000, 0)
    const s1 = paymentDraftReducer(s0, { type: 'selectMethod', methodId: NEQUI.id })
    const s2 = paymentDraftReducer(s1, { type: 'setAmountInput', value: '30000' })
    const s3 = paymentDraftReducer(s2, { type: 'addLine' })
    expect(s3.tenders).toEqual([{ methodId: NEQUI.id, tendered: 30000 }])
  })

  it('addLine keeps the idempotency key, tip and amountDue intact', () => {
    const s0 = newDraft(47000, 2000, 'k-keep')
    let s = paymentDraftReducer(s0, { type: 'selectMethod', methodId: CASH.id })
    s = paymentDraftReducer(s, { type: 'setAmountInput', value: '50000' })
    s = paymentDraftReducer(s, { type: 'addLine' })
    expect(s.idempotencyKey).toBe('k-keep')
    expect(s.amountDue).toBe(47000)
    expect(s.tip).toBe(2000)
  })
})

// -----------------------------------------------------------
// removeLine
// -----------------------------------------------------------
describe('removeLine', () => {
  it('removes the line at the given index and keeps the rest in order', () => {
    let s = newDraft(47000, 0)
    s = paymentDraftReducer(s, { type: 'selectMethod', methodId: NEQUI.id })
    s = paymentDraftReducer(s, { type: 'setAmountInput', value: '30000' })
    s = paymentDraftReducer(s, { type: 'addLine' })
    s = paymentDraftReducer(s, { type: 'selectMethod', methodId: CASH.id })
    s = paymentDraftReducer(s, { type: 'setAmountInput', value: '17000' })
    s = paymentDraftReducer(s, { type: 'addLine' })
    expect(s.tenders).toHaveLength(2)

    s = paymentDraftReducer(s, { type: 'removeLine', lineIndex: 0 })
    expect(s.tenders).toEqual([{ methodId: CASH.id, tendered: 17000 }])
  })

  it('removeLine on an out-of-range index is a no-op', () => {
    let s = newDraft()
    s = paymentDraftReducer(s, { type: 'selectMethod', methodId: CASH.id })
    s = paymentDraftReducer(s, { type: 'setAmountInput', value: '1000' })
    s = paymentDraftReducer(s, { type: 'addLine' })
    s = paymentDraftReducer(s, { type: 'removeLine', lineIndex: 5 })
    expect(s.tenders).toHaveLength(1)
  })
})

// -----------------------------------------------------------
// Tip modes
// -----------------------------------------------------------
describe('tip modes', () => {
  it('setTipNone zeroes the tip', () => {
    const s0 = newDraft(47000, 4700)
    const s1 = paymentDraftReducer(s0, { type: 'setTipNone' })
    expect(s1.tip).toBe(0)
    expect(s1.suggestedTip).toBe(4700) // suggestion is preserved
  })

  it('setTipSuggested restores the suggestion (even after custom / surplus)', () => {
    let s = newDraft(47000, 4700)
    s = paymentDraftReducer(s, { type: 'setTipCustom', amount: 1234 })
    expect(s.tip).toBe(1234)
    s = paymentDraftReducer(s, { type: 'setTipSuggested' })
    expect(s.tip).toBe(4700)
  })

  it('setTipCustom stores a cashier-typed amount', () => {
    let s = newDraft(47000, 4700)
    s = paymentDraftReducer(s, { type: 'setTipCustom', amount: 2500 })
    expect(s.tip).toBe(2500)
  })

  it('computeSurplusAsTip adds the cash change to the existing tip', () => {
    // Build a draft with one cash line that overpays by 3000, then ask
    // for surplus-as-tip. With tip 0, the new tip is the 3000 change.
    let s = newDraft(47000, 0)
    s = paymentDraftReducer(s, { type: 'setTipNone' })
    s = paymentDraftReducer(s, { type: 'selectMethod', methodId: CASH.id })
    s = paymentDraftReducer(s, { type: 'setAmountInput', value: '50000' })
    s = paymentDraftReducer(s, { type: 'addLine' })
    const newTip = computeSurplusAsTip(s, METHODS)
    expect(newTip).toBe(3000)
    // The view dispatches setTipCustom with the new value.
    s = paymentDraftReducer(s, { type: 'setTipCustom', amount: newTip })
    expect(s.tip).toBe(3000)
  })

  it('computeSurplusAsTip with no cash change returns the existing tip', () => {
    // Electronic-only: no change to add.
    let s = newDraft(47000, 4700)
    s = paymentDraftReducer(s, { type: 'selectMethod', methodId: NEQUI.id })
    s = paymentDraftReducer(s, { type: 'setAmountInput', value: '47000' })
    s = paymentDraftReducer(s, { type: 'addLine' })
    expect(computeSurplusAsTip(s, METHODS)).toBe(4700)
  })
})

// -----------------------------------------------------------
// submit lifecycle
// -----------------------------------------------------------
describe('submit lifecycle + idempotency key', () => {
  it('startSubmit marks submitting=true without losing the idempotency key', () => {
    const s0 = newDraft(47000, 0, 'k-1')
    const s1 = paymentDraftReducer(s0, { type: 'startSubmit' })
    expect(s1.submitting).toBe(true)
    expect(s1.idempotencyKey).toBe('k-1')
  })

  it('submitFailed keeps the idempotency key, the tip and the tenders (retry with the same key)', () => {
    let s = newDraft(47000, 0, 'k-retry')
    s = paymentDraftReducer(s, { type: 'selectMethod', methodId: NEQUI.id })
    s = paymentDraftReducer(s, { type: 'setAmountInput', value: '47000' })
    s = paymentDraftReducer(s, { type: 'addLine' })
    s = paymentDraftReducer(s, { type: 'startSubmit' })
    s = paymentDraftReducer(s, {
      type: 'submitFailed',
      error: 'transient',
    })
    expect(s.submitting).toBe(false)
    expect(s.idempotencyKey).toBe('k-retry') // not rotated on retry
    expect(s.lastError).toBe('transient')
    expect(s.tenders).toEqual([{ methodId: NEQUI.id, tendered: 47000 }])
    expect(s.tip).toBe(0)
  })

  it('submitSucceeded clears submitting, stores the result, and keeps the key for the receipt', () => {
    const result: PayOrderResult = {
      paymentId: 'p-1',
      status: 'paid',
      amountDue: 47000,
      tipAmount: 0,
      totalCharged: 47000,
      changeGiven: 0,
      drawerWarning: false,
      drawerCashBefore: 100000,
      alreadyPaid: false,
      tenders: [{ lineNo: 1, methodCode: 'nequi', amount: 47000, cashReceived: null }],
    }
    let s = newDraft(47000, 0, 'k-done')
    s = paymentDraftReducer(s, { type: 'startSubmit' })
    s = paymentDraftReducer(s, { type: 'submitSucceeded', result })
    expect(s.submitting).toBe(false)
    expect(s.lastResult).toEqual(result)
    expect(s.idempotencyKey).toBe('k-done')
  })

  it('idempotency key is replaced only when a new draft is created for a new order', () => {
    // Open dialog for order A.
    const draftA = newDraft(47000, 0, 'order-A')
    expect(draftA.idempotencyKey).toBe('order-A')
    // After a failed attempt, the key must not change.
    let afterFail = paymentDraftReducer(draftA, { type: 'startSubmit' })
    afterFail = paymentDraftReducer(afterFail, { type: 'submitFailed', error: 'x' })
    expect(afterFail.idempotencyKey).toBe('order-A')
    // Open the dialog again for order B: a new draft carries a new key.
    const draftB = newDraft(12000, 0, 'order-B')
    expect(draftB.idempotencyKey).toBe('order-B')
  })
})

// -----------------------------------------------------------
// selectView: derived flags for the UI
// -----------------------------------------------------------
describe('selectView', () => {
  function view(draft: ReturnType<typeof newDraft>, methods = METHODS) {
    return selectView(draft, methods)
  }

  it('returns the computePaymentState output merged with derived flags', () => {
    const v = view(newDraft(47000, 0))
    expect(v.totalToCharge).toBe(47000)
    expect(v.applied).toBe(0)
    expect(v.remaining).toBe(47000)
    expect(v.canSubmit).toBe(false)
    expect(v.canConfirm).toBe(false)
  })

  it('canConfirm is true only when the bill is fully covered, no in-progress line, and not submitting', () => {
    let s = newDraft(47000, 0)
    s = paymentDraftReducer(s, { type: 'setTipNone' })
    s = paymentDraftReducer(s, { type: 'selectMethod', methodId: CASH.id })
    s = paymentDraftReducer(s, { type: 'setAmountInput', value: '47000' })
    s = paymentDraftReducer(s, { type: 'addLine' })
    expect(view(s).canConfirm).toBe(true)
  })

  it('canConfirm is false while a line is in progress (amount typed but not added)', () => {
    let s = newDraft(47000, 0)
    s = paymentDraftReducer(s, { type: 'selectMethod', methodId: CASH.id })
    s = paymentDraftReducer(s, { type: 'setAmountInput', value: '47000' })
    // Not yet added: canConfirm must be false even though the typed value is valid.
    expect(view(s).canConfirm).toBe(false)
    s = paymentDraftReducer(s, { type: 'addLine' })
    expect(view(s).canConfirm).toBe(true)
  })

  it('canConfirm is false while submitting', () => {
    let s = newDraft(47000, 0)
    s = paymentDraftReducer(s, { type: 'selectMethod', methodId: NEQUI.id })
    s = paymentDraftReducer(s, { type: 'setAmountInput', value: '47000' })
    s = paymentDraftReducer(s, { type: 'addLine' })
    expect(view(s).canConfirm).toBe(true)
    s = paymentDraftReducer(s, { type: 'startSubmit' })
    expect(view(s).canConfirm).toBe(false)
  })

  it('canConfirm is false while there are state issues (e.g. inactive method)', () => {
    let s = newDraft(47000, 0)
    s = paymentDraftReducer(s, { type: 'selectMethod', methodId: INACTIVE.id })
    s = paymentDraftReducer(s, { type: 'setAmountInput', value: '47000' })
    s = paymentDraftReducer(s, { type: 'addLine' })
    const v = view(s)
    expect(v.canSubmit).toBe(false)
    expect(v.canConfirm).toBe(false)
    expect(v.issues).toEqual([
      expect.objectContaining({ code: 'inactive-method', lineIndex: 0 }),
    ])
  })

  it('showSurplusAsTip is true when there is cash change to convert', () => {
    let s = newDraft(47000, 0)
    s = paymentDraftReducer(s, { type: 'setTipNone' })
    s = paymentDraftReducer(s, { type: 'selectMethod', methodId: CASH.id })
    s = paymentDraftReducer(s, { type: 'setAmountInput', value: '50000' })
    s = paymentDraftReducer(s, { type: 'addLine' })
    expect(view(s).showSurplusAsTip).toBe(true)
  })

  it('showSurplusAsTip is false for electronic-only lines', () => {
    let s = newDraft(47000, 0)
    s = paymentDraftReducer(s, { type: 'setTipNone' })
    s = paymentDraftReducer(s, { type: 'selectMethod', methodId: NEQUI.id })
    s = paymentDraftReducer(s, { type: 'setAmountInput', value: '47000' })
    s = paymentDraftReducer(s, { type: 'addLine' })
    expect(view(s).showSurplusAsTip).toBe(false)
  })

  it('quickFillSuggestion = remaining (amount to charge - applied)', () => {
    let s = newDraft(47000, 0)
    s = paymentDraftReducer(s, { type: 'setTipNone' })
    s = paymentDraftReducer(s, { type: 'selectMethod', methodId: NEQUI.id })
    s = paymentDraftReducer(s, { type: 'setAmountInput', value: '20000' })
    s = paymentDraftReducer(s, { type: 'addLine' })
    const v = view(s)
    expect(v.applied).toBe(20000)
    expect(v.remaining).toBe(27000)
    expect(v.quickFillSuggestion).toBe(27000)
  })
})

// -----------------------------------------------------------
// End-to-end shape check: full happy path with mixed tenders
// -----------------------------------------------------------
describe('end-to-end mixed-tender draft', () => {
  it('electronic + cash with change resolves to a submittable state', () => {
    let s = newDraft(47000, 0, 'k-mix')
    s = paymentDraftReducer(s, { type: 'setTipNone' })
    s = paymentDraftReducer(s, { type: 'selectMethod', methodId: NEQUI.id })
    s = paymentDraftReducer(s, { type: 'setAmountInput', value: '30000' })
    s = paymentDraftReducer(s, { type: 'addLine' })
    s = paymentDraftReducer(s, { type: 'selectMethod', methodId: CASH.id })
    s = paymentDraftReducer(s, { type: 'setAmountInput', value: '20000' })
    s = paymentDraftReducer(s, { type: 'addLine' })
    const v = selectView(s, METHODS)
    expect(v.applied).toBe(47000)
    expect(v.totalChange).toBe(3000)
    expect(v.canSubmit).toBe(true)
    expect(v.canConfirm).toBe(true)
  })
})
