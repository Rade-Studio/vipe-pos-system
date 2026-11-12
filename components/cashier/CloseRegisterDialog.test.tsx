import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * ordenes-abiertas-caja S2: the close dialog lists the restaurant's open
 * orders, cancels each through the audited VoidFlow, and only closes with
 * open orders left after the cashier confirms they pass to the next register.
 */

const orders = vi.hoisted(() => ({ getByStatus: vi.fn() }))
vi.mock("@/lib/api/orders", () => orders)
const payments = vi.hoisted(() => ({ closeRegisterRpc: vi.fn() }))
vi.mock("@/lib/api/payments", async (importActual) => ({
  openOrdersConflictOf: (await importActual<typeof import("@/lib/api/payments")>()).openOrdersConflictOf,
  ...payments,
}))
vi.mock("@/lib/api/registers", () => ({}))
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock("@/utils/toast", () => ({ toast }))

const summary = {
  registersCount: 1,
  initialCash: 0,
  paymentsCount: 0,
  totalBilled: 0,
  totalTips: 0,
  totalSales: 0,
  totalChange: 0,
  methods: [],
  cashDeposits: 0,
  cashWithdrawals: 0,
  expectedCash: 0,
  tipsPayout: 0,
  expectedCashAfterTips: 50000,
  legacy: { paymentsCount: 0, total: 0, tips: 0, change: 0, byMethod: {} },
}
vi.mock("@/hooks/use-register-summary", () => ({ useRegisterSummary: () => ({ data: summary, isLoading: false }) }))

const voidFlow = vi.hoisted(() => ({ targets: [] as unknown[] }))
vi.mock("@/components/voids/VoidFlow", () => ({
  VoidFlow: ({ target, onDone }: { target: { orderId: string } | null; onDone?: (r: unknown) => void }) => {
    if (!target) return null
    voidFlow.targets.push(target)
    return (
      <button type="button" onClick={() => onDone?.({ action: "order", orderId: target.orderId })}>
        Confirmar cancelación
      </button>
    )
  },
}))

import { CloseRegisterDialog } from "./CloseRegisterDialog"
import { ApiError } from "@/lib/api/errors"
import { PaymentServiceError } from "@/lib/payments/types"
import { useCashRegisterStore } from "@/store/use-cash-register-store"

const NOW = new Date("2026-11-11T12:00:00.000Z")
const register = { id: "r-1", openingTimestamp: NOW, initialCash: 0, status: "open" as const, transactions: [], cashTransactions: [] }

const order = (id: string, extra: Record<string, unknown>) => ({
  id,
  orderNumber: 1,
  status: "kitchen",
  orderType: "dine_in",
  total: 25000,
  items: [],
  tableNumber: null,
  waiterName: null,
  createdAt: NOW.toISOString(),
  ...extra,
})
const dineIn = order("o-1", {
  tableNumber: 8,
  waiterName: "Laura Gómez",
  total: 42000,
  createdAt: new Date(NOW.getTime() - (6 * 24 + 1) * 3_600_000).toISOString(),
})
const delivery = order("o-2", {
  orderType: "delivery",
  waiterName: "Pedro",
  createdAt: new Date(NOW.getTime() - 35 * 60_000).toISOString(),
})
const closed = { status: "closed", cashRegisterId: "r-1", finalCash: 0, closingTimestamp: NOW, summary }

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(NOW)
  orders.getByStatus.mockReset()
  payments.closeRegisterRpc.mockReset()
  toast.error.mockReset()
  voidFlow.targets = []
  useCashRegisterStore.setState({ currentRegister: register, registers: [register] })
})
afterEach(() => vi.useRealTimers())

const closeButton = () => screen.getByRole("button", { name: "Cerrar Caja" })
const typeCounted = (value: string) => fireEvent.change(screen.getByLabelText("Efectivo contado"), { target: { value } })

