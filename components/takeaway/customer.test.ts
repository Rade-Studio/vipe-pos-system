import { describe, expect, it } from "vitest"
import { checkTakeawayCustomer, TAKEAWAY_NAME_ERROR, TAKEAWAY_PHONE_ERROR } from "./customer"

/** S8: the takeaway customer, with the bounds orders_customer_name_check / _phone_check enforce. */
describe("checkTakeawayCustomer", () => {
  it("trims the name and keeps a blank phone as none", () => {
    expect(checkTakeawayCustomer("  Ana María  ", "  ")).toEqual({ ok: true, customer: { name: "Ana María", phone: null } })
  })

  it("accepts 2 and 60 characters and refuses 1 and 61", () => {
    expect(checkTakeawayCustomer("Jo", "")).toMatchObject({ ok: true })
    expect(checkTakeawayCustomer("a".repeat(60), "")).toMatchObject({ ok: true })
    expect(checkTakeawayCustomer(" A ", "")).toEqual({ ok: false, errors: { name: TAKEAWAY_NAME_ERROR } })
    expect(checkTakeawayCustomer("a".repeat(61), "")).toEqual({ ok: false, errors: { name: TAKEAWAY_NAME_ERROR } })
  })

  it("normalises the phone like the delivery phones and refuses one with too few digits", () => {
    expect(checkTakeawayCustomer("Ana", "+57 315 000 1122")).toEqual({ ok: true, customer: { name: "Ana", phone: "3150001122" } })
    expect(checkTakeawayCustomer("Ana", "315")).toEqual({ ok: false, errors: { phone: TAKEAWAY_PHONE_ERROR } })
    expect(checkTakeawayCustomer("", "315")).toEqual({ ok: false, errors: { name: TAKEAWAY_NAME_ERROR, phone: TAKEAWAY_PHONE_ERROR } })
  })
})
