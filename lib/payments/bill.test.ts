import { describe, expect, it } from 'vitest'
import { serverBill } from './bill'

/**
 * S13: the bill the cashier charges is the server's. `subtotal` is the net
 * base (list price minus discounts) and `tax` is computed on it by the server,
 * so the panel charges exactly `subtotal + tax`, the amount `pay_order` checks.
 */
describe('serverBill', () => {
  it('charges the server subtotal and tax, discounts already out', () => {
    // Mesa 7: $141.000 at list price, −$38.000 in discounts.
    expect(serverBill({ subtotal: 103000, tax: 8240 }, 10)).toEqual({
      subtotal: 103000,
      tax: 8240,
      suggestedTip: 10300,
      amountDue: 111240,
    })
  })

  it('suggests the tip on the net subtotal, rounded to whole pesos', () => {
    expect(serverBill({ subtotal: 33005, tax: 0 }, 10).suggestedTip).toBe(3301)
    expect(serverBill({ subtotal: 33000, tax: 2640 }, 0).suggestedTip).toBe(0)
  })

  it('a fully discounted order owes nothing and suggests no tip', () => {
    expect(serverBill({ subtotal: 0, tax: 0 }, 10)).toEqual({ subtotal: 0, tax: 0, suggestedTip: 0, amountDue: 0 })
  })
})
