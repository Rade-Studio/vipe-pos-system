import { describe, expect, it } from "vitest"
import {
  billInputFromCashierOrder,
  billInputFromDto,
  cashierBill,
  discountBody,
  freeValueError,
  manualPromotions,
  needsPin,
  reasonError,
  shortName,
} from "./discounts"
import { mesa7, promo } from "./discount-fixtures"
import { toCashierOrder } from "./orders"

/** S13 (design/promociones/03 panel 2): the cashier's bill with its discount lines. */

describe("cashierBill", () => {
  const bill = cashierBill([billInputFromDto(mesa7())])

  it("keeps each line at list price with its discounts under it", () => {
    expect(bill.lines.map((line) => [line.name, line.quantity, line.total])).toEqual([
      ["Mojito", 2, 48000],
      ["Margarita", 1, 26000],
      ["Hamburguesa clásica", 1, 29000],
      ["Mojito", 1, 24000],
      ["Tres leches", 1, 14000],
    ])
    expect(bill.lines[0]!.discounts).toEqual([
      expect.objectContaining({ id: "d-2x1", label: "Happy hour 2x1", amount: 24000, note: "fijado 18:10", manual: false }),
    ])
    expect(bill.lines[4]!.discounts).toEqual([
      expect.objectContaining({ id: "d-cortesia", label: "Cortesía de cumpleaños", amount: 14000, note: "Paula R. · PIN", manual: true }),
    ])
    expect(bill.lines[1]!.discounts).toEqual([])
  })

  it("totals from the server: list subtotal, one row per discount label, base, tax and total", () => {
    expect(bill.grossSubtotal).toBe(141000)
    expect(bill.discountRows).toEqual([
      { label: "Happy hour 2x1", amount: 24000 },
      { label: "Cortesía de cumpleaños", amount: 14000 },
    ])
    expect(bill.totalDiscounts).toBe(38000)
    expect(bill.subtotal).toBe(103000)
    expect(bill.tax).toBe(8240)
    expect(bill.total).toBe(111240)
  })

  it("groups two discounts with the same label and sums orders of one table", () => {
    const second = mesa7({ id: "o-2" })
    const both = cashierBill([billInputFromDto(mesa7()), billInputFromDto(second)])
    expect(both.discountRows).toEqual([
      { label: "Happy hour 2x1", amount: 48000 },
      { label: "Cortesía de cumpleaños", amount: 28000 },
    ])
    expect(both.grossSubtotal).toBe(282000)
    expect(both.total).toBe(222480)
  })

  it("a bill discount sits under the totals, not under a line", () => {
    const order = mesa7()
    order.discounts.push({ ...order.discounts[1]!, id: "d-bill", orderItemId: null, kind: "manual_bill", label: "Descuento manual", amount: 5000 })
    const withBill = cashierBill([billInputFromDto(order)])
    expect(withBill.billDiscounts.map((d) => [d.label, d.amount])).toEqual([["Descuento manual", 5000]])
    expect(withBill.lines.flatMap((line) => line.discounts).map((d) => d.id)).toEqual(["d-2x1", "d-cortesia"])
  })

  it("a manual promotion without PIN shows only who applied it", () => {
    const noPin = cashierBill([billInputFromDto(mesa7())], { noPinPromotionIds: new Set(["p-cortesia"]) })
    expect(noPin.lines[4]!.discounts[0]!.note).toBe("Paula R.")
  })
})

describe("bill from the cashier list", () => {
  it("the list's order carries its discounts: same bill as the order read", () => {
    const fromList = billInputFromCashierOrder(toCashierOrder(mesa7()))
    expect(fromList).not.toBeNull()
    expect(cashierBill([fromList!])).toEqual(cashierBill([billInputFromDto(mesa7())]))
  })

  it("discount records that no longer match the bill (realtime patch) ask for a fresh read", () => {
    const order = toCashierOrder(mesa7())
    expect(billInputFromCashierOrder({ ...order, bill: { ...order.bill, totalDiscounts: 24000 } })).toBeNull()
  })

  it("an order without discounts needs no read", () => {
    const dto = { ...mesa7(), discounts: [], totalDiscounts: 0, subtotal: 141000, grossSubtotal: 141000 }
    expect(billInputFromCashierOrder(toCashierOrder(dto))).toMatchObject({ discounts: [], grossSubtotal: 141000 })
  })
})

describe("manual discount sheet rules", () => {
  it("offers the active manual promotions a cashier can apply", () => {
    const list = [
      promo({ id: "a", mode: "manual" }),
      promo({ id: "b", mode: "manual_pin" }),
      promo({ id: "c", mode: "automatic" }),
      promo({ id: "d", mode: "manual", active: false }),
      promo({ id: "e", mode: "manual", kind: "combo" }),
    ]
    expect(manualPromotions(list).map((p) => p.id)).toEqual(["a", "b"])
  })

  it("asks a PIN for manual_pin and free discounts, not for manual", () => {
    expect(needsPin({ type: "promotion", promotion: promo({ mode: "manual" }) })).toBe(false)
    expect(needsPin({ type: "promotion", promotion: promo({ mode: "manual_pin" }) })).toBe(true)
    expect(needsPin({ type: "free", discountType: "percentage", value: 10 })).toBe(true)
  })

  it("builds the body for a promotion and for a free discount", () => {
    expect(discountBody({ type: "promotion", promotion: promo({ id: "p-1" }) }, "i-1", "  Cumpleaños  ", "a-1")).toEqual({
      promotionId: "p-1",
      orderItemId: "i-1",
      reason: "Cumpleaños",
      authorizationId: "a-1",
    })
    expect(discountBody({ type: "free", discountType: "fixed_amount", value: 5000 }, null, "Demora")).toEqual({
      discountType: "fixed_amount",
      discountValue: 5000,
      reason: "Demora",
    })
  })

  it("checks the reason (3-200 characters, trimmed) and the free value", () => {
    expect(reasonError("")).toBe("Escribe el motivo.")
    expect(reasonError("  ab ")).toBe("Escribe al menos 3 letras.")
    expect(reasonError("abc")).toBeNull()
    expect(reasonError("x".repeat(201))).toBe("Máximo 200 caracteres.")
    expect(freeValueError("percentage", 0)).toBe("Escribe un porcentaje de 1 a 100.")
    expect(freeValueError("percentage", 101)).toBe("Escribe un porcentaje de 1 a 100.")
    expect(freeValueError("percentage", 15)).toBeNull()
    expect(freeValueError("fixed_amount", 0)).toBe("Escribe un valor mayor que cero.")
    expect(freeValueError("fixed_amount", 5000)).toBeNull()
  })

  it("shortens a name to first name and initial", () => {
    expect(shortName("Paula Rodríguez")).toBe("Paula R.")
    expect(shortName("Paula")).toBe("Paula")
  })
})
