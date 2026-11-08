import { render, screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { KitchenTicket } from "@/components/kitchen/KitchenTicket"
import { kitchenThresholds } from "@/lib/kitchen/ticket"
import type { Order, OrderItem, OrderItemModifier } from "@/types"

const sentAt = new Date(Date.now() - 60_000)
const mod = (groupName: string, optionId: string, name: string, price: number): OrderItemModifier => ({
  groupId: `g-${groupName}`,
  groupName,
  optionId,
  name,
  price,
})
const medio = mod("Término", "o-medio", "Medio", 0)
const ched = mod("Adiciones", "o-ched", "Queso cheddar", 3000)
const ceb = mod("Sin", "o-ceb", "Sin cebolla", 0)

const line = (id: string, extra: Partial<OrderItem> = {}): OrderItem => ({
  id,
  name: "Hamburguesa",
  price: 22000,
  quantity: 1,
  categoryId: "c",
  image: "",
  status: "kitchen",
  addedAt: sentAt,
  ...extra,
})

const order = (items: OrderItem[]): Order => ({
  id: "o-1",
  orderNumber: 130,
  tableId: "t-1",
  items,
  status: "active",
  bill: { subtotal: 0, tax: 0, tip: 0, total: 0, discounts: [], totalDiscounts: 0 } as unknown as Order["bill"],
  waiter: "w",
  createdAt: sentAt,
})

const renderTicket = (items: OrderItem[]) =>
  render(
    <KitchenTicket
      order={order(items)}
      place="Mesa 1"
      waiterName="Ana"
      address={null}
      note={null}
      now={Date.now()}
      thresholds={kitchenThresholds()}
      onServeItem={() => {}}
      onServeAll={() => {}}
    />,
  )

const rows = () => [...document.querySelectorAll<HTMLElement>("li[data-line]")]

describe("kitchen ticket modifiers (F7 T4, S6)", () => {
  it("never merges two burgers with different options, and merges the same options in any order", () => {
    renderTicket([
      line("i-1", { modifiers: [medio, ched] }),
      line("i-2", { modifiers: [ched, medio] }),
      line("i-3", { modifiers: [medio] }),
    ])
    const [first, second] = rows()
    expect(rows()).toHaveLength(2)
    expect(first).toHaveTextContent("2×")
    expect(second).toHaveTextContent("1×")
  })

  it("shows the options under the dish with the $0 rule and no prices", () => {
    renderTicket([line("i-1", { modifiers: [medio, ched, ceb], comments: "bien caliente" })])
    const options = screen.getByRole("list", { name: "Opciones" })
    expect(within(options).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Término: Medio",
      "+ Queso cheddar",
      "Sin cebolla",
    ])
    expect(rows()[0]).not.toHaveTextContent("$")
    expect(rows()[0]).toHaveTextContent("bien caliente")
  })

  it("still merges identical plain lines into one row and shows no options list", () => {
    renderTicket([line("i-1"), line("i-2"), line("i-3", { comments: "sin sal" })])
    expect(rows()).toHaveLength(2)
    expect(rows()[0]).toHaveTextContent("2×")
    expect(screen.queryByRole("list", { name: "Opciones" })).toBeNull()
  })
})
