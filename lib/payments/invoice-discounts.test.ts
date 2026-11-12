import { describe, expect, it } from "vitest"

/** S2/S14: the invoice discounts shared by PaymentPanel and the delivery dialog. */

import { invoiceDiscounts, type PaymentOrderSource } from "./invoice-discounts"

const base: PaymentOrderSource = {
  order_items: [{ id: "i-1", name: "Mojito", price: 24000, quantity: 2 }],
  tax_percentage: 8,
  tip_percentage: 0,
  subtotal: 19000,
  tax: 1520,
  tip: 0,
  total_discounts: 29000,
  table_id: null,
  waiter_id: null,
}
const row = (id: string, label: string, amount: number, orderItemId: string | null) => ({
  id,
  kind: orderItemId ? ("promotion_item" as const) : ("manual_bill" as const),
  source: orderItemId ? ("automatic" as const) : ("manual" as const),
  label,
  amount,
  promotionId: null,
  orderItemId,
  comboId: null,
  reason: null,
  authorizedBy: null,
})

describe("invoiceDiscounts", () => {
  it("splits bill and item discounts and takes the list-price subtotal", () => {
    const result = invoiceDiscounts({ ...base, discounts: [row("a", "2x1", 24000, "i-1"), row("b", "Demora", 5000, null)], gross_subtotal: 48000 })!
    expect(result.bill).toEqual([{ label: "Demora", amount: 5000, orderItemId: null }])
    expect(result.byItem("i-1")).toEqual([{ label: "2x1", amount: 24000, orderItemId: "i-1" }])
    expect(result.grossSubtotal).toBe(48000)
  })

  it("derives the list-price subtotal when the source has none", () => {
    expect(invoiceDiscounts({ ...base, discounts: [row("a", "2x1", 29000, "i-1")] })!.grossSubtotal).toBe(48000)
  })

  it("is null without records, or when they do not match the bill", () => {
    expect(invoiceDiscounts({ ...base, total_discounts: 0 })).toBeNull()
    expect(invoiceDiscounts({ ...base, discounts: [row("a", "2x1", 24000, "i-1")] })).toBeNull()
  })
})
