import { beforeEach, describe, expect, it } from "vitest"
import type { CartItem } from "@/types"
import { useCartStore } from "./useCartStore"

const D = "3f1c2a9e-0b4d-4c55-9a1e-6d2f7b8c9d01"
const medio = { groupId: "g-t", groupName: "Término", optionId: "o-medio", name: "Medio", price: 0 }
const ched = { groupId: "g-a", groupName: "Adiciones", optionId: "o-ched", name: "Queso cheddar", price: 3000 }
const toc = { groupId: "g-a", groupName: "Adiciones", optionId: "o-toc", name: "Tocineta", price: 4000 }
const item = (overrides: Partial<CartItem> = {}): CartItem => ({
  id: D,
  name: "Hamburguesa",
  price: 22000,
  quantity: 1,
  categoryId: "c",
  image: "",
  ...overrides,
})
const cart = () => useCartStore.getState().getCartByTable("t-1")

describe("cart line identity (F7): dish + sorted option ids + note", () => {
  beforeEach(() => useCartStore.setState({ cartItems: {} }))

  it("a plain dish added twice is one line, as before", () => {
    useCartStore.getState().addToCart("t-1", item())
    useCartStore.getState().addToCart("t-1", item({ quantity: 2 }))
    expect(cart()).toHaveLength(1)
    expect(cart()[0]).toMatchObject({ quantity: 3, price: 22000 })
    expect(cart()[0]!.id.startsWith(`${D}-`)).toBe(true)
  })

  it("the same options in another order merge; other options or another note are new lines", () => {
    const { addToCart } = useCartStore.getState()
    addToCart("t-1", item({ price: 29000, modifiers: [medio, ched, toc] }))
    addToCart("t-1", item({ price: 29000, modifiers: [toc, medio, ched] }))
    addToCart("t-1", item({ price: 25000, modifiers: [medio, ched] }))
    addToCart("t-1", item({ price: 25000, modifiers: [medio, ched], comments: "pan sin tostar" }))
    addToCart("t-1", item())
    expect(cart().map((line) => line.quantity)).toEqual([2, 1, 1, 1])
    expect(useCartStore.getState().getCartTotal("t-1")).toBe(29000 * 2 + 25000 * 2 + 22000)
  })

  it("replaceLine edits a line in place, and merges it into an equal line", () => {
    const { addToCart } = useCartStore.getState()
    addToCart("t-1", item({ price: 22000, modifiers: [medio] }))
    addToCart("t-1", item({ price: 25000, modifiers: [medio, ched] }))
    const [first, second] = cart()
    useCartStore.getState().replaceLine("t-1", first!.id, item({ price: 26000, quantity: 3, modifiers: [medio, toc] }))
    expect(cart()).toHaveLength(2)
    expect(cart()[0]).toMatchObject({ id: first!.id, price: 26000, quantity: 3, modifiers: [medio, toc] })
    useCartStore.getState().replaceLine("t-1", first!.id, item({ price: 25000, quantity: 3, modifiers: [ched, medio] }))
    expect(cart()).toEqual([{ ...second!, quantity: 4 }])
  })
})
