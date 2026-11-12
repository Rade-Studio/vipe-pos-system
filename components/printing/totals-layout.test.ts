import { describe, expect, it } from "vitest"
import { totalsLayout } from "./totals-layout"

const bill = { subtotal: 24000, tax: 0, totalDiscounts: 38000 }

describe("totalsLayout (S10)", () => {
  it("chooses the discounts layout when the bill carries grossSubtotal", () => {
    expect(totalsLayout({ bill: { ...bill, grossSubtotal: 62000 }, items: [] })).toBe("discounts")
  })

  it("chooses the discounts layout when the invoice or an item carries a discounts list", () => {
    expect(totalsLayout({ bill, discounts: [], items: [] })).toBe("discounts")
    expect(totalsLayout({ bill, items: [{ discounts: [] }] })).toBe("discounts")
  })

  it("keeps the previous layout for an older invoice with only totalDiscounts", () => {
    expect(totalsLayout({ bill, items: [{}, { discounts: null }] })).toBe("legacy")
  })

  it("keeps the previous layout without any discounts", () => {
    expect(totalsLayout({ bill: { ...bill, totalDiscounts: 0 }, items: [{}] })).toBe("legacy")
  })
})
