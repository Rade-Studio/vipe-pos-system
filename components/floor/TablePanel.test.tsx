import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import type { Order, Table } from "@/types"
import { TablePanel } from "./TablePanel"

const table = (overrides: Partial<Table> = {}): Table => ({ id: "t-7", number: 7, status: "available", seats: 4, ...overrides })

const renderPanel = (t: Table, order?: Order | null) => {
  const handlers = { onAddItems: vi.fn(), onReserve: vi.fn(), onRelease: vi.fn(), onSeat: vi.fn() }
  render(<TablePanel table={t} zoneName="Salón" order={order} {...handlers} />)
  return handlers
}

describe("TablePanel — reservations (reservas-mesas T2, S1, S2, S5)", () => {
  it("offers Reservar on a free table only", () => {
    const { onReserve } = renderPanel(table())
    const reserve = screen.getByRole("button", { name: "Reservar" })
    expect(reserve).toHaveClass("min-h-11")
    fireEvent.click(reserve)
    expect(onReserve).toHaveBeenCalledWith("t-7")
  })

  it("hides Reservar on an occupied table and on a free table with an open order", () => {
    renderPanel(table({ status: "occupied", waiter: "w-1" }))
    expect(screen.queryByRole("button", { name: "Reservar" })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Liberar mesa" })).toBeInTheDocument()
  })

  it("hides Reservar on an available table that still has an open order", () => {
    renderPanel(table(), { id: "o-1", tableId: "t-7", status: "active", items: [] } as unknown as Order)
    expect(screen.queryByRole("button", { name: "Reservar" })).not.toBeInTheDocument()
  })

  it("a reserved table shows the reservation, Sentar clientes and Cancelar reserva", () => {
    const at = new Date()
    at.setHours(20, 30, 0, 0)
    const { onSeat, onRelease, onAddItems } = renderPanel(
      table({ status: "reserved", reservationName: "Familia López", reservationArrivalAt: at.toISOString() }),
    )
    const panel = screen.getByRole("region", { name: "Mesa 7" })
    expect(panel).toHaveTextContent("Reserva: Familia López · llega 8:30 p. m.")
    expect(screen.queryByRole("button", { name: "Reservar" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Liberar mesa" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Agregar productos" })).not.toBeInTheDocument()

    const seat = screen.getByRole("button", { name: "Sentar clientes" })
    const cancel = screen.getByRole("button", { name: "Cancelar reserva" })
    expect(seat).toHaveClass("min-h-11")
    expect(cancel).toHaveClass("min-h-11")
    fireEvent.click(seat)
    expect(onSeat).toHaveBeenCalledWith("t-7")
    fireEvent.click(cancel)
    expect(onRelease).toHaveBeenCalledWith("t-7")
    expect(onAddItems).not.toHaveBeenCalled()
  })
})

import { FloorTable } from "./FloorTable"

describe("FloorTable — a reserved tile names the reservation (T2, S2)", () => {
  it("shows the name and the arrival under the table and in its accessible name", () => {
    const at = new Date()
    at.setHours(20, 30, 0, 0)
    const t = table({ status: "reserved", x: 0.5, y: 0.5, w: 0.1, h: 0.1, reservationName: "Familia López", reservationArrivalAt: at.toISOString() })
    render(<FloorTable table={t} aspect={1.6} selected={false} mine={false} onSelect={() => {}} />)
    const tile = screen.getByRole("button", { name: /^Mesa 7, Reservada/ })
    expect(tile).toHaveAccessibleName(expect.stringContaining("Reserva: Familia López · llega 8:30 p. m."))
    expect(screen.getByTestId("table-status")).toHaveTextContent("Familia López · 8:30 p. m.")
  })
})

describe("TablePanel — release (QA S1, L3)", () => {
  it.each(["kitchen", "served"] as const)("a %s table has no release button and says caja frees it", (status) => {
    renderPanel(table({ status, waiter: "w-1" }))

    expect(screen.queryByRole("button", { name: "Liberar mesa" })).not.toBeInTheDocument()
    expect(screen.getByText("Se libera sola cuando caja cobra o cancela la orden.")).toBeInTheDocument()
  })
})
