import { describe, expect, it } from "vitest"
import { compactMoney } from "@/lib/admin/compact-money"

describe("compactMoney", () => {
  it("keeps chart axis labels short for COP amounts", () => {
    expect(compactMoney(0)).toBe("$0")
    expect(compactMoney(950)).toBe("$950")
    expect(compactMoney(450_000)).toBe("$450 k")
    expect(compactMoney(2_500_000)).toBe("$2,5 M")
    expect(compactMoney(12_000_000)).toBe("$12 M")
  })
})
