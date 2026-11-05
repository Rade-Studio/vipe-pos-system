import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/api/client", () => ({ api: {} }))

import { orderItemsFromCart } from "@/lib/api/orders"

const DISH = "3f2b8c1e-5a4d-4e6f-9b7a-1c2d3e4f5a6b"

/**
 * The order body carries the dish uuid behind each cart id (the server prices
 * and stock-checks through it), the price the waiter saw as `unitPrice`, and
 * no timestamps. Since T8b this is the `POST /orders` body, not an
 * `order_items` insert.
 */
describe("orderItemsFromCart — dishId of each order line", () => {
  it("sends the dish uuid behind each cart id with the shown price and the comments", () => {
    expect(
      orderItemsFromCart([
        { id: `${DISH}-1729350000000`, name: "Burger", price: 15000, quantity: 1, categoryId: "", image: "", comments: "sin queso" },
        { id: DISH, name: "Burger", price: 15000, quantity: 2, categoryId: "", image: "" },
      ]),
    ).toEqual([
      { dishId: DISH, quantity: 1, unitPrice: 15000, comments: "sin queso" },
      { dishId: DISH, quantity: 2, unitPrice: 15000, comments: null },
    ])
  })

  it("refuses a cart line with no dish behind it instead of sending it", () => {
    expect(() =>
      orderItemsFromCart([{ id: "item-42", name: "Libre", price: 0, quantity: 1, categoryId: "", image: "" }]),
    ).toThrow("Libre")
  })
})
