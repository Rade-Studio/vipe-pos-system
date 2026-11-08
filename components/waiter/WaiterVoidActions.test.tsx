import { fireEvent, render, screen } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { describe, expect, it, vi } from "vitest"
import type { Order } from "@/types"

/** F3 — the waiter's "Anular plato" per live line and "Cancelar orden" for any open order. */

vi.mock("@/components/voids/VoidFlow", () => ({
  VoidFlow: ({ target }: { target: { action: string; lines: { modifiers?: { name: string }[] }[] } | null }) =>
    target ? (
      <p>
        Hoja {target.action} · {target.lines.length} platos
        {target.lines.flatMap((l) => l.modifiers ?? []).map((m) => ` · ${m.name}`)}
      </p>
    ) : null,
}))

import { WaiterVoidActions } from "./WaiterVoidActions"

function order(partial: Partial<Order>): Order {
  return {
    id: "o-1",
    orderNumber: 12,
    tableId: "t-1",
    items: [],
    status: "kitchen",
    bill: { subtotal: 0, tax: 0, taxPercentage: 0, tip: 0, tipPercentage: 0, total: 0, totalDiscounts: 0 },
    waiter: "w-1",
    createdAt: new Date(),
    ...partial,
  } as Order
}

const renderActions = (o: Order) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <WaiterVoidActions order={o} tableNumber={3} />
    </QueryClientProvider>,
  )

describe("WaiterVoidActions", () => {
  it("offers Cancelar orden on an order whose lines were all voided, without Anular plato", () => {
    renderActions(order({ items: [] }))
    expect(screen.queryByRole("button", { name: /^Anular / })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Cancelar orden" }))
    expect(screen.getByText("Hoja order · 0 platos")).toBeInTheDocument()
  })

  it("keeps Anular plato for each live line", () => {
    const line = { id: "i-1", dishId: "d-1", name: "Bandeja paisa", price: 100, quantity: 1, status: "kitchen" }
    renderActions(order({ items: [line as unknown as Order["items"][number]] }))
    expect(screen.getByRole("button", { name: "Anular Bandeja paisa" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Cancelar orden" })).toBeInTheDocument()
  })

  it("passes each line's options to the void sheet (F7), so the waiter sees which burger it is", () => {
    const modifiers = [{ groupId: "g-1", groupName: "Término de la carne", optionId: "o-1", name: "Medio", price: 0 }]
    const line = { id: "i-1", dishId: "d-1", name: "Hamburguesa", price: 29000, quantity: 1, status: "kitchen", modifiers }
    renderActions(order({ items: [line as unknown as Order["items"][number]] }))
    fireEvent.click(screen.getByRole("button", { name: "Cancelar orden" }))
    expect(screen.getByText(/Hoja order · 1 platos · Medio/)).toBeInTheDocument()
  })

  it("offers nothing on a paid or cancelled order", () => {
    for (const status of ["paid", "cancelled"] as const) {
      const { unmount } = renderActions(order({ status }))
      expect(screen.queryByRole("button", { name: "Cancelar orden" })).not.toBeInTheDocument()
      unmount()
    }
  })
})
