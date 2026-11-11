import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import type { AdminOrder } from "@/lib/admin/orders"
import { StaleOrdersBanner } from "./StaleOrdersBanner"

const nowMs = new Date("2026-11-06T19:48:00Z").getTime()
const hoursAgo = (h: number, m = 0) => new Date(nowMs - (h * 60 + m) * 60_000)
const order = (id: string, partial: Partial<AdminOrder>): AdminOrder =>
  ({ id, tableId: "", items: [], status: "kitchen", waiter: "", createdAt: hoursAgo(0, 5), ...partial }) as AdminOrder

/** S3: the admin Órdenes banner for orders open 12 h or more. */
describe("StaleOrdersBanner (S3)", () => {
  it("lists every old order with its place, waiter and age (plural)", () => {
    render(
      <StaleOrdersBanner
        nowMs={nowMs}
        orders={[
          order("a", { tableId: "t4", tableName: 4, waiterName: "Ana", createdAt: hoursAgo(145, 27) }),
          order("b", { orderType: "delivery", createdAt: hoursAgo(12) }),
          order("c", { tableId: "t2", tableName: 2, createdAt: hoursAgo(11, 59) }),
        ]}
      />,
    )
    const banner = screen.getByRole("region", { name: "2 órdenes llevan abiertas más de 12 horas" })
    const rows = banner.querySelectorAll("li")
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent("Mesa 4")
    expect(rows[0]).toHaveTextContent("Ana")
    expect(rows[0]).toHaveTextContent("hace 6 d 1 h")
    expect(rows[1]).toHaveTextContent("Domicilio")
    expect(rows[1]).toHaveTextContent("hace 12 h 00")
    expect(banner).toHaveTextContent("Cóbralas en caja o cancélalas desde su tarjeta.")
  })

  it("uses the singular for one old order", () => {
    render(<StaleOrdersBanner nowMs={nowMs} orders={[order("a", { tableName: 9, createdAt: hoursAgo(13) })]} />)
    expect(screen.getByText("1 orden lleva abierta más de 12 horas")).toBeInTheDocument()
  })

  it("renders nothing without old orders", () => {
    const { container } = render(<StaleOrdersBanner nowMs={nowMs} orders={[order("a", { createdAt: hoursAgo(1) })]} />)
    expect(container).toBeEmptyDOMElement()
  })
})
