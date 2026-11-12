import { describe, expect, it } from "vitest"
import { DEFAULT_TAX_TYPE, TAX_TYPES, taxBreakdown, taxLabel, taxName } from "./tax-label"

/** caja-cierres S9: the configured tax type labels bills, slips and reports. */
describe("tax label", () => {
  it("names INC and IVA (default INC)", () => {
    expect(DEFAULT_TAX_TYPE).toBe("INC")
    expect(TAX_TYPES).toEqual([
      { value: "INC", name: "Impuesto nacional al consumo" },
      { value: "IVA", name: "IVA" },
    ])
    expect(taxName("INC")).toBe("Impuesto nacional al consumo")
    expect(taxName("IVA")).toBe("IVA")
  })

  it("labels the type with the configured rate", () => {
    expect(taxLabel("INC", 8)).toBe("INC (8 %)")
    expect(taxLabel("IVA", 19)).toBe("IVA (19 %)")
    expect(taxLabel("INC", 8.5)).toBe("INC (8,5 %)")
    expect(taxLabel(undefined, 10)).toBe("INC (10 %)")
  })

  it("splits tax-included sales into base and tax, rounded to pesos", () => {
    expect(taxBreakdown(1486200, 8)).toEqual({ base: 1376111, tax: 110089 })
    expect(taxBreakdown(145000, 10)).toEqual({ base: 131818, tax: 13182 })
    expect(taxBreakdown(0, 19)).toEqual({ base: 0, tax: 0 })
  })
})
