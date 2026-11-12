import type { Bill } from './types'

/**
 * The bill the cashier charges, taken from the server (S13): `subtotal` is
 * the net base `pay_order` charges (Σ list price × quantity − the order's
 * discounts, S2) and `tax` is the server's tax on it, so
 *
 *   amountDue     = subtotal + tax               (tip is NOT in amountDue)
 *   suggestedTip  = round(subtotal × tipPct / 100)
 *
 * The client never re-adds the line prices: they are list prices and would
 * charge the discounts again. `tipPct` is a percentage (10 means 10%).
 */
export function serverBill(source: { subtotal: number; tax: number }, tipPct: number): Bill {
  const { subtotal, tax } = source
  return { subtotal, tax, suggestedTip: Math.round((subtotal * tipPct) / 100), amountDue: subtotal + tax }
}
