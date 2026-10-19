import { describe, expect, it } from "vitest"
import { dishIdFromCartItemId } from "@/lib/menu/cart-dish-id"

const DISH = "3f2b8c1e-5a4d-4e6f-9b7a-1c2d3e4f5a6b"

describe("dishIdFromCartItemId", () => {
  it("keeps a bare dish uuid", () => {
    expect(dishIdFromCartItemId(DISH)).toBe(DISH)
  })

  it("strips the cart suffix appended to the dish uuid", () => {
    expect(dishIdFromCartItemId(`${DISH}-1729350000000`)).toBe(DISH)
    expect(dishIdFromCartItemId(`${DISH}-sin-cebolla`)).toBe(DISH)
  })

  it("returns null for ids that do not start with a uuid", () => {
    expect(dishIdFromCartItemId("item-42")).toBeNull()
    expect(dishIdFromCartItemId("temp-1729350000000")).toBeNull()
    expect(dishIdFromCartItemId("")).toBeNull()
  })
})
