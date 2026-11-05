import { describe, expect, it } from "vitest"
import { formatAxisAmount } from "./SalesChart"

/** D3 smoke nit: 3–6 million COP ticks were clipped to "000000". */
describe("formatAxisAmount", () => {
  // Intl separates the unit with a non-breaking space.
  it("shortens millions to a compact es-CO label", () => {
    expect(formatAxisAmount(3_500_000)).toBe("3,5\u00a0M")
    expect(formatAxisAmount(6_000_000)).toBe("6\u00a0M")
    expect(formatAxisAmount(12_000_000)).toBe("12\u00a0M")
  })

  it("keeps small amounts as they are", () => {
    expect(formatAxisAmount(0)).toBe("0")
    expect(formatAxisAmount(950)).toBe("950")
  })
})
