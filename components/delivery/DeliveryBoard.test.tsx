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
  // T11: the delivery hook rides `realtimeService.subscribeToDeliveries`.
  const subscriptions: Array<{ handler: Handler; active: boolean }> = []
  const emit = (table: string, payload: Record<string, unknown>) => {
    for (const subscription of subscriptions) {
      if (subscription.active) subscription.handler({ table, ...payload })
    }
  }
  const subscribeToDeliveries = (handler: Handler) => {
    const subscription = { handler, active: true }
    subscriptions.push(subscription)
    return () => {
      subscription.active = false
    }
  }
  // T12: the live indicator reads the socket state.
  const realtime = { isConnected: false, subscribeToDeliveries }
  return { subscriptions, emit, subscribeToDeliveries, realtime }
})

const listActiveDeliveries = vi.hoisted(() => vi.fn())
const setDeliveryStatus = vi.hoisted(() => vi.fn())
const listCouriers = vi.hoisted(() => vi.fn())

vi.mock("@/lib/api/delivery", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/delivery")>("@/lib/api/delivery")
  return { ...actual, listActiveDeliveries, setDeliveryStatus, listCouriers }
})

const getCurrentRegister = vi.hoisted(() => vi.fn())
const getOpenRegister = vi.hoisted(() => vi.fn())

vi.mock("@/lib/api/realtime", () => ({
  realtimeService: harness.realtime,
}))

vi.mock("@/lib/api/registers", () => ({ getCurrentRegister, getOpenRegister }))

vi.mock("@/lib/api/catalog", () => ({
  fetchCategories: async () => [],
  fetchDishes: async () => [],
}))

vi.mock("@/lib/api/config", () => ({
  CONFIG_QUERY_KEY: ["config"],
  fetchConfig: async () => ({ deliveryDefaultFee: 5000 }),
}))

vi.mock("@/lib/api/payments", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/payments")>("@/lib/api/payments")
  return { ...actual, listPaymentMethods: async () => [], payOrder: async () => ({}) }
})

const toastError = vi.hoisted(() => vi.fn())
const toastSuccess = vi.hoisted(() => vi.fn())

vi.mock("@/hooks/use-toast", () => ({
  toast: { error: toastError, success: toastSuccess, warning: vi.fn() },
  useToast: () => ({ toast: toastError }),
}))

import { DeliveryBoard } from "@/components/delivery/DeliveryBoard"
import { DeliveryServiceError } from "@/lib/api/delivery"
import type { DeliveryOrderWithBill } from "@/lib/api/delivery"
import { activeDeliveriesQueryKey } from "@/hooks/use-active-deliveries"
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

function statusOf(cache: DeliveryOrderWithBill[], orderId: string): string | undefined {
  return cache.find((r) => r.delivery.orderId === orderId)?.delivery.status
}

function renderBoard(client: QueryClient) {
  return render(
    <QueryClientProvider client={client}>
      <DeliveryBoard role="delivery_operator" />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  harness.subscriptions.length = 0
  listActiveDeliveries.mockReset()
  listCouriers.mockReset()
  listCouriers.mockResolvedValue([])
  harness.realtime.isConnected = false
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

    fireEvent.click(screen.getByRole("button", { name: "Preparar" }))

    await waitFor(() => expect(setDeliveryStatus).toHaveBeenCalledTimes(1))
    expect(setDeliveryStatus).toHaveBeenCalledWith({ orderId: "d-1", action: "start_preparing" })
    // One read for the board, not one more for the action.
    await waitFor(() => expect(listActiveDeliveries).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByRole("tab", { name: "En preparación 1" })).toBeInTheDocument())
    expect(screen.getByRole("tab", { name: "Recibido 0" })).toBeInTheDocument()

    // The realtime echo of our own write must not reload the board either.
    harness.emit("order_deliveries", {
      eventType: "UPDATE",
      new: wireRow({ delivery_status: "preparing" }),
    })
    await new Promise((resolve) => setTimeout(resolve, 250))
    expect(listActiveDeliveries).toHaveBeenCalledTimes(1)
  })

  // Same guard as the kitchen: `applyMove` must merge the RPC row on top of the
  // cache as it is AFTER the call, never on a snapshot taken before it.
  it("keeps a push that landed on another card while the action was in flight", async () => {
    const client = makeClient()
    listActiveDeliveries.mockResolvedValue([boardRow(), boardRow({ order_id: "d-2", customer_name: "Luis Pérez" })])
    setDeliveryStatus.mockImplementation(async (input: { orderId: string }) => {
      const cache = client.getQueryData<DeliveryOrderWithBill[]>(activeDeliveriesQueryKey) ?? []
      client.setQueryData(
        activeDeliveriesQueryKey,
        cache.map((row) =>
          row.delivery.orderId === "d-2"
            ? {
                ...row,
                delivery: parseOrderDeliveryRow(
                  wireRow({
                    order_id: "d-2",
                    customer_name: "Luis Pérez",
                    delivery_status: "ready",
                    updated_at: "2026-10-07T10:06:00.000Z",
                  }),
                ),
              }
            : row,
        ),
      )
      return parseOrderDeliveryRow(
        wireRow({ order_id: input.orderId, delivery_status: "preparing", updated_at: "2026-10-07T10:06:00.000Z" }),
      )
    })

    renderBoard(client)
    await waitFor(() => expect(screen.getByText("Ana Ruiz")).toBeInTheDocument())
    fireEvent.click(screen.getAllByRole("button", { name: "Preparar" })[0]!)

    await waitFor(() => expect(setDeliveryStatus).toHaveBeenCalledTimes(1))
    await waitFor(() => {
      const cache = client.getQueryData<DeliveryOrderWithBill[]>(activeDeliveriesQueryKey) ?? []
      expect(statusOf(cache, "d-1")).toBe("preparing")
      expect(statusOf(cache, "d-2")).toBe("ready")
    })
  })

  it("refreshes the board once when the server rejects the action", async () => {
    setDeliveryStatus.mockRejectedValue(
      new DeliveryServiceError({ kind: "rejected", message: "delivery is already in state ready" }),
    )
    const client = makeClient()
    renderBoard(client)
    await waitFor(() => expect(screen.getByText("Ana Ruiz")).toBeInTheDocument())
    expect(listActiveDeliveries).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole("button", { name: "Preparar" }))

    await waitFor(() => expect(toastError).toHaveBeenCalled())
    await waitFor(() => expect(listActiveDeliveries).toHaveBeenCalledTimes(2))
    await new Promise((resolve) => setTimeout(resolve, 250))
    expect(listActiveDeliveries).toHaveBeenCalledTimes(2)
  })
})