describe("CloseRegisterDialog with open orders", () => {
  it("lists the open orders with place, waiter, total and age", async () => {
    orders.getByStatus.mockResolvedValue([dineIn, delivery])
    render(<CloseRegisterDialog open onOpenChange={() => {}} />)
    const list = await screen.findByRole("list", { name: "Órdenes abiertas" })
    const rows = within(list).getAllByRole("listitem")
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent("Mesa 8")
    expect(rows[0]).toHaveTextContent("Laura Gómez")
    expect(rows[0]).toHaveTextContent(/42\.000/)
    expect(rows[0]).toHaveTextContent("hace 6 d 1 h")
    expect(rows[1]).toHaveTextContent("Domicilio")
    expect(rows[1]).toHaveTextContent("Pedro")
    expect(rows[1]).toHaveTextContent("hace 35 min")
    expect(orders.getByStatus).toHaveBeenCalledWith(["active", "kitchen", "delivered"], { include: ["table", "waiter"] })
  })

  it("keeps Cerrar Caja disabled until the checkbox, then sends leaveOpenOrders: true", async () => {
    orders.getByStatus.mockResolvedValue([dineIn, delivery])
    payments.closeRegisterRpc.mockResolvedValue(closed)
    render(<CloseRegisterDialog open onOpenChange={() => {}} />)
    const checkbox = await screen.findByRole("checkbox", { name: "Dejar 2 órdenes abiertas para la siguiente caja" })
    typeCounted("50000")
    expect(closeButton()).toBeDisabled()
    fireEvent.click(checkbox)
    expect(closeButton()).toBeEnabled()
    fireEvent.click(closeButton())
    await waitFor(() => expect(payments.closeRegisterRpc).toHaveBeenCalledWith("r-1", { leaveOpenOrders: true, countedCash: 50000 }))
  })

  it("uses the singular for one order", async () => {
    orders.getByStatus.mockResolvedValue([dineIn])
    render(<CloseRegisterDialog open onOpenChange={() => {}} />)
    expect(await screen.findByRole("checkbox", { name: "Dejar 1 orden abierta para la siguiente caja" })).toBeInTheDocument()
  })

  it("opens VoidFlow for the order and reloads the list after the cancel", async () => {
    orders.getByStatus.mockResolvedValueOnce([dineIn, delivery]).mockResolvedValueOnce([delivery])
    render(<CloseRegisterDialog open onOpenChange={() => {}} />)
    const list = await screen.findByRole("list", { name: "Órdenes abiertas" })
    const [first, second] = within(list).getAllByRole("button", { name: "Cancelar orden" })
    expect(first).toHaveClass("min-h-[44px]")
    fireEvent.click(second)
    expect(voidFlow.targets.at(-1)).toMatchObject({ action: "order", orderId: "o-2", total: 25000, delivery: true })
    fireEvent.click(first)
    expect(voidFlow.targets.at(-1)).toMatchObject({ action: "order", orderId: "o-1", total: 42000 })
    fireEvent.click(screen.getByRole("button", { name: "Confirmar cancelación" }))
    await waitFor(() => expect(within(screen.getByRole("list", { name: "Órdenes abiertas" })).getAllByRole("listitem")).toHaveLength(1))
    expect(orders.getByStatus).toHaveBeenCalledTimes(2)
    expect(screen.getByRole("checkbox", { name: "Dejar 1 orden abierta para la siguiente caja" })).not.toBeChecked()
  })

  it("shows the API 409 open_orders message and reloads the list", async () => {
    const message = "Hay 1 orden abierta. Cóbrala o cancélala, o confirma que pasa a la siguiente caja."
    orders.getByStatus.mockResolvedValueOnce([]).mockResolvedValueOnce([dineIn])
    payments.closeRegisterRpc.mockRejectedValue(
      new PaymentServiceError({ kind: "unknown", message, cause: new ApiError(409, "Conflict", message, { code: "open_orders", count: 1, message }) }),
    )
    render(<CloseRegisterDialog open onOpenChange={() => {}} />)
    typeCounted("50000")
    await waitFor(() => expect(closeButton()).toBeEnabled())
    fireEvent.click(closeButton())
    expect(await screen.findByRole("alert")).toHaveTextContent(message)
    expect(await screen.findByRole("checkbox", { name: "Dejar 1 orden abierta para la siguiente caja" })).toBeInTheDocument()
    expect(closeButton()).toBeDisabled()
  })
})

describe("CloseRegisterDialog without open orders", () => {
  it("shows no checkbox and closes with only the count", async () => {
    orders.getByStatus.mockResolvedValue([])
    payments.closeRegisterRpc.mockResolvedValue(closed)
    render(<CloseRegisterDialog open onOpenChange={() => {}} />)
    await waitFor(() => expect(orders.getByStatus).toHaveBeenCalled())
    expect(closeButton()).toBeDisabled()
    typeCounted("50000")
    await waitFor(() => expect(closeButton()).toBeEnabled())
    expect(screen.queryByRole("checkbox")).toBeNull()
    expect(screen.queryByRole("list", { name: "Órdenes abiertas" })).toBeNull()
    expect(screen.queryByLabelText("Nota del cierre")).toBeNull()
    fireEvent.click(closeButton())
    await waitFor(() => expect(payments.closeRegisterRpc).toHaveBeenCalledWith("r-1", { countedCash: 50000 }))
    expect(await screen.findByText("Cierre de Caja Completado")).toBeInTheDocument()
  })
})

describe("CloseRegisterDialog count (caja-cierres S1)", () => {
  beforeEach(() => orders.getByStatus.mockResolvedValue([]))

  it("requires a note of 3+ characters when the count differs from the expected cash", async () => {
    payments.closeRegisterRpc.mockResolvedValue(closed)
    render(<CloseRegisterDialog open onOpenChange={() => {}} />)
    await waitFor(() => expect(orders.getByStatus).toHaveBeenCalled())
    typeCounted("48000")
    expect(screen.getByText(/Faltante/)).toHaveTextContent(/2\.000/)
    const note = screen.getByLabelText("Nota del cierre")
    expect(closeButton()).toBeDisabled()
    fireEvent.change(note, { target: { value: " ab " } })
    expect(closeButton()).toBeDisabled()
    fireEvent.change(note, { target: { value: "  Faltó un billete  " } })
    expect(closeButton()).toBeEnabled()
    fireEvent.click(closeButton())
    await waitFor(() => expect(payments.closeRegisterRpc).toHaveBeenCalledWith("r-1", { countedCash: 48000, note: "Faltó un billete" }))
  })

  it("shows a surplus and refuses a non-whole amount", async () => {
    render(<CloseRegisterDialog open onOpenChange={() => {}} />)
    await waitFor(() => expect(orders.getByStatus).toHaveBeenCalled())
    typeCounted("51000")
    expect(screen.getByText(/Sobrante/)).toHaveTextContent(/1\.000/)
    typeCounted("-5")
    expect(closeButton()).toBeDisabled()
    typeCounted("10.5")
    expect(closeButton()).toBeDisabled()
  })
})
