import { render, screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { KitchenOrderPrintView } from "./KitchenOrderPrintView"
import type { PrintableKitchenOrder } from "@/types"

const order = (items: unknown[]) =>
  ({ orderNumber: "130", table: 1, waiter: "Ana", items, createdAt: new Date() }) as unknown as PrintableKitchenOrder

describe("KitchenOrderPrintView (F7)", () => {
  it("shows a line's options under it, without prices", () => {
    const modifiers = [
      { groupId: "g-t", groupName: "Término", optionId: "o-m", name: "Medio", price: 0 },
      { groupId: "g-a", groupName: "Adiciones", optionId: "o-c", name: "Queso cheddar", price: 3000 },
    ]
    render(<KitchenOrderPrintView order={order([{ id: "i-1", name: "Hamburguesa", quantity: 1, modifiers }])} onClose={() => {}} />)
    const options = screen.getByRole("list", { name: "Opciones" })
    expect(within(options).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Término: Medio", "+ Queso cheddar"])
    expect(options).not.toHaveTextContent("$")
  })

  it("shows a plain line as before, with no options list", () => {
    render(<KitchenOrderPrintView order={order([{ id: "i-1", name: "Arepa", quantity: 2, comments: "sin queso" }])} onClose={() => {}} />)
    expect(screen.getByText("sin queso")).toBeInTheDocument()
    expect(screen.queryByRole("list", { name: "Opciones" })).toBeNull()
  })
})
