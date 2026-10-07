import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * T10 (S1/S2) — operator board behaviour that the user reported and this task
 * owns:
 *
 *  1. "lightweight register open check": the board loaded the FULL open
 *     register on mount and again before every payment — three requests each
 *     time (`cash_registers` + `payment_transactions` + `cash_transactions`)
 *     for a screen that only asks "is a register open?".
 *  2. "card actions without a double reload": every action ran the RPC, then
 *     an explicit `invalidateQueries`, and then the realtime push for its own
 *     write invalidated again — up to three board reloads for one click.
 *
 * Both are asserted through the public surface: rendered output plus the
 * number of calls the mocked services received.
 */

const harness = vi.hoisted(() => {
  type Handler = (payload: unknown) => void

  const recorded: Array<{
    name: string
    handlers: Array<{ table: string; handler: Handler }>
    subscribed: boolean
  }> = []

  const emit = (table: string, payload: unknown) => {
    for (const channel of recorded) {
      if (!channel.subscribed) continue
      for (const entry of channel.handlers) {
        if (entry.table === table) entry.handler(payload)
      }
    }
  }

  const supabase = {
    channel: (name: string) => {
      const record = { name, handlers: [] as Array<{ table: string; handler: Handler }>, subscribed: false }
      recorded.push(record)
      const api = {
        on: (_type: string, filter: { table: string }, handler: Handler) => {
          record.handlers.push({ table: filter.table, handler })
          return api
        },
        subscribe: () => {
          record.subscribed = true
          return api
        },
        __name: name,
      }
      return api
    },
    removeChannel: () => {},
    from: () => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: null, error: null }) }) }),
    }),
    rpc: async () => ({ data: null, error: null }),
  }

  return { recorded, emit, supabase }
})

vi.mock("@/lib/supabase/client", () => ({
  supabase: harness.supabase,
  createSupabaseClient: () => ({}),
}))

const listActiveDeliveries = vi.hoisted(() => vi.fn())
const setDeliveryStatus = vi.hoisted(() => vi.fn())

vi.mock("@/lib/supabase/delivery-service", async () => {
  const actual = await vi.importActual<typeof import("@/lib/supabase/delivery-service")>(
    "@/lib/supabase/delivery-service",
  )
  return { ...actual, listActiveDeliveries, setDeliveryStatus }
})

const getCurrentRegister = vi.hoisted(() => vi.fn())
const getOpenRegister = vi.hoisted(() => vi.fn())

vi.mock("@/lib/supabase/cash-register-service", () => ({
  cashRegisterService: { getCurrentRegister, getOpenRegister },
}))

vi.mock("@/lib/supabase/service", () => ({
  categoryService: { getAllActive: async () => [] },
  orderService: { getById: () => new Promise(() => {}) },
}))

vi.mock("@/lib/supabase/dish-service-with-promotions", () => ({
  dishServiceWithPromotions: { getByCategoryWithPromotions: async () => [] },
}))

vi.mock("@/lib/supabase/payments-service", async () => {
  const actual = await vi.importActual<typeof import("@/lib/supabase/payments-service")>(
    "@/lib/supabase/payments-service",
  )
  return { ...actual, listPaymentMethods: async () => [], payOrder: async () => ({}) }
})

const toastError = vi.hoisted(() => vi.fn())
const toastSuccess = vi.hoisted(() => vi.fn())

vi.mock("@/hooks/use-toast", () => ({
  toast: { error: toastError, success: toastSuccess, warning: vi.fn() },
  useToast: () => ({ toast: toastError }),
}))

import { DeliveryBoard } from "@/components/delivery/DeliveryBoard"
import { DeliveryServiceError } from "@/lib/supabase/delivery-service"
import { useCashRegisterStore } from "@/store/use-cash-register-store"
import { parseOrderDeliveryRow } from "@/lib/delivery/parse"
import type { CashRegister } from "@/types/cash-register"

function wireRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    order_id: "d-1",
    customer_id: "c-1",
    customer_name: "Ana Ruiz",
    customer_phone: "3101234567",
    address_line: "Calle 5 # 10-20",
    neighborhood: "Lacentro",
    address_reference: "Timbre 2",
    delivery_fee: 3000,
    payment_mode: "cash_on_delivery",
    cash_change_for: null,
    courier_id: null,
    delivery_status: "received",
    failure_reason: null,
    notes: null,
    dispatched_at: null,
    delivered_at: null,
    failed_at: null,
    cancelled_at: null,
    created_at: "2026-10-07T10:00:00.000Z",
    updated_at: "2026-10-07T10:00:00.000Z",
    ...overrides,
  }
}

