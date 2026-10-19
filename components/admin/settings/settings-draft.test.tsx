import { describe, expect, it } from "vitest"

import { changedSettingKeys, clampSetting, exampleBill, isDraftDirty, pickSettings } from "./settings-draft"

const saved = {
  tipPercentage: 10,
  taxPercentage: 8,
  priceSuggestion: 300,
  inventoryControlEnabled: false,
  businessName: "Demo",
  businessAddress: "Calle 1",
  businessPhone: "123",
  businessNIT: "900",
}

describe("settings draft", () => {
  it("picks only the requested keys", () => {
    expect(pickSettings(saved, ["taxPercentage", "tipPercentage"])).toEqual({ taxPercentage: 8, tipPercentage: 10 })
  })

  it("is clean when every key equals the saved value", () => {
    expect(isDraftDirty({ taxPercentage: 8, tipPercentage: 10 }, { taxPercentage: 8, tipPercentage: 10 })).toBe(false)
  })

  it("is dirty when any key differs, and lists exactly the changed keys", () => {
    const draft = { ...saved, taxPercentage: 19, businessName: "Otro" }
    expect(isDraftDirty(saved, draft)).toBe(true)
    expect(changedSettingKeys(saved, draft)).toEqual(["taxPercentage", "businessName"])
  })

  it("returns to clean when a value is edited back to the saved one", () => {
    expect(isDraftDirty(saved, { ...saved, inventoryControlEnabled: true })).toBe(true)
    expect(isDraftDirty(saved, { ...saved, inventoryControlEnabled: false })).toBe(false)
  })

  it("clamps a numeric input to its range and rejects non-numbers", () => {
    expect(clampSetting("25", { min: 0, max: 20 })).toBe(20)
    expect(clampSetting("-3", { min: 0, max: 20 })).toBe(0)
    expect(clampSetting("8.5", { min: 0, max: 20 })).toBe(8.5)
    expect(clampSetting("", { min: 0, max: 20 })).toBeNull()
    expect(clampSetting("abc", { min: 0, max: 20 })).toBeNull()
  })

  it("computes the example bill like the cart: tax and tip on the subtotal, rounded", () => {
    expect(exampleBill(100_000, 8, 10)).toEqual({ subtotal: 100_000, tax: 8_000, tip: 10_000, total: 118_000 })
    expect(exampleBill(100_000, 8.5, 0)).toEqual({ subtotal: 100_000, tax: 8_500, tip: 0, total: 108_500 })
  })
})
