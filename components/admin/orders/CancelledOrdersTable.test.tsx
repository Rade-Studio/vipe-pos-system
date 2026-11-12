import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import type { CancelledOrderDto } from "@/lib/api/orders"
import { CancelledOrdersTable } from "./CancelledOrdersTable"

const cancelled = (partial: Partial<CancelledOrderDto>) =>
  ({
    id: "o1",
    orderNumber: 140,
    orderType: "dine_in",
    tableNumber: null,
    waiterName: "Ana",
    customerName: null,
    delivery: null,
    cancellation: { total: 12000, cancelledAt: "2026-11-12T15:00:00Z", reason: "customer_left", reasonLabel: "El cliente se fue", reasonText: null, legacy: false, actor: { id: "p", name: "Ana" }, authorizedBy: null },
    ...partial,
  }) as unknown as CancelledOrderDto

describe("CancelledOrdersTable place", () => {
  it("names a cancelled takeaway order 'Para llevar · <nombre>' (S8)", () => {
    render(<CancelledOrdersTable orders={[cancelled({ orderType: "takeaway", customerName: "Laura" })]} isLoading={false} isError={false} onOpenAudit={() => {}} />)
    expect(screen.getByRole("table")).toHaveTextContent("Para llevar · Laura")
  })

  it("keeps a table order as Mesa N", () => {
    render(<CancelledOrdersTable orders={[cancelled({ tableNumber: 4 })]} isLoading={false} isError={false} onOpenAudit={() => {}} />)
    expect(screen.getByRole("table")).toHaveTextContent("Mesa 4")
  })
})