function boardRow(overrides: Record<string, unknown> = {}) {
  return {
    delivery: parseOrderDeliveryRow(wireRow(overrides)),
    amountDue: 19_000,
    subtotal: 19_000,
    tax: 0,
    isPaid: false,
  }
}

const openRegister = {
  id: "r-1",
  openingTimestamp: new Date("2026-10-07T08:00:00.000Z"),
  initialCash: 100_000,
  status: "open",
  transactions: [],
  cashTransactions: [],
} as unknown as CashRegister

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 30_000 } },
  })
}

function renderBoard(client: QueryClient) {
  return render(
    <QueryClientProvider client={client}>
      <DeliveryBoard role="delivery_operator" />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  harness.recorded.length = 0
  listActiveDeliveries.mockReset()
  setDeliveryStatus.mockReset()
  getCurrentRegister.mockReset()
  getOpenRegister.mockReset()
  toastError.mockReset()
  toastSuccess.mockReset()
  listActiveDeliveries.mockResolvedValue([boardRow()])
  setDeliveryStatus.mockResolvedValue(parseOrderDeliveryRow(wireRow({ delivery_status: "preparing" })))
  getOpenRegister.mockResolvedValue(openRegister)
  getCurrentRegister.mockResolvedValue(openRegister)
  useCashRegisterStore.setState({ currentRegister: null, registers: [] })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("DeliveryBoard — register open check", () => {
  it("asks only for the open register (one read) and never loads the full register", async () => {
    renderBoard(makeClient())
    await waitFor(() => expect(screen.getByText("Ana Ruiz")).toBeInTheDocument())

    expect(getOpenRegister).toHaveBeenCalledTimes(1)
    expect(getCurrentRegister).not.toHaveBeenCalled()
    expect(useCashRegisterStore.getState().isRegisterOpen()).toBe(true)
  })

  it("still opens the payment dialog for an open register, re-checking with one read", async () => {
    renderBoard(makeClient())
    await waitFor(() => expect(screen.getByText("Ana Ruiz")).toBeInTheDocument())

    fireEvent.click(screen.getByRole("button", { name: /registrar pago/i }))

    await waitFor(() =>
      expect(screen.getByText("Cargando información de la orden...")).toBeInTheDocument(),
    )
    expect(getOpenRegister).toHaveBeenCalledTimes(2)
    expect(getCurrentRegister).not.toHaveBeenCalled()
  })

  it("blocks the payment when no register is open, and does not open the dialog", async () => {
    getOpenRegister.mockResolvedValue(null)
    renderBoard(makeClient())
    await waitFor(() => expect(screen.getByText("Ana Ruiz")).toBeInTheDocument())

    fireEvent.click(screen.getByRole("button", { name: /registrar pago/i }))

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        "No hay caja abierta. Pide al cajero que abra la caja para registrar el pago.",
      ),
    )
    expect(screen.queryByText("Cargando información de la orden...")).not.toBeInTheDocument()
  })
})

describe("DeliveryBoard — one reload per card action", () => {
  it("patches the card from the RPC result and does not refetch the board", async () => {
    const client = makeClient()
    renderBoard(client)
    await waitFor(() => expect(screen.getByText("Ana Ruiz")).toBeInTheDocument())
    expect(listActiveDeliveries).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole("button", { name: "En preparación" }))

    await waitFor(() => expect(setDeliveryStatus).toHaveBeenCalledTimes(1))
    expect(setDeliveryStatus).toHaveBeenCalledWith({ orderId: "d-1", action: "start_preparing" })
    // One read for the board, not one more for the action.
    await waitFor(() => expect(listActiveDeliveries).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByText("En preparación (1)")).toBeInTheDocument())
    expect(screen.getByText("Recibido (0)")).toBeInTheDocument()

    // The realtime echo of our own write must not reload the board either.
    harness.emit("order_deliveries", {
      eventType: "UPDATE",
      new: wireRow({ delivery_status: "preparing" }),
    })
    await new Promise((resolve) => setTimeout(resolve, 250))
    expect(listActiveDeliveries).toHaveBeenCalledTimes(1)
  })

  it("refreshes the board once when the server rejects the action", async () => {
    setDeliveryStatus.mockRejectedValue(
      new DeliveryServiceError({ kind: "rejected", message: "delivery is already in state ready" }),
    )
    const client = makeClient()
    renderBoard(client)
    await waitFor(() => expect(screen.getByText("Ana Ruiz")).toBeInTheDocument())
    expect(listActiveDeliveries).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole("button", { name: "En preparación" }))

    await waitFor(() => expect(toastError).toHaveBeenCalled())
    await waitFor(() => expect(listActiveDeliveries).toHaveBeenCalledTimes(2))
    await new Promise((resolve) => setTimeout(resolve, 250))
    expect(listActiveDeliveries).toHaveBeenCalledTimes(2)
  })
})