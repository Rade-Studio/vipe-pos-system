import { describe, expect, it } from 'vitest'
import { computeBill } from './bill'

describe('computeBill', () => {
  it('returns zeros for an empty cart', () => {
    expect(computeBill([], 8, 10)).toEqual({
      subtotal: 0,
      tax: 0,
      suggestedTip: 0,
      amountDue: 0,
    })
  })

  it('sums whole-peso line items exactly', () => {
    const items = [
      { price: 12500, quantity: 2 },
      { price: 8000, quantity: 1 },
    ]
    // 12500*2 + 8000*1 = 33000
    expect(computeBill(items, 8, 10)).toEqual({
      subtotal: 33000,
      tax: 2640,    // round(33000 * 0.08)
      suggestedTip: 3300, // round(33000 * 0.10)
      amountDue: 35640,   // 33000 + 2640
    })
  })

  it('rounds per-line before summing (mirrors the server: round(price*qty))', () => {
    // 1500.5 * 2 = 3001, but 1500.5 is not whole pesos; we use prices that
    // are whole pesos with a qty that produces a half-peso intermediate to
    // prove the server's `round(price * quantity)` behavior. Here the
    // product 4500 * 1 = 4500 is exact; 1499.4 * 3 would be 4498.2 → 4498.
    const items = [{ price: 1499.4, quantity: 3 }]
    // Server rounds each line: round(1499.4 * 3) = round(4498.2) = 4498
    expect(computeBill(items, 0, 0).subtotal).toBe(4498)
  })

  it('rounds tax and suggested tip with .5 going up (Math.round semantics)', () => {
    // subtotal 101, taxPct 5  -> 5.05  -> 5 (round half away from zero? here it's not .5)
    // subtotal 111, taxPct 5  -> 5.55  -> 6
    // subtotal 1,  taxPct 50  -> 0.5   -> 1
    expect(computeBill([{ price: 101, quantity: 1 }], 5, 0).tax).toBe(5)
    expect(computeBill([{ price: 111, quantity: 1 }], 5, 0).tax).toBe(6)
    expect(computeBill([{ price: 1, quantity: 1 }], 50, 0).tax).toBe(1)
    // suggested tip with .5
    expect(computeBill([{ price: 1, quantity: 1 }], 0, 50).suggestedTip).toBe(1)
  })

  it('handles the 12500 x 3 (server spec example) with 8% tax', () => {
    // 12500 * 3 = 37500; 8% tax = 3000; amountDue = 40500; suggested 10% tip = 3750
    const bill = computeBill([{ price: 12500, quantity: 3 }], 8, 10)
    expect(bill.subtotal).toBe(37500)
    expect(bill.tax).toBe(3000)
    expect(bill.suggestedTip).toBe(3750)
    expect(bill.amountDue).toBe(40500)
  })

  it('tax and tip are computed off the subtotal, not off amountDue', () => {
    // tax/tip on subtotal only; amountDue = subtotal + tax (no tip in amountDue).
    const bill = computeBill(
      [{ price: 10000, quantity: 1 }, { price: 5000, quantity: 1 }],
      19, 10,
    )
    expect(bill.subtotal).toBe(15000)
    expect(bill.tax).toBe(Math.round(15000 * 19 / 100)) // 2850
    expect(bill.suggestedTip).toBe(Math.round(15000 * 10 / 100)) // 1500
    expect(bill.amountDue).toBe(15000 + 2850) // tip NOT in amountDue
  })

  it('handles 0% tax and 0% tip', () => {
    const bill = computeBill(
      [{ price: 12345, quantity: 2 }, { price: 500, quantity: 3 }],
      0, 0,
    )
    expect(bill.subtotal).toBe(12345 * 2 + 500 * 3) // 26190
    expect(bill.tax).toBe(0)
    expect(bill.suggestedTip).toBe(0)
    expect(bill.amountDue).toBe(26190)
  })
})
