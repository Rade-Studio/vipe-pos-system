import { beforeEach, describe, expect, it } from "vitest"
import type { CartItem } from "@/types"
import { useCartStore } from "./useCartStore"

// jsdom suite (.tsx): the persisted cart needs a real localStorage.
const item = (overrides: Partial<CartItem> = {}): CartItem => ({
  id: "3f1c2a9e-0b4d-4c55-9a1e-6d2f7b8c9d01",
  name: "Hamburguesa",
  price: 22000,
  quantity: 1,
  categoryId: "c",
  image: "",
  ...overrides,
})
const cart = () => useCartStore.getState().getCartByTable("t-1")

describe("cart persistence (H-052): the cart survives a reload", () => {
  beforeEach(() => {
    localStorage.clear()
    useCartStore.setState({ cartItems: {} })
  })

  it("stores only the table carts under vipe-cart and reads them back on rehydrate", async () => {
    useCartStore.getState().addToCart("t-1", item({ quantity: 2 }))
    const stored = JSON.parse(localStorage.getItem("vipe-cart") ?? "null")
    expect(Object.keys(stored.state)).toEqual(["cartItems"])
    expect(stored.state.cartItems["t-1"]).toEqual([expect.objectContaining({ name: "Hamburguesa", quantity: 2 })])

    // A reload: the memory is gone, the storage is not.
    useCartStore.setState({ cartItems: {} })
    localStorage.setItem("vipe-cart", JSON.stringify(stored))
    await useCartStore.persist.rehydrate()
    expect(cart()).toEqual([expect.objectContaining({ name: "Hamburguesa", quantity: 2 })])
  })

  it("a cleared table is stored empty, so a reload does not bring it back", async () => {
    useCartStore.getState().addToCart("t-1", item())
    useCartStore.getState().clearCart("t-1")
    await useCartStore.persist.rehydrate()
    expect(cart()).toEqual([])
  })
})
