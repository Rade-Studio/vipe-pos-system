import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * T25 (S2, S8) — the dispatch console shows what L14 left out, from stored
 * data: operator and register in the header, the live signal age, the closed
 * today split and average, order numbers, payment channel, late highlighting,
 * courier trips (ETA, location, return) and the operator's courier actions.
 */

const harness = vi.hoisted(() => {
  type Handler = (payload: unknown) => void
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
  const realtime = { isConnected: false, subscribeToDeliveries }
  return { subscriptions, emit, realtime }
})

const api = vi.hoisted(() => ({
  listActiveDeliveries: vi.fn(),
  setDeliveryStatus: vi.fn(),
  listCouriers: vi.fn(),
  getClosedTodaySummary: vi.fn(),
  returnCourier: vi.fn(),
  createCourier: vi.fn(),
  updateCourier: vi.fn(),
  getOpenRegister: vi.fn(),
  config: { deliveryDefaultFee: 5000, deliveryLateMinutes: 45 } as Record<string, unknown>,
}))

vi.mock("@/lib/api/delivery", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/delivery")>("@/lib/api/delivery")
  return {
    ...actual,
    listActiveDeliveries: api.listActiveDeliveries,
    setDeliveryStatus: api.setDeliveryStatus,
    listCouriers: api.listCouriers,
    getClosedTodaySummary: api.getClosedTodaySummary,
    returnCourier: api.returnCourier,
    createCourier: api.createCourier,
    updateCourier: api.updateCourier,
  }
})

vi.mock("@/lib/api/realtime", () => ({ realtimeService: harness.realtime }))
vi.mock("@/lib/api/registers", () => ({ getCurrentRegister: vi.fn(), getOpenRegister: api.getOpenRegister }))
vi.mock("@/lib/api/catalog", () => ({ fetchCategories: async () => [], fetchDishes: async () => [] }))
vi.mock("@/lib/api/config", () => ({ CONFIG_QUERY_KEY: ["config"], fetchConfig: async () => api.config }))
vi.mock("@/lib/api/payments", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/payments")>("@/lib/api/payments")
  return { ...actual, listPaymentMethods: async () => [], payOrder: async () => ({}) }
})

const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), warning: vi.fn() }))
vi.mock("@/hooks/use-toast", () => ({ toast, useToast: () => ({ toast: toast.error }) }))

import { DeliveryBoard, REGISTER_POLL_MS } from "@/components/delivery/DeliveryBoard"
import { parseOrderDeliveryRow } from "@/lib/delivery/parse"
import { courierEtaAt } from "@/lib/delivery/dispatch-details"
import { useCashRegisterStore } from "@/store/use-cash-register-store"
import type { CashRegister } from "@/types/cash-register"

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString()

function wireRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    order_id: "d-1",
    customer_id: "c-1",
    customer_name: "Ana Ruiz",
    customer_phone: "3101234567",
    address_line: "Calle 5 # 10-20",
    neighborhood: "Centro",
    address_reference: null,
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
    created_at: minutesAgo(2),
    updated_at: minutesAgo(2),
    ...overrides,
  }
}

function boardRow(overrides: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  return {
    delivery: { ...parseOrderDeliveryRow(wireRow(overrides)), ...extra },
    amountDue: 19_000,
    subtotal: 19_000,
    tax: 0,
    isPaid: false,
  }
}

const courier = (id: string, name: string, isActive = true) => ({ id, name, phone: null, isActive, createdAt: "", updatedAt: "" })

const openRegister = { id: "r-1", status: "open", transactions: [], cashTransactions: [] } as unknown as CashRegister

function renderBoard(props: { operatorName?: string } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 30_000 } } })
  return render(
    <QueryClientProvider client={client}>
      <DeliveryBoard role="delivery_operator" {...props} />
    </QueryClientProvider>,
  )
}

