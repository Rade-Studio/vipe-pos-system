import { render, screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import type { OrderDto } from "@/lib/api/orders"
import { OpenOrdersList, cancelTarget, openOrderPlace } from "./OpenOrdersList"

const order = (id: string, extra: Partial<OrderDto>) =>
  ({ id, orderNumber: 3, status: "kitchen", orderType: "dine_in", total: 18000, items: [], tableNumber: null, waiterName: null, createdAt: null, ...extra }) as OrderDto

describe("OpenOrdersList places (promociones S8)", () => {
  it("names a takeaway order 'Para llevar · <cliente>' and keeps Mesa N, Domicilio and Sin mesa", () => {
    const takeaway = order("o-1", { orderType: "takeaway", customerName: "Ana María" })
    render(
      <OpenOrdersList
        orders={[takeaway, order("o-2", { tableNumber: 8 }), order("o-3", { orderType: "delivery" }), order("o-4", {})]}
        now={0}
        onCancel={() => {}}
      />,
    )
    const rows = within(screen.getByRole("list", { name: "Órdenes abiertas" })).getAllByRole("listitem")
    expect(rows.map((row) => row.querySelector("p")?.textContent?.replace(/\s+/g, " "))).toEqual([
      "Para llevar · Ana María · $ 18.000",
      "Mesa 8 · $ 18.000",
      "Domicilio · $ 18.000",
      "Sin mesa · $ 18.000",
    ])
  })

  it("labels the cancel of a takeaway order with the customer, not as a delivery", () => {
    const target = cancelTarget(order("o-1", { orderType: "takeaway", customerName: "Luis" }))
    expect(target.label).toBe("#3 · Para llevar · Luis")
    expect(target).not.toHaveProperty("delivery")
    expect(openOrderPlace(order("o-5", { orderType: "takeaway", tableNumber: 4, customerName: "Luis" }))).toBe("Para llevar · Luis")
  })
})
