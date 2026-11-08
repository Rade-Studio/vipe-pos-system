import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { Table } from "@/types"
import { useTableStore } from "@/store/useTableStore"
import { CashierTablesView } from "./CashierTablesView"

/**
 * reservas-mesas T3 (S4, S5): caja's "Mesas" view is the waiter's floor map
 * and table panel, with the shared reserve sheet and the waiter picker.
 */

const api = vi.hoisted(() => ({
  getAll: vi.fn(async () => [] as unknown[]),
  reserveTable: vi.fn(),
  releaseTable: vi.fn(async (id: string) => ({ id })),
  assignWaiter: vi.fn(async (id: string, waiterId: string) => ({ id, waiterId })),
}))
vi.mock("@/lib/api/tables", async (actual) => ({ ...(await actual<typeof import("@/lib/api/tables")>()), ...api }))
const tableEvents = vi.hoisted(() => ({ cb: null as null | ((payload: unknown) => void) }))
vi.mock("@/lib/api/realtime", () => ({
  realtimeService: {
    subscribeToTables: (cb: (payload: unknown) => void) => {
      tableEvents.cb = cb
      return () => (tableEvents.cb = null)
    },
  },
}))
vi.mock("@/hooks/use-zones", () => ({ useZones: () => ({ data: [{ id: "z-1", name: "Salón", aspect: 1.6, labels: [] }] }) }))
vi.mock("@/hooks/use-waiters", () => ({
  useWaiters: () => ({ data: [{ id: "w-1", name: "Ana Gómez" }], isPending: false, isError: false, refetch: vi.fn() }),
}))

const inOneHour = () => new Date(Date.now() + 60 * 60 * 1000)
const spot = (x: number) => ({ zoneId: "z-1", x, y: 0.3, w: 0.1, h: 0.1, shape: "square" as const, rotation: 0 })
const tables = (): Table[] => [
  { id: "t-1", number: 1, status: "available", seats: 4, ...spot(0.2) },
  { id: "t-2", number: 2, status: "reserved", seats: 2, ...spot(0.6), reservationName: "Familia López", reservationArrivalAt: inOneHour().toISOString() },
]

function renderView() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <CashierTablesView />
    </QueryClientProvider>,
  )
}
const tableButton = (number: number) => screen.getByRole("button", { name: new RegExp(`^Mesa ${number},`) })

beforeEach(() => {
  // Noon today, so "in one hour" is always still today (the sheet's rule).
  const noon = new Date()
  noon.setHours(12, 0, 0, 0)
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(noon)
  Object.values(api).forEach((fn) => fn.mockClear())
  api.getAll.mockResolvedValue([])
  useTableStore.setState({ tables: tables() })
})

afterEach(() => vi.useRealTimers())

describe("CashierTablesView — caja's Mesas (reservas-mesas T3)", () => {
  it("renders the floor map and a reserved table shows its name", () => {
    renderView()
    expect(tableButton(1)).toBeInTheDocument()
    expect(tableButton(2)).toHaveAccessibleName(/Familia López/)
  })

  it("tap selects: the panel opens, with no Agregar productos in caja", () => {
    renderView()
    fireEvent.click(tableButton(1))
    const panel = screen.getByRole("region", { name: "Mesa 1" })
    expect(within(panel).queryByRole("button", { name: "Agregar productos" })).not.toBeInTheDocument()
    expect(within(panel).getByRole("button", { name: "Reservar" })).toHaveClass("min-h-11")
  })

  it("reserves a free table with the name and the arrival", async () => {
    const at = inOneHour()
    const time = `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`
    api.reserveTable.mockImplementation(async (id: string, body: { name: string; arrivalAt?: string }) => ({
      id, number: 1, status: "reserved", shape: "square", rotation: 0, isActive: true,
      reservationName: body.name, reservationArrivalAt: body.arrivalAt,
    }))
    renderView()
    fireEvent.click(tableButton(1))
    fireEvent.click(screen.getByRole("button", { name: "Reservar" }))
    fireEvent.change(await screen.findByLabelText(/A nombre de quién/), { target: { value: "Marta Ríos" } })
    fireEvent.change(screen.getByLabelText(/Hora de llegada/), { target: { value: time } })
    // The open sheet hides the panel from the accessibility tree: its own "Reservar".
    fireEvent.click(screen.getByRole("button", { name: "Reservar" }))
    await waitFor(() => expect(api.reserveTable).toHaveBeenCalledTimes(1))
    const [id, body] = api.reserveTable.mock.calls[0]
    expect(id).toBe("t-1")
    expect(body.name).toBe("Marta Ríos")
    expect(new Date(body.arrivalAt).getHours()).toBe(at.getHours())
    await waitFor(() => expect(useTableStore.getState().tables[0].reservationName).toBe("Marta Ríos"))
  })

  it("Cancelar reserva releases the reserved table", async () => {
    renderView()
    fireEvent.click(tableButton(2))
    const cancel = screen.getByRole("button", { name: "Cancelar reserva" })
    expect(cancel).toHaveClass("min-h-11")
    fireEvent.click(cancel)
    await waitFor(() => expect(api.releaseTable).toHaveBeenCalledWith("t-2"))
    expect(useTableStore.getState().tables[1].status).toBe("available")
  })

  it("Sentar clientes goes through the waiter picker and assigns", async () => {
    renderView()
    fireEvent.click(tableButton(2))
    const seat = screen.getByRole("button", { name: "Sentar clientes" })
    expect(seat).toHaveClass("min-h-11")
    fireEvent.click(seat)
    expect(api.assignWaiter).not.toHaveBeenCalled()
    fireEvent.click(await screen.findByText("Ana Gómez"))
    await waitFor(() => expect(api.assignWaiter).toHaveBeenCalledWith("t-2", "w-1"))
    expect(useTableStore.getState().tables[1]).toMatchObject({ status: "occupied", waiter: "w-1" })
  })

  it("applies live table changes from realtime to the same store", () => {
    renderView()
    act(() => tableEvents.cb?.({ eventType: "UPDATE", new: { id: "t-1", number: 1, status: "occupied" }, old: { id: "t-1" } }))
    expect(useTableStore.getState().tables[0].status).toBe("occupied")
  })
})