const click = async (element: HTMLElement) => {
  await act(async () => {
    fireEvent.click(element)
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  harness.subscriptions.length = 0
  harness.realtime.isConnected = false
  api.config = { deliveryDefaultFee: 5000, deliveryLateMinutes: 45 }
  api.listActiveDeliveries.mockResolvedValue([boardRow()])
  api.listCouriers.mockResolvedValue([])
  api.getClosedTodaySummary.mockResolvedValue({ deliveredCount: 21, cancelledCount: 2, failedCount: 1, averageDeliveryMinutes: 34 })
  api.getOpenRegister.mockResolvedValue(openRegister)
  api.setDeliveryStatus.mockResolvedValue(parseOrderDeliveryRow(wireRow({ delivery_status: "out_for_delivery", courier_id: "k-1" })))
  api.returnCourier.mockResolvedValue(parseOrderDeliveryRow(wireRow({ delivery_status: "delivered", returned_at: minutesAgo(0) })))
  api.createCourier.mockResolvedValue(courier("k-9", "Nuevo"))
  api.updateCourier.mockResolvedValue(courier("k-3", "Sebastián Gutiérrez"))
  useCashRegisterStore.setState({ currentRegister: null, registers: [] })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("console header (T25)", () => {
  it("shows the operator and 'Caja abierta' from the open register", async () => {
    renderBoard({ operatorName: "Valentina Ríos" })
    await waitFor(() => expect(screen.getByLabelText("Turno")).toHaveTextContent("Valentina Ríos · Caja abierta"))
  })

  it("shows 'Caja cerrada' when no register is open", async () => {
    api.getOpenRegister.mockResolvedValue(null)
    renderBoard({ operatorName: "Valentina Ríos" })
    await waitFor(() => expect(screen.getByLabelText("Turno")).toHaveTextContent("Valentina Ríos · Caja cerrada"))
  })

  it("shows the age of the last live signal while connected", async () => {
    harness.realtime.isConnected = true
    renderBoard()
    await screen.findByText("Ana Ruiz")
    await act(async () => {
      harness.emit("order_deliveries", { eventType: "UPDATE", new: wireRow() })
    })
    const live = screen.getByRole("status", { name: /En vivo/ })
    await waitFor(() => expect(live).toHaveTextContent(/^En vivo · hace \d+ s$/))
  })
})

describe("register and live signal follow the real state (T25 review)", () => {
  it("re-checks the register on window focus: a register closed elsewhere shows 'Caja cerrada', a new one 'Caja abierta'", async () => {
    renderBoard({ operatorName: "Valentina Ríos" })
    await waitFor(() => expect(screen.getByLabelText("Turno")).toHaveTextContent("Caja abierta"))
    api.getOpenRegister.mockResolvedValue(null)
    await act(async () => {
      window.dispatchEvent(new Event("focus"))
    })
    await waitFor(() => expect(screen.getByLabelText("Turno")).toHaveTextContent("Valentina Ríos · Caja cerrada"))
    api.getOpenRegister.mockResolvedValue({ ...openRegister, id: "r-2" })
    await act(async () => {
      window.dispatchEvent(new Event("focus"))
    })
    await waitFor(() => expect(screen.getByLabelText("Turno")).toHaveTextContent("Valentina Ríos · Caja abierta"))
  })

  it("polls the register every 60 s", () => {
    expect(REGISTER_POLL_MS).toBe(60_000)
  })

  it("a lost connection shows its age and the stale-board banner; both clear when it is back", async () => {
    harness.realtime.isConnected = true
    renderBoard()
    await screen.findByText("Ana Ruiz")
    await act(async () => {
      harness.emit("order_deliveries", { eventType: "UPDATE", new: wireRow() })
    })
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    harness.realtime.isConnected = false
    const banner = await screen.findByRole("alert", undefined, { timeout: 3000 })
    expect(banner).toHaveTextContent(/^Se perdió la conexión en vivo hace \d+ s\. El tablero puede estar desactualizado; las acciones siguen funcionando\./)
    expect(screen.getByRole("status", { name: /Sin conexión en vivo/ })).toHaveTextContent(/^Sin conexión en vivo · hace \d+ s$/)
    api.listActiveDeliveries.mockClear()
    await click(within(banner).getByRole("button", { name: "Actualizar tablero" }))
    await waitFor(() => expect(api.listActiveDeliveries).toHaveBeenCalledTimes(1))
    harness.realtime.isConnected = true
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument(), { timeout: 3000 })
  })
})

describe("cerrados hoy (T25)", () => {
  it("shows the delivered/cancelled split, failed and the average delivery time", async () => {
    renderBoard()
    const summary = await screen.findByRole("group", { name: "Cerrados hoy" })
    await waitFor(() => expect(summary).toHaveTextContent("21 entregados · 2 cancelados · 1 fallido"))
    expect(summary).toHaveTextContent("Promedio de entrega 34 min")
    expect(api.getClosedTodaySummary).toHaveBeenCalledTimes(1)
  })
})

describe("cards (T25)", () => {
  it("show #D-0412 from the order number and the prepaid channel", async () => {
    api.listActiveDeliveries.mockResolvedValue([
      boardRow({ payment_mode: "prepaid", prepaid_method_id: "m-1" }, { orderNumber: 412, prepaidMethod: { id: "m-1", name: "Nequi" } }),
    ])
    renderBoard()
    const card = await screen.findByRole("article", { name: /Ana Ruiz/ })
    expect(card).toHaveTextContent("#D-0412")
    expect(card).toHaveTextContent("Anticipado · Nequi")
  })

  it("turn late at deliveryLateMinutes and at risk from 60 % of it", async () => {
    api.config = { deliveryDefaultFee: 5000, deliveryLateMinutes: 20 }
    api.listActiveDeliveries.mockResolvedValue([
      boardRow({ order_id: "d-1", customer_name: "Tarde", created_at: minutesAgo(21) }),
      boardRow({ order_id: "d-2", customer_name: "Riesgo", created_at: minutesAgo(13) }),
      boardRow({ order_id: "d-3", customer_name: "A tiempo", created_at: minutesAgo(5) }),
    ])
    renderBoard()
    await waitFor(() => expect(screen.getByRole("article", { name: /Tarde/ })).toHaveTextContent("Demorado"))
    expect(screen.getByRole("article", { name: /Riesgo/ })).toHaveTextContent("En riesgo")
    expect(screen.getByRole("article", { name: /A tiempo/ })).not.toHaveTextContent(/Demorado|En riesgo/)
  })
})

describe("card clock (T25 review)", () => {
  it("a delivery on the road counts from dispatch, not from the order", async () => {
    api.config = { deliveryDefaultFee: 5000, deliveryLateMinutes: 20 }
    api.listActiveDeliveries.mockResolvedValue([
      boardRow({ delivery_status: "out_for_delivery", courier_id: "k-1", created_at: minutesAgo(60), dispatched_at: minutesAgo(5), updated_at: minutesAgo(1) }),
    ])
    renderBoard()
    const tab = await screen.findByRole("tab", { name: "En camino 1" })
    await act(async () => {
      fireEvent.mouseDown(tab, { button: 0, ctrlKey: false })
    })
    const card = await screen.findByRole("article", { name: /Ana Ruiz/ })
    expect(card).toHaveTextContent("hace 5 min")
    expect(card).not.toHaveTextContent(/demorado|en riesgo/i)
  })
})

describe("couriers rail (T25)", () => {
  it("shows the trip of a courier out, 'En el local' otherwise, and records a return", async () => {
    const eta = new Date(Date.now() + 60 * 60_000)
    eta.setSeconds(0, 0)
    api.listActiveDeliveries.mockResolvedValue([
      boardRow(
        { order_id: "d-1", delivery_status: "out_for_delivery", courier_id: "k-1", dispatched_at: minutesAgo(10) },
        { courierEta: eta.toISOString(), courierLocation: "Laureles" },
      ),
      boardRow({ order_id: "d-2", customer_name: "Luis", delivery_status: "delivered", courier_id: "k-2" }),
    ])
    api.listCouriers.mockResolvedValue([courier("k-1", "Juan Camilo Ospina"), courier("k-2", "Duván Mosquera"), courier("k-4", "Ana Ruiz")])
    renderBoard()
    const rail = await screen.findByRole("region", { name: "Repartidores" })
    await waitFor(() => expect(rail).toHaveTextContent("Juan Camilo Ospina"))
    const hhmm = `${String(eta.getHours()).padStart(2, "0")}:${String(eta.getMinutes()).padStart(2, "0")}`
    const item = (name: string) => within(rail).getByText(name).closest("li") as HTMLElement
    expect(item("Juan Camilo Ospina")).toHaveTextContent(`1 pedido en ruta · vuelve ${hhmm} · Laureles`)
    expect(item("Ana Ruiz")).toHaveTextContent("En el local")
    expect(item("Duván Mosquera")).toHaveTextContent("De regreso")

    await click(within(item("Duván Mosquera")).getByRole("button", { name: "Volvió" }))
    await waitFor(() => expect(api.returnCourier).toHaveBeenCalledWith("d-2"))
    expect(api.returnCourier).toHaveBeenCalledTimes(1)
  })

  it("+ Nuevo creates a courier with name and phone", async () => {
    renderBoard()
    const rail = await screen.findByRole("region", { name: "Repartidores" })
    await click(within(rail).getByRole("button", { name: "Nuevo repartidor" }))
    const dialog = await screen.findByRole("dialog", { name: "Nuevo repartidor" })
    await click(within(dialog).getByRole("button", { name: "Crear repartidor" }))
    expect(within(dialog).getByText("El nombre es obligatorio")).toBeInTheDocument()
    expect(api.createCourier).not.toHaveBeenCalled()
    fireEvent.change(within(dialog).getByLabelText("Nombre"), { target: { value: "  Luis Pérez " } })
    fireEvent.change(within(dialog).getByLabelText("Teléfono (opcional)"), { target: { value: "315 000 9988" } })
    await click(within(dialog).getByRole("button", { name: "Crear repartidor" }))
    await waitFor(() => expect(api.createCourier).toHaveBeenCalledWith({ name: "  Luis Pérez ", phone: "315 000 9988" }))
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Nuevo repartidor" })).not.toBeInTheDocument())
  })

  it("Activar and Desactivar switch only isActive", async () => {
    api.listCouriers.mockResolvedValue([courier("k-2", "Luis Pérez"), courier("k-3", "Sebastián Gutiérrez", false)])
    renderBoard()
    const rail = await screen.findByRole("region", { name: "Repartidores" })
    await waitFor(() => expect(rail).toHaveTextContent("Sebastián Gutiérrez"))
    await click(within(rail).getByRole("button", { name: "Activar a Sebastián Gutiérrez" }))
    await waitFor(() => expect(api.updateCourier).toHaveBeenCalledWith("k-3", { isActive: true }))
    await click(within(rail).getByRole("button", { name: "Desactivar a Luis Pérez" }))
    await waitFor(() => expect(api.updateCourier).toHaveBeenCalledWith("k-2", { isActive: false }))
  })
})

describe("dispatch dialog (T25)", () => {
  const ready = () => {
    api.listActiveDeliveries.mockResolvedValue([boardRow({ delivery_status: "ready" }, { orderNumber: 412 })])
    api.listCouriers.mockResolvedValue([courier("k-1", "Luis Pérez")])
  }

  async function openDispatch() {
    renderBoard()
    // Below 1200 px the board is status tabs; the order is under "Listo".
    const tab = await screen.findByRole("tab", { name: "Listo 1" })
    // Radix tabs switch on mouse down.
    await act(async () => {
      fireEvent.mouseDown(tab, { button: 0, ctrlKey: false })
    })
    await click(await screen.findByRole("button", { name: "Despachar" }))
    const dialog = await screen.findByRole("dialog", { name: "Despachar #D-0412" })
    await click(await within(dialog).findByRole("radio", { name: /Luis Pérez/ }))
    return dialog
  }

  it("without ETA or location sends the old body", async () => {
    ready()
    const dialog = await openDispatch()
    await click(within(dialog).getByRole("button", { name: "Despachar con Luis" }))
    await waitFor(() => expect(api.setDeliveryStatus).toHaveBeenCalledTimes(1))
    expect(api.setDeliveryStatus.mock.calls[0]![0]).toEqual({ orderId: "d-1", action: "dispatch", courierId: "k-1" })
  })

  it("with ETA and location sends courierEta and the trimmed courierLocation", async () => {
    ready()
    const dialog = await openDispatch()
    const at = new Date(Date.now() + 60 * 60_000)
    const hhmm = `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`
    fireEvent.change(within(dialog).getByLabelText("Vuelve a las (opcional)"), { target: { value: hhmm } })
    fireEvent.change(within(dialog).getByLabelText("Zona o barrio (opcional)"), { target: { value: "  Laureles " } })
    await click(within(dialog).getByRole("button", { name: "Despachar con Luis" }))
    await waitFor(() => expect(api.setDeliveryStatus).toHaveBeenCalledTimes(1))
    const expected = courierEtaAt(hhmm, new Date())
    expect(expected.ok).toBe(true)
    expect(api.setDeliveryStatus.mock.calls[0]![0]).toEqual({
      orderId: "d-1",
      action: "dispatch",
      courierId: "k-1",
      courierEta: expected.ok ? expected.eta : null,
      courierLocation: "Laureles",
    })
  })

  it("refuses an ETA beyond 6 hours without sending", async () => {
    ready()
    const dialog = await openDispatch()
    const past = new Date(Date.now() - 30 * 60_000)
    const hhmm = `${String(past.getHours()).padStart(2, "0")}:${String(past.getMinutes()).padStart(2, "0")}`
    fireEvent.change(within(dialog).getByLabelText("Vuelve a las (opcional)"), { target: { value: hhmm } })
    expect(within(dialog).getByText("Elige una hora dentro de las próximas 6 horas.")).toBeInTheDocument()
    expect(within(dialog).getByRole("button", { name: "Despachar con Luis" })).toBeDisabled()
    expect(api.setDeliveryStatus).not.toHaveBeenCalled()
  })
})
