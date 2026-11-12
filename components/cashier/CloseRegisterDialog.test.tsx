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
vi.mock("@/lib/api/payments", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/api/payments")>()
  return { openOrdersConflictOf: actual.openOrdersConflictOf, closeRefusalOf: actual.closeRefusalOf, ...payments }
})
const registers = vi.hoisted(() => ({ getCashTransactionsByRegisterId: vi.fn() }))
vi.mock("@/lib/api/registers", async (importActual) => ({
  CASH_MOVEMENT_REASONS: (await importActual<typeof import("@/lib/api/registers")>()).CASH_MOVEMENT_REASONS,
  ...registers,
}))
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock("@/utils/toast", () => ({ toast }))

const summary = {
  registersCount: 1,
  initialCash: 0,
  paymentsCount: 0,
  totalBilled: 0,
  totalTips: 30000,
  totalSales: 0,
  totalChange: 0,
  methods: [],
  cashDeposits: 0,
  cashWithdrawals: 0,
  expectedCash: 0,
  tipsPayout: 12000,
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
import { useConfigStore } from "@/store/use-config-store"

const NOW = new Date("2026-11-11T12:00:00.000Z")
const register = {
  id: "r-1",
  openingTimestamp: NOW,
  initialCash: 0,
  status: "open" as const,
  transactions: [],
  cashTransactions: [],
  openedBy: { id: "p-1", name: "Camilo Henao" },
}

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
  registers.getCashTransactionsByRegisterId.mockReset().mockResolvedValue([])
  voidFlow.targets = []
  useCashRegisterStore.setState({ currentRegister: register, registers: [register] })
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const closeButton = () => screen.getByRole("button", { name: "Cerrar turno" })
const tab = (name: string) => screen.getByRole("tab", { name })
const goTo = (name: string) => fireEvent.click(tab(name))
/** Quick count: the switch, then the single amount. */
const quickCount = (value: string) => {
  goTo("Arqueo")
  const toggle = screen.getByRole("switch", { name: "Arqueo rápido: solo total" })
  if (toggle.getAttribute("aria-checked") !== "true") fireEvent.click(toggle)
  fireEvent.change(screen.getByLabelText("Total contado en efectivo"), { target: { value } })
}
const printWindow = () => {
  const doc = { open: vi.fn(), write: vi.fn(), close: vi.fn() }
  vi.spyOn(window, "open").mockReturnValue({ document: doc } as unknown as Window)
  return () => doc.write.mock.calls.at(-1)?.[0] as string
}

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

  it("keeps Cerrar turno disabled until the checkbox, then sends leaveOpenOrders: true", async () => {
    orders.getByStatus.mockResolvedValue([dineIn, delivery])
    payments.closeRegisterRpc.mockResolvedValue(closed)
    render(<CloseRegisterDialog open onOpenChange={() => {}} />)
    const checkbox = await screen.findByRole("checkbox", { name: "Dejar 2 órdenes abiertas para la siguiente caja" })
    quickCount("50000")
    goTo("Confirmar")
    expect(closeButton()).toBeDisabled()
    goTo("Órdenes abiertas")
    fireEvent.click(screen.getByRole("checkbox", { name: "Dejar 2 órdenes abiertas para la siguiente caja" }))
    expect(checkbox).toBeDefined()
    goTo("Confirmar")
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

  it("shows the API 409 open_orders message inline and goes back to the orders step", async () => {
    const message = "Hay 1 orden abierta. Cóbrala o cancélala, o confirma que pasa a la siguiente caja."
    orders.getByStatus.mockResolvedValueOnce([]).mockResolvedValueOnce([dineIn])
    payments.closeRegisterRpc.mockRejectedValue(
      new PaymentServiceError({ kind: "unknown", message, cause: new ApiError(409, "Conflict", message, { code: "open_orders", count: 1, message }) }),
    )
    render(<CloseRegisterDialog open onOpenChange={() => {}} />)
    await waitFor(() => expect(orders.getByStatus).toHaveBeenCalled())
    quickCount("50000")
    goTo("Confirmar")
    fireEvent.click(closeButton())
    expect(await screen.findByRole("alert")).toHaveTextContent(message)
    expect(await screen.findByRole("checkbox", { name: "Dejar 1 orden abierta para la siguiente caja" })).toBeInTheDocument()
    expect(tab("Órdenes abiertas")).toHaveAttribute("aria-selected", "true")
    expect(toast.error).not.toHaveBeenCalled()
  })
})

describe("CloseRegisterDialog stepper (caja-cierres S3)", () => {
  beforeEach(() => orders.getByStatus.mockResolvedValue([]))

  it("shows four steps, marks the orders step done when there are none, and moves with the arrow keys", async () => {
    render(<CloseRegisterDialog open onOpenChange={() => {}} />)
    const tabs = screen.getAllByRole("tab")
    expect(tabs.map((t) => t.getAttribute("aria-label"))).toEqual(["Órdenes abiertas", "Movimientos y propinas", "Arqueo", "Confirmar"])
    expect(tabs[0]).toHaveAttribute("aria-selected", "true")
    expect(await screen.findByText("No hay órdenes abiertas.")).toBeInTheDocument()
    await waitFor(() => expect(tabs[0]).toHaveTextContent("Listo"))
    fireEvent.keyDown(tabs[0], { key: "ArrowRight" })
    expect(tabs[1]).toHaveAttribute("aria-selected", "true")
    expect(tabs[1]).toHaveFocus()
    expect(screen.getByRole("tabpanel")).toHaveAccessibleName("Movimientos y propinas")
    fireEvent.keyDown(tabs[1], { key: "End" })
    expect(tabs[3]).toHaveFocus()
    fireEvent.keyDown(tabs[3], { key: "ArrowRight" })
    expect(tabs[0]).toHaveFocus()
    fireEvent.keyDown(tabs[0], { key: "ArrowLeft" })
    expect(tabs[3]).toHaveAttribute("aria-selected", "true")
    fireEvent.keyDown(tabs[3], { key: "Home" })
    expect(tabs[0]).toHaveAttribute("aria-selected", "true")
    expect(tabs[0]).toHaveAttribute("tabindex", "0")
    expect(tabs[1]).toHaveAttribute("tabindex", "-1")
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }))
    expect(tabs[1]).toHaveAttribute("aria-selected", "true")
    fireEvent.click(screen.getByRole("button", { name: "Atrás" }))
    expect(tabs[0]).toHaveAttribute("aria-selected", "true")
  })

  it("lists the shift's movements with time, reason, author, description and amount, then the tips", async () => {
    registers.getCashTransactionsByRegisterId.mockResolvedValue([
      { id: "m1", amount: 50000, type: "deposit", description: "Para cambio", timestamp: new Date(2026, 10, 10, 9, 10), cash_register_id: "r-1", reason: "change_fund", createdBy: { id: "p-1", name: "Camilo Henao" } },
      { id: "m2", amount: 45000, type: "withdrawal", description: "Hielo El Polo", timestamp: new Date(2026, 10, 10, 10, 42), cash_register_id: "r-1", reason: null, createdBy: null },
    ])
    render(<CloseRegisterDialog open onOpenChange={() => {}} />)
    goTo("Movimientos y propinas")
    const list = await screen.findByRole("list", { name: "Entradas y salidas de efectivo" })
    const rows = within(list).getAllByRole("listitem")
    expect(registers.getCashTransactionsByRegisterId).toHaveBeenCalledWith("r-1")
    expect(rows[0]).toHaveTextContent("9:10 a.m.")
    expect(rows[0]).toHaveTextContent("Sencillo / base")
    expect(rows[0]).toHaveTextContent("Camilo Henao")
    expect(rows[0]).toHaveTextContent("Para cambio")
    expect(rows[0]).toHaveTextContent("+$ 50.000")
    expect(rows[1]).toHaveTextContent("Sin motivo")
    expect(rows[1]).toHaveTextContent("−$ 45.000")
    expect(screen.getByText("Propinas del turno").parentElement).toHaveTextContent("$ 30.000")
    expect(screen.getByText("Propinas a pagar en efectivo").parentElement).toHaveTextContent("$ 12.000")
  })

  it("counts by denomination with steppers and inputs, live subtotals, total and difference", async () => {
    payments.closeRegisterRpc.mockResolvedValue(closed)
    render(<CloseRegisterDialog open onOpenChange={() => {}} />)
    await waitFor(() => expect(orders.getByStatus).toHaveBeenCalled())
    goTo("Arqueo")
    const plus = screen.getByRole("button", { name: "Sumar un billete de $ 100.000" })
    expect(plus).toHaveClass("h-11")
    expect(screen.getByRole("button", { name: "Restar un billete de $ 100.000" })).toBeDisabled()
    fireEvent.click(plus)
    fireEvent.click(plus)
    fireEvent.click(screen.getByRole("button", { name: "Restar un billete de $ 100.000" }))
    fireEvent.click(plus)
    expect(screen.getByLabelText("Billetes de $ 100.000")).toHaveValue(2)
    expect(screen.getByTestId("subtotal-100000")).toHaveTextContent("$ 200.000")
    fireEvent.change(screen.getByLabelText("Monedas de $ 500"), { target: { value: "3" } })
    expect(screen.getByTestId("subtotal-500")).toHaveTextContent("$ 1.500")
    const card = screen.getByRole("region", { name: "Cuadre" })
    expect(card).toHaveTextContent(/Esperado\s*\$ 50\.000/)
    expect(card).toHaveTextContent(/Contado\s*\$ 201\.500/)
    expect(card).toHaveTextContent("Sobrante +$ 151.500")
    goTo("Confirmar")
    expect(closeButton()).toBeDisabled()
    goTo("Arqueo")
    fireEvent.change(screen.getByLabelText(/Nota del cuadre/), { target: { value: "Sobró de la mañana" } })
    goTo("Confirmar")
    fireEvent.click(closeButton())
    await waitFor(() =>
      expect(payments.closeRegisterRpc).toHaveBeenCalledWith("r-1", {
        countedCash: 201500,
        denominations: [
          { value: 100000, quantity: 2 },
          { value: 500, quantity: 3 },
        ],
        note: "Sobró de la mañana",
      }),
    )
  })

  it("quick mode takes one amount and sends no denominations", async () => {
    payments.closeRegisterRpc.mockResolvedValue(closed)
    render(<CloseRegisterDialog open onOpenChange={() => {}} />)
    await waitFor(() => expect(orders.getByStatus).toHaveBeenCalled())
    goTo("Arqueo")
    fireEvent.click(screen.getByRole("button", { name: "Sumar un billete de $ 50.000" }))
    quickCount("50000")
    expect(screen.queryByLabelText("Billetes de $ 100.000")).toBeNull()
    expect(screen.getByRole("region", { name: "Cuadre" })).toHaveTextContent("Cuadra")
    expect(screen.queryByLabelText(/Nota del cuadre/)).toBeNull()
    goTo("Confirmar")
    fireEvent.click(closeButton())
    await waitFor(() => expect(payments.closeRegisterRpc).toHaveBeenCalledWith("r-1", { countedCash: 50000 }))
    expect(await screen.findByText("Turno cerrado")).toBeInTheDocument()
  })

  it("requires a note of 3+ characters when the count differs", async () => {
    payments.closeRegisterRpc.mockResolvedValue(closed)
    render(<CloseRegisterDialog open onOpenChange={() => {}} />)
    await waitFor(() => expect(orders.getByStatus).toHaveBeenCalled())
    quickCount("48000")
    expect(screen.getByRole("region", { name: "Cuadre" })).toHaveTextContent("Faltante −$ 2.000")
    fireEvent.change(screen.getByLabelText(/Nota del cuadre/), { target: { value: " ab " } })
    goTo("Confirmar")
    expect(closeButton()).toBeDisabled()
    goTo("Arqueo")
    fireEvent.change(screen.getByLabelText(/Nota del cuadre/), { target: { value: "  Faltó un billete  " } })
    goTo("Confirmar")
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Faltó un billete")
    fireEvent.click(closeButton())
    await waitFor(() => expect(payments.closeRegisterRpc).toHaveBeenCalledWith("r-1", { countedCash: 48000, note: "Faltó un billete" }))
  })

  it("refuses a negative or non-whole quick amount", async () => {
    render(<CloseRegisterDialog open onOpenChange={() => {}} />)
    await waitFor(() => expect(orders.getByStatus).toHaveBeenCalled())
    quickCount("-5")
    goTo("Confirmar")
    expect(closeButton()).toBeDisabled()
    quickCount("10.5")
    goTo("Confirmar")
    expect(closeButton()).toBeDisabled()
  })

  it("shows the server's 422 message inline instead of a generic toast", async () => {
    const message = "La diferencia necesita una nota de 3 a 300 caracteres."
    payments.closeRegisterRpc.mockRejectedValue(
      new PaymentServiceError({ kind: "invalid-input", message, cause: new ApiError(422, "Unprocessable Entity", message, { code: "note_required", message }) }),
    )
    render(<CloseRegisterDialog open onOpenChange={() => {}} />)
    await waitFor(() => expect(orders.getByStatus).toHaveBeenCalled())
    quickCount("50000")
    goTo("Confirmar")
    fireEvent.click(closeButton())
    expect(await screen.findByRole("alert")).toHaveTextContent(message)
    expect(toast.error).not.toHaveBeenCalled()
    expect(useCashRegisterStore.getState().currentRegister).toBe(register)
  })

  it("prints a preview before closing and the stored close afterwards", async () => {
    const written = printWindow()
    payments.closeRegisterRpc.mockResolvedValue({
      ...closed,
      countedCash: 48000,
      cashDifference: -2000,
      closeNote: "Faltó",
      denominations: [{ value: 20000, quantity: 2 }, { value: 2000, quantity: 4 }],
      closedBy: { id: "p-2", name: "Daniela Ríos" },
    })
    render(<CloseRegisterDialog open onOpenChange={() => {}} />)
    await waitFor(() => expect(orders.getByStatus).toHaveBeenCalled())
    quickCount("48000")
    fireEvent.change(screen.getByLabelText(/Nota del cuadre/), { target: { value: "Faltó" } })
    goTo("Confirmar")
    fireEvent.click(screen.getByRole("button", { name: "Imprimir cierre de turno" }))
    expect(written()).toContain("VISTA PREVIA")
    expect(written()).toContain("CIERRE DE TURNO")
    fireEvent.click(closeButton())
    expect(await screen.findByText("Turno cerrado")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Imprimir cierre de turno" }))
    const html = written()
    expect(html).not.toContain("VISTA PREVIA")
    expect(html).toContain("Daniela Ríos")
    expect(html).toMatch(/\$ 20\.000 × 2\s+\$ 40\.000/)
    expect(html).toContain("Nota: Faltó")
  })

  it("prints the configured tax label on the preview and the closed slip (S9)", async () => {
    const written = printWindow()
    payments.closeRegisterRpc.mockResolvedValue({ ...closed, countedCash: 50000, cashDifference: 0 })
    useConfigStore.setState({ taxPercentage: 8 })
    render(<CloseRegisterDialog open onOpenChange={() => {}} />)
    await waitFor(() => expect(orders.getByStatus).toHaveBeenCalled())
    quickCount("50000")
    goTo("Confirmar")
    fireEvent.click(screen.getByRole("button", { name: "Imprimir cierre de turno" }))
    expect(written()).toContain("INC (8 %)")
    fireEvent.click(closeButton())
    expect(await screen.findByText("Turno cerrado")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Imprimir cierre de turno" }))
    expect(written()).toContain("INC (8 %)")
  })
})
