import { describe, expect, it } from "vitest"
import { railCounter } from "@/components/kitchen/KitchenRail"

describe("rail counter", () => {
  it("names the single ticket in view on a phone", () => {
    expect(railCounter({ first: 0, last: 0 }, 5)).toBe("1 de 5")
  })

  it("names the range in view and how many follow", () => {
    expect(railCounter({ first: 0, last: 2 }, 5)).toBe("Viendo 1–3 de 5 · 2 más →")
    expect(railCounter({ first: 2, last: 4 }, 5)).toBe("Viendo 3–5 de 5")
  })
})