describe("DeliveryBoard — T12 dispatch console", () => {
  it("shows the real live state of the socket", async () => {
    renderBoard(makeClient())
    await waitFor(() => expect(screen.getByText("Ana Ruiz")).toBeInTheDocument())
    expect(screen.getByText("Sin conexión en vivo")).toBeInTheDocument()

    harness.realtime.isConnected = true
    await waitFor(() => expect(screen.getByText("En vivo")).toBeInTheDocument(), { timeout: 3000 })
    expect(screen.queryByText("Sin conexión en vivo")).not.toBeInTheDocument()
  })

  it("opens Nuevo domicilio with the N shortcut, but not while typing", async () => {
    renderBoard(makeClient())
    await waitFor(() => expect(screen.getByText("Ana Ruiz")).toBeInTheDocument())
    expect(screen.queryByRole("dialog", { name: "Nuevo domicilio" })).not.toBeInTheDocument()

    const input = document.createElement("input")
    document.body.appendChild(input)
    fireEvent.keyDown(input, { key: "n" })
    expect(screen.queryByRole("dialog", { name: "Nuevo domicilio" })).not.toBeInTheDocument()
    input.remove()

    fireEvent.keyDown(document.body, { key: "n" })
    await waitFor(() => expect(screen.getByRole("dialog", { name: "Nuevo domicilio" })).toBeInTheDocument())
  })

  it("lists the couriers with their real load and active state", async () => {
    listActiveDeliveries.mockResolvedValue([
      boardRow({ delivery_status: "out_for_delivery", courier_id: "k-1" }),
    ])
    listCouriers.mockResolvedValue([
      { id: "k-1", name: "Juan Camilo Ospina", phone: null, isActive: true, createdAt: "", updatedAt: "" },
      { id: "k-2", name: "Luis Pérez", phone: null, isActive: true, createdAt: "", updatedAt: "" },
      { id: "k-3", name: "Sebastián Gutiérrez", phone: null, isActive: false, createdAt: "", updatedAt: "" },
    ])
    renderBoard(makeClient())

    const rail = await screen.findByRole("region", { name: "Repartidores" })
    await waitFor(() => expect(rail).toHaveTextContent("Juan Camilo Ospina"))
    expect(listCouriers).toHaveBeenCalledWith({ activeOnly: false })
    expect(rail).toHaveTextContent(/Juan Camilo Ospina\s*1 pedido en ruta\s*En ruta/)
    expect(rail).toHaveTextContent(/Luis Pérez\s*En el local\s*Libre/)
    expect(rail).toHaveTextContent(/Sebastián Gutiérrez\s*No asignable\s*Inactivo/)
  })

  it("shows the suggested delivery fee setting", async () => {
    renderBoard(makeClient())
    const rail = await screen.findByRole("region", { name: "Repartidores" })
    await waitFor(() => expect(rail).toHaveTextContent(/Valor sugerido del domicilio\s*\$\s*5\.000/))
  })

  it("labels the card actions per state", async () => {
    renderBoard(makeClient())
    await waitFor(() => expect(screen.getByText("Ana Ruiz")).toBeInTheDocument())
    expect(screen.getByRole("button", { name: "Preparar" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeInTheDocument()
  })
})
