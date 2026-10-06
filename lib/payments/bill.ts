import type { Bill } from './types'

/**
 * Bill math, mirrored from `public.pay_order` (whole-COP-peso arithmetic):
 *
 *   subtotal      = Σ round(price × quantity) over the line items
 *   tax           = round(subtotal × taxPct / 100)
 *   suggestedTip  = round(subtotal × tipPct / 100)
 *   amountDue     = subtotal + tax                (tip is NOT in amountDue)
 *
 * The `round(price × quantity)` per line is important: the server rounds each
 * line before summing, so a price with a fractional intermediate (e.g. 1499.4)
 * produces the same number the browser would see in the response. A `sum`
 * over `price * quantity` with a final `round` would drift by ±1 on
 * ill-conditioned inputs and is the bug the migration's COMMENT explicitly
 * warns about.
 *
 * `taxPct` and `tipPct` are percentages, not fractions (8 means 8%, not
 * 0.08). The server stores them that way; the UI reads them that way.
 */
export function computeBill(
  items: { price: number; quantity: number }[],
  taxPct: number,
  tipPct: number,
): Bill {
  // Multiply in whole cents: price * quantity in binary floats can land just
  // below a .5 (4.10 * 15 = 61.4999...) and round differently from Postgres
  // numeric. cents * quantity is an exact integer, and k.5 is exact in binary.
  const subtotal = items.reduce(
    (acc, item) =>
      acc + Math.round((Math.round(item.price * 100) * item.quantity) / 100),
    0,
  )
  const tax = Math.round((subtotal * taxPct) / 100)
  const suggestedTip = Math.round((subtotal * tipPct) / 100)
  const amountDue = subtotal + tax
  return { subtotal, tax, suggestedTip, amountDue }
}
