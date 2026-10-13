import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import type React from "react"
import { QueryClientProvider } from "@tanstack/react-query"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { queryClient } from "@/lib/queryClient"

const getRegistersByDate = vi.fn()
const getCashTransactionsByRegisters = vi.fn()
vi.mock("@/lib/supabase/client", () => ({
  supabase: {},
  createSupabaseClient: () => ({}),
}))
vi.mock("@/lib/supabase/cash-register-service", () => ({
  cashRegisterService: {
    getRegistersByDate: (...args: unknown[]) => getRegistersByDate(...args),
    getCashTransactionsByRegisters: (...args: unknown[]) => getCashTransactionsByRegisters(...args),
  },
}))

/** The server snapshot the card renders; no RPC in a jsdom suite. */
const summary = {
  registersCount: 1,
  paymentsCount: 3,
  totalBilled: 320_000,
  totalTips: 10_000,
  initialCash: 50_000,
  totalSales: 320_000,
  totalChange: 5_000,
  methods: [],
  cashDeposits: 10_000,
  cashWithdrawals: 0,
  expectedCash: 300_000,
  tipsPayout: 10_000,
  expectedCashAfterTips: 290_000,
  legacy: { paymentsCount: 0, total: 0, tips: 0, change: 0, byMethod: {} },
}
vi.mock("@/hooks/use-register-summary", () => ({
  useRegisterSummary: () => ({ data: summary, isLoading: false }),
}))

import { CashRegisterSummary } from "@/components/admin/CashRegisterSummary"

/**
 * T9 (S1) — Caja: the duplicated cash-movements read.
 *
 * `CashRegisterSummary` fetched the cash movements from a `useQuery` on mount
 * AND kept a `useEffect` that called `refetchCashTransactions()` every time the
 * inner "Movimientos de Efectivo" tab became active — for a query that
 * `TransactionsByRegisterId` also reads under the same key, so one tab click
 * could fire two reads of one cache slot. The read now only happens when the
 * tab is actually open, and the key is shared with the other Caja reader.
 */

const DAY = new Date(2026, 0, 15)

function register(id: string) {
  return {
    id,
    opened_at: new Date(2026, 0, 15, 8, 0).toISOString(),
    closed_at: null,
    initial_cash: 50_000,
    status: "open",
  }
}

function wrap(ui: React.ReactElement) {
  return <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
}

/**
 * Radix `TabsTrigger` activates on `mousedown` (not `click`), so the tab has to
 * be driven the way a user drives it.
 */
async function selectTab(name: string) {
  const trigger = await screen.findByRole("tab", { name })
  await act(async () => {
    fireEvent.mouseDown(trigger)
  })
}

beforeEach(() => {
  queryClient.clear()
  getRegistersByDate.mockReset()
  getCashTransactionsByRegisters.mockReset()
  getRegistersByDate.mockResolvedValue([register("r-1")])
  getCashTransactionsByRegisters.mockResolvedValue([
    {
      id: "t-1",
      cash_register_id: "r-1",
      type: "deposit",
      description: "Fondo inicial",
      amount: 50_000,
      timestamp: new Date(2026, 0, 15, 8, 5).toISOString(),
    },
  ])
})

describe("CashRegisterSummary — one read of the cash movements, when the tab asks for them", () => {
  it("does not read the cash movements while they are not on screen", async () => {
    render(wrap(<CashRegisterSummary selectedDate={DAY} />))

    await waitFor(() => expect(screen.getByText("Resumen de Caja")).toBeInTheDocument())
    expect(getCashTransactionsByRegisters).not.toHaveBeenCalled()
  })

  it("reads them exactly once when the tab is opened (no fetch + refetch effect)", async () => {
    render(wrap(<CashRegisterSummary selectedDate={DAY} />))
    await waitFor(() => expect(screen.getByText("Resumen de Caja")).toBeInTheDocument())

    await selectTab("Movimientos de Efectivo")

    await waitFor(() => expect(getCashTransactionsByRegisters).toHaveBeenCalledTimes(1))
    expect(await screen.findByText("Fondo inicial")).toBeInTheDocument()
  })

  it("does not read them again on a tab switch back and forth", async () => {
    render(wrap(<CashRegisterSummary selectedDate={DAY} />))
    await waitFor(() => expect(screen.getByText("Resumen de Caja")).toBeInTheDocument())

    await selectTab("Movimientos de Efectivo")
    await waitFor(() => expect(getCashTransactionsByRegisters).toHaveBeenCalledTimes(1))

    await selectTab("Detalles")
    await selectTab("Movimientos de Efectivo")

    expect(getCashTransactionsByRegisters).toHaveBeenCalledTimes(1)
    expect(await screen.findByText("Fondo inicial")).toBeInTheDocument()
  })

  it("reads the selected day's registers once and reuses them when the Caja tab is revisited", async () => {
    const first = render(wrap(<CashRegisterSummary selectedDate={DAY} />))
    await waitFor(() => expect(screen.getByText("Resumen de Caja")).toBeInTheDocument())
    expect(getRegistersByDate).toHaveBeenCalledTimes(1)

    first.unmount()
    render(wrap(<CashRegisterSummary selectedDate={DAY} />))

    // Synchronously: the card is already rendered, not blanked by a skeleton.
    expect(screen.getByText("Resumen de Caja")).toBeInTheDocument()
    expect(getRegistersByDate).toHaveBeenCalledTimes(1)
  })
})

describe("CashRegisterSummary — preserved behaviour", () => {
  it("still renders the server snapshot for the selected register", async () => {
    render(wrap(<CashRegisterSummary selectedDate={DAY} />))

    await waitFor(() => expect(screen.getByText("Efectivo Inicial")).toBeInTheDocument())
    expect(screen.getByText("Ventas Totales")).toBeInTheDocument()
    expect(screen.getByText("Efectivo esperado al cierre")).toBeInTheDocument()
  })

  it("still labels the movements (Ingreso/Retiro) and the empty state", async () => {
    getCashTransactionsByRegisters.mockResolvedValue([])
    render(wrap(<CashRegisterSummary selectedDate={DAY} />))
    await waitFor(() => expect(screen.getByText("Resumen de Caja")).toBeInTheDocument())

    await selectTab("Movimientos de Efectivo")

    await waitFor(() =>
      expect(screen.getByText("No hay movimientos de efectivo registrados")).toBeInTheDocument(),
    )
  })

  it("still tells the admin when the day has no registers at all", async () => {
    getRegistersByDate.mockResolvedValue([])
    render(wrap(<CashRegisterSummary selectedDate={DAY} />))

    await waitFor(() =>
      expect(screen.getByText(/No hay cajas registradas para el/)).toBeInTheDocument(),
    )
    expect(getCashTransactionsByRegisters).not.toHaveBeenCalled()
  })
})