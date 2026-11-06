/**
 * T8 (cargas-por-perfil S1/S2) — the cashier screen's request contract.
 *
 * The screen used to ask Supabase for the same slice three times (once per
 * status), re-fetch on every refresh with a local `isLoading` that swapped the
 * whole "Órdenes" tab for skeletons, re-read the order inside
 * `PaymentMethodDialog` although the card already had it, and loaded the open
 * register once per tab.
 *
 * These tests pin the request counts and the "refresh never blanks the list"
 * contract through the rendered screen (the public interface), not through
 * internal state:
 *
 *   - mount: ONE `getByStatus` call carrying the three statuses,
 *   - opening the payment dialog for a table: NO `getById` re-read,
 *   - after the payment resolves: the list stays mounted while the refetch runs,
 *   - opening "Transacciones": no extra register load, one summary query,
 *   - a realtime status change moves the order between the rendered views.
 *
 * Delivery invariant (odd/tasks/domicilios.md S14) is covered by
 * `lib/cashier/orders.test.ts` and by the panel rendering here: deliveries are
 * charged from DeliveryPaymentsPanel, never as a "Mesa ?".
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { QueryClientProvider } from "@tanstack/react-query"
import { queryClient } from "@/lib/queryClient"
import { CashierView } from "./CashierView"
import { useTableStore } from "@/store/useTableStore"
import { useProfileStore } from "@/store/useProfileStore"
import { useCashRegisterStore } from "@/store/use-cash-register-store"
import type { Profile } from "@/types"

/* ------------------------------------------------------------------ mocks */

const orderItems = [{ id: "oi-1", name: "Bandeja paisa", price: 20_000, quantity: 2, comments: null }]

const dbRow = (over: Record<string, unknown> = {}) => ({
  id: "o-1",
  table_id: "t-1",
  order_type: "dine_in",
  status: "active",
  subtotal: 40_000,
  tax: 7_600,
  tax_percentage: 19,
  tip: 0,
  tip_percentage: 0,
  total: 47_600,
  total_discounts: 0,
  waiter_id: "w-1",
  created_at: "2026-10-07T12:00:00.000Z",
  is_partial_order: false,
  parent_order_id: null,
  order_items: orderItems,
  ...over,
})

type Row = ReturnType<typeof dbRow>

const getByStatus = vi.fn(async (_statuses: string | string[]): Promise<Row[]> => [dbRow()])
const getById = vi.fn(async (id: string) => dbRow({ id }))
const getCurrentRegister = vi.fn(async () => ({
  id: "reg-1",
  status: "open",
  openingTimestamp: new Date("2026-10-07T08:00:00.000Z"),
  initialCash: 50_000,
  finalCash: null,
  closingTimestamp: null,
  transactions: [],
  cashTransactions: [],
}))
const getRegisterSummary = vi.fn(async () => ({
  registersCount: 1,
  initialCash: 50_000,
  paymentsCount: 0,
  totalBilled: 0,
  totalTips: 0,
  totalSales: 0,
  totalChange: 0,
  methods: [],
  cashDeposits: 0,
  cashWithdrawals: 0,
  expectedCash: 50_000,
  tipsPayout: 0,
  expectedCashAfterTips: 50_000,
  legacy: { paymentsCount: 0, total: 0, tips: 0, change: 0, byMethod: {} },
}))
const listRegisterPayments = vi.fn(async () => [])
const listPaymentMethods = vi.fn(async () => [
  { id: "pm-cash", code: "cash", name: "Efectivo", kind: "cash" as const, isActive: true, sortOrder: 1 },
])
const payOrder = vi.fn(async (_input?: unknown) => ({
  paymentId: "pay-1",
  status: "paid" as const,
  amountDue: 47_600,
  tipAmount: 0,
  totalCharged: 47_600,
  changeGiven: 0,
  drawerWarning: false,
  drawerCashBefore: 50_000,
  alreadyPaid: false,
  tenders: [{ methodCode: "cash", amount: 47_600, cashReceived: 47_600 }],
}))
const listActiveDeliveries = vi.fn(async () => [])

// T8b: orders come from the API client. The fixtures stay wire rows; the mock
// answers with the API shape through the same adapter the realtime path uses.
vi.mock("@/lib/api/client", () => {
  return {
    api: {
      GET: async (path: string, init: any) => {
        // Imported lazily: lib/api/orders imports this mocked module.
        const { orderDtoFromWire } = await import("@/lib/api/orders")
        if (path === "/api/orders") {
          const rows = await getByStatus(String(init.params.query.status).split(","))
          return { data: rows.map((row) => orderDtoFromWire(row)) }
        }
        if (path === "/api/orders/{id}") return { data: orderDtoFromWire(await getById(init.params.path.id)) }
        throw new Error(`unexpected GET ${path}`)
      },
    },
    onSessionRefreshed: () => () => {},
  }
})
vi.mock("@/lib/api/registers", () => ({ getCurrentRegister: () => getCurrentRegister() }))
vi.mock("@/lib/api/payments", () => ({
  listPaymentMethods: () => listPaymentMethods(),
  getRegisterSummary: () => getRegisterSummary(),
  listRegisterPayments: () => listRegisterPayments(),
  payOrder: (input: unknown) => payOrder(input),
  splitOrder: async () => ({}),
  undoSplit: async () => ({}),
  closeRegisterRpc: vi.fn(async () => ({ finalCash: 0, summary: null })),
}))
vi.mock("@/lib/api/delivery", () => ({
  listActiveDeliveries: () => listActiveDeliveries(),
}))
vi.mock("@/lib/api/realtime", () => ({
  realtimeService: {
    subscribeToOrders: (cb: (payload: unknown) => void) => {
      ;(globalThis as Record<string, unknown>).__orderCb = cb
      return () => {
        delete (globalThis as Record<string, unknown>).__orderCb
      }
    },
    subscribeToTables: () => () => {},
    subscribeToDeliveries: () => () => {},
  },
}))
vi.mock("@/lib/api/print", () => ({
  sendCommand: vi.fn(),
  sendFactura: vi.fn(),
}))
vi.mock("@/utils/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}))
vi.mock("@/components/layout/Header", () => ({
  Header: ({ title }: { title?: string }) => <h1>{title}</h1>,
}))

import { realtimeService } from "@/lib/api/realtime"
import { toast } from "@/utils/toast"
import { PaymentServiceError } from "@/lib/payments/types"

/* -------------------------------------------------------------- fixtures */

const profile: Profile = { id: "cashier-1", name: "Caja", role: "cashier" }

function renderCashier() {
  return render(
    <QueryClientProvider client={queryClient}>
      <CashierView profile={profile} onChangeProfile={() => {}} authRole="cashier" />
    </QueryClientProvider>,
  )
}

/** The queue row whose visible name starts with `label` ("Mesa 1", "Mesa 1 · Parcial"). */
const queueRow = (label: string) =>
  screen.findByRole("button", { name: new RegExp(`^${label}(\\s|$)`) })

/** The primary action of the payment panel ("Registrar $ X y cerrar"). */
const registerButton = () => screen.getByRole("button", { name: /^Registrar .* y cerrar$/ })

/** Selects the row and waits for the always-visible payment panel to bill it. */
async function openPaymentFor(label = "Mesa 1") {
  fireEvent.click(await queueRow(label))
  await screen.findByRole("heading", { name: "Cobrar orden" })
}

/** Adds one cash line for the whole remaining and registers the payment. */
async function addCashForRemainingAndRegister() {
  fireEvent.click(await screen.findByRole("button", { name: "Efectivo" }))
  fireEvent.click(await screen.findByRole("button", { name: /Usar restante/ }))
  fireEvent.click(screen.getByRole("button", { name: "Agregar línea" }))
  fireEvent.click(registerButton())
}

/** Opens the payment panel for the only row and pays it in full in cash. */
async function payTheOrderInCash() {
  await openPaymentFor("Mesa 1")
  await addCashForRemainingAndRegister()
  fireEvent.click(await screen.findByRole("button", { name: "Cerrar" }))
}

function setOnline(online: boolean) {
  Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => online })
  window.dispatchEvent(new Event(online ? "online" : "offline"))
}

beforeEach(() => {
  queryClient.clear()
  getByStatus.mockReset()
  getById.mockClear()
  getCurrentRegister.mockClear()
  getRegisterSummary.mockClear()
  listRegisterPayments.mockClear()
  listPaymentMethods.mockClear()
  payOrder.mockClear()
  listActiveDeliveries.mockClear()
  getByStatus.mockResolvedValue([dbRow()])
  useTableStore.setState({ tables: [{ id: "t-1", number: 1, status: "occupied" }] })
  useProfileStore.setState({ profiles: [{ id: "w-1", name: "Ana", role: "waiter" }] })
  useCashRegisterStore.setState({ currentRegister: null, registers: [] })
})

afterEach(() => {
  queryClient.clear()
  delete (globalThis as Record<string, unknown>).__orderCb
  setOnline(true)
})

describe("cashier mount (S1: load only what the screen needs)", () => {
  it("reads the three order statuses in ONE call and renders the card", async () => {
    const { container } = renderCashier()

    await screen.findByText("Mesa 1")

    expect(getByStatus).toHaveBeenCalledTimes(1)
    expect(getByStatus).toHaveBeenCalledWith(["active", "kitchen", "delivered"])
    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(0)
  })

  it("shows skeletons on the FIRST load and never afterwards", async () => {
    let releaseFirstLoad: (() => void) | null = null
    getByStatus.mockImplementationOnce(
      () =>
        new Promise<Row[]>((resolve) => {
          releaseFirstLoad = () => resolve([dbRow()])
        }),
    )

    const { container } = renderCashier()
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0)

    // The read is in flight before it is released.
    await waitFor(() => expect(getByStatus).toHaveBeenCalledTimes(1))
    await act(async () => {
      releaseFirstLoad?.()
    })
    await screen.findByText("Mesa 1")
    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(0)
  })

  it("shows skeletons only on the first load, never for a background refresh", async () => {
    const { container } = renderCashier()
    await screen.findByText("Mesa 1")
    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(0)

    // "Actualizar" refetches in place: the card stays, no skeleton is painted.
    fireEvent.click(screen.getByRole("button", { name: /Actualizar datos/ }))
    await waitFor(() => expect(getByStatus).toHaveBeenCalledTimes(2))
    expect(screen.getByText("Mesa 1")).toBeInTheDocument()
    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(0)
  })
})

describe("opening the payment panel (S1: reuse the order the view already loaded)", () => {
  it("does NOT re-read the order", async () => {
    renderCashier()
    await openPaymentFor("Mesa 1")

    expect(getById).not.toHaveBeenCalled()
    // …and the detail still shows the order the row was rendering.
    expect(screen.getByText("Bandeja paisa")).toBeInTheDocument()
  })

  it("bills the order it was reopened for, not the previously opened one", async () => {
    // Order A: 2 x 20 000 + 19 % = 47 600. Order B: 1 x 10 000 + 19 % = 11 900.
    getByStatus.mockResolvedValue([
      dbRow(),
      dbRow({
        id: "o-2",
        table_id: "t-2",
        order_items: [{ id: "oi-2", name: "Limonada", price: 10_000, quantity: 1, comments: null }],
        subtotal: 10_000,
        tax: 1_900,
        total: 11_900,
      }),
    ])
    useTableStore.setState({
      tables: [
        { id: "t-1", number: 1, status: "occupied" },
        { id: "t-2", number: 2, status: "occupied" },
      ],
    })
    renderCashier()
    await screen.findByText("Mesa 2")

    await openPaymentFor("Mesa 1")
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }))
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Cobrar orden" })).not.toBeInTheDocument())

    await openPaymentFor("Mesa 2")
    await addCashForRemainingAndRegister()

    await waitFor(() => expect(payOrder).toHaveBeenCalledTimes(1))
    const input = payOrder.mock.calls[0][0] as { orderId: string; tenders: Array<{ amount: number }> }
    expect(input.orderId).toBe("o-2")
    expect(input.tenders.reduce((sum, t) => sum + t.amount, 0)).toBe(11_900)
  })
})

describe("refresh after a payment (S2: never blanks the screen)", () => {
  it("keeps the list mounted while the post-payment refetch runs", async () => {
    let releaseSecondLoad: (() => void) | null = null
    getByStatus.mockImplementationOnce(async () => [dbRow()])
    getByStatus.mockImplementationOnce(
      () =>
        new Promise<Row[]>((resolve) => {
          releaseSecondLoad = () => resolve([dbRow({ id: "o-1", status: "active" })])
        }),
    )

    const { container } = renderCashier()
    await screen.findByText("Mesa 1")

    await payTheOrderInCash()
    expect(payOrder).toHaveBeenCalledTimes(1)

    // The refetch is in flight: the queue is still there — no skeletons, no
    // unmount, no blank tab.
    await waitFor(() => expect(getByStatus).toHaveBeenCalledTimes(2))
    expect(screen.getByText("Mesa 1")).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: /^Mesas/ })).toBeInTheDocument()
    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(0)

    await act(async () => {
      releaseSecondLoad?.()
    })
    await waitFor(() => expect(screen.getByText("Mesa 1")).toBeInTheDocument())
    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(0)
  })
})

describe("Resumen del turno (S1: no duplicate register load, one summary query)", () => {
  it("adds no register load and no extra summary query when the tab opens", async () => {
    renderCashier()
    await screen.findByText("Mesa 1")

    const registerLoadsAtMount = getCurrentRegister.mock.calls.length
    const summariesAtMount = getRegisterSummary.mock.calls.length
    expect(summariesAtMount).toBe(1)

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Resumen del turno" }), { button: 0, ctrlKey: false })
    await screen.findByText("Transacciones de Venta")

    expect(getCurrentRegister.mock.calls.length).toBe(registerLoadsAtMount)
    expect(getRegisterSummary.mock.calls.length).toBe(summariesAtMount)
    // The payments ledger loads once, for the open register only.
    expect(listRegisterPayments).toHaveBeenCalledTimes(1)
  })
})

describe("realtime status change (S1: moves the order between views)", () => {
  it("drops the card when the order is paid, without a refetch", async () => {
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries")
    renderCashier()
    await screen.findByText("Mesa 1")
    const callsAfterMount = getByStatus.mock.calls.length

    await act(async () => {
      ;(globalThis as unknown as { __orderCb: (p: unknown) => void }).__orderCb({
        eventType: "UPDATE",
        new: { id: "o-1", status: "paid" },
        old: {},
      })
    })

    await waitFor(() => expect(screen.queryByText("Mesa 1")).not.toBeInTheDocument())
    expect(getByStatus.mock.calls.length).toBe(callsAfterMount)
    invalidateSpy.mockRestore()
  })
})

describe("partial orders (pago parcial) still render as their own rows", () => {
  it("lists the split child under Parciales and keeps its actions", async () => {
    getByStatus.mockResolvedValue([
      dbRow(),
      dbRow({
        id: "o-child",
        status: "kitchen",
        subtotal: 20_000,
        tax: 3_800,
        total: 23_800,
        is_partial_order: true,
        parent_order_id: "o-1",
      }),
    ])

    renderCashier()

    // The parent keeps its own table row, and the partial is not merged into it.
    await queueRow("Mesa 1")
    expect(screen.getByRole("tab", { name: /^Parciales\s*1$/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole("tab", { name: /^Parciales/ }))

    await openPaymentFor("Mesa 1 · Parcial")
    expect(screen.getByRole("button", { name: "Eliminar" })).toBeInTheDocument()
    expect(registerButton()).toBeInTheDocument()
    expect(getByStatus).toHaveBeenCalledTimes(1)
  })
})

describe("regression guard", () => {
  it("still charges deliveries from DeliveryPaymentsPanel, never as a table row", async () => {
    listActiveDeliveries.mockResolvedValue([
      {
        delivery: {
          orderId: "d-1",
          customerName: "Ana Pérez",
          status: "out_for_delivery",
          paymentMode: "cash_on_delivery",
          deliveryFee: 3_000,
        },
        subtotal: 40_000,
        tax: 7_600,
        isPaid: false,
      },
    ] as never)

    renderCashier()
    await screen.findByText("Mesa 1")

    // The delivery is not part of the table rows.
    expect(screen.getAllByText(/^Mesa /).map((n) => n.textContent)).toEqual(["Mesa 1"])
    await screen.findByRole("tab", { name: /^Domicilios\s*1$/ })

    fireEvent.click(screen.getByRole("tab", { name: /^Domicilios/ }))
    await screen.findByText("Domicilios por cobrar")
    expect(screen.getByText("DOMICILIO")).toBeInTheDocument()
    expect(screen.getByText("Ana Pérez")).toBeInTheDocument()

    expect(realtimeService.subscribeToOrders).toBeDefined()
  })

  it("charges the delivery from ITS panel, reading the order the panel does not hold", async () => {
    listActiveDeliveries.mockResolvedValue([
      {
        delivery: {
          orderId: "d-1",
          customerName: "Ana Pérez",
          status: "out_for_delivery",
          paymentMode: "cash_on_delivery",
          deliveryFee: 3_000,
        },
        subtotal: 40_000,
        tax: 7_600,
        isPaid: false,
      },
    ] as never)
    getById.mockResolvedValue(dbRow({ id: "d-1", table_id: null, order_type: "delivery" }) as never)

    renderCashier()
    await screen.findByText("Mesa 1")
    fireEvent.click(await screen.findByRole("tab", { name: /^Domicilios\s*1$/ }))
    await screen.findByText("Domicilios por cobrar")

    // The panel has no app `Order` to hand over, so the dialog still reads it.
    fireEvent.click(screen.getByRole("button", { name: "Cobrar" }))
    await screen.findByRole("heading", { name: "Cobrar orden" })
    expect(getById).toHaveBeenCalledTimes(1)
    expect(getById).toHaveBeenCalledWith("d-1")
    // The delivery fee is added to the amount due by the same dialog.
    expect(screen.getAllByText("Domicilio").length).toBeGreaterThanOrEqual(2)
  })
})

describe("payment toasts (T9 PRESERVE: driven by the API result and the error kind)", () => {
  /** Same as `payTheOrderInCash` without closing the invoice (absent on errors). */
  async function submitCashPayment() {
    await openPaymentFor("Mesa 1")
    await addCashForRemainingAndRegister()
    await waitFor(() => expect(payOrder).toHaveBeenCalledTimes(1))
  }

  beforeEach(() => {
    vi.mocked(toast.success).mockClear()
    vi.mocked(toast.error).mockClear()
    vi.mocked(toast.warning).mockClear()
  })

  it("alreadyPaid and drawerWarning keep their toasts", async () => {
    payOrder.mockImplementationOnce(async () => ({
      paymentId: "pay-1",
      status: "already_paid" as never,
      amountDue: 47_600,
      tipAmount: 0,
      totalCharged: 47_600,
      changeGiven: 0,
      drawerWarning: true,
      drawerCashBefore: 0,
      alreadyPaid: true,
      tenders: [{ methodCode: "cash", amount: 47_600, cashReceived: 47_600 }],
    }))
    renderCashier()
    await screen.findByText("Mesa 1")
    await submitCashPayment()

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("Esta orden ya estaba pagada. Mostrando factura."),
    )
    expect(toast.warning).toHaveBeenCalledWith(
      "La caja no tenía efectivo suficiente para el cambio; registra el ingreso de efectivo",
    )
  })

  it.each([
    ["rejected", "Register is closed", "Register is closed"],
    ["invalid-input", "tenders: Too small", "tenders: Too small"],
    ["not-authorized", "permission denied", "No tienes permiso para cobrar"],
    ["unknown", "boom", "Ocurrió un error al procesar el pago. Intenta de nuevo."],
  ] as const)("kind %s toasts %j", async (kind, message, shown) => {
    payOrder.mockImplementationOnce(async () => {
      throw new PaymentServiceError({ kind, message })
    })
    renderCashier()
    await screen.findByText("Mesa 1")
    await submitCashPayment()

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(shown))
    // The server's message (stock, price, closed register…) also stays on the panel.
    expect(await screen.findByRole("alert")).toHaveTextContent(shown)
  })
})

describe("T14 three-panel layout: queue, detail and the always-visible payment panel", () => {
  it("lists each table with its waiter, amount and status, and shows its detail when selected", async () => {
    renderCashier()

    const row = await queueRow("Mesa 1")
    expect(row).toHaveTextContent("Ana")
    expect(row).toHaveTextContent(/47\.600/)
    expect(row).toHaveTextContent("Abierta")
    expect(screen.getByRole("tab", { name: /^Mesas\s*1$/ })).toHaveAttribute("aria-selected", "true")
    // Before a row is chosen the payment panel says what to do.
    expect(screen.getByText("Selecciona una orden para cobrar")).toBeInTheDocument()

    fireEvent.click(row)
    await screen.findByRole("heading", { name: "Cobrar orden" })

    const table = screen.getByRole("table", { name: "Productos de la orden" })
    const line = within(table).getByRole("row", { name: /Bandeja paisa/ })
    expect(line).toHaveTextContent(/2/)
    expect(line).toHaveTextContent(/20\.000/)
    expect(line).toHaveTextContent(/40\.000/)
    expect(screen.getByText("Consumo").nextSibling).toHaveTextContent(/40\.000/)
    expect(screen.getByText("Impuestos 19 %").nextSibling).toHaveTextContent(/7\.600/)
    expect(screen.getByText("Total de la cuenta").nextSibling).toHaveTextContent(/47\.600/)

    // Nothing applied yet: the whole bill is still owed and nothing can be registered.
    expect(screen.getByTestId("payment-remaining")).toHaveTextContent(/47\.600/)
    expect(registerButton()).toHaveAccessibleName(/^Registrar \$\s47\.600 y cerrar$/)
    expect(registerButton()).toBeDisabled()
  })

  it("filters the queue by table, waiter or order number", async () => {
    getByStatus.mockResolvedValue([dbRow(), dbRow({ id: "o-2", table_id: "t-2", waiter_id: "w-2" })])
    useTableStore.setState({
      tables: [
        { id: "t-1", number: 1, status: "occupied" },
        { id: "t-2", number: 2, status: "occupied" },
      ],
    })
    useProfileStore.setState({
      profiles: [
        { id: "w-1", name: "Ana", role: "waiter" },
        { id: "w-2", name: "Luis", role: "waiter" },
      ],
    })
    renderCashier()
    await queueRow("Mesa 2")

    const search = screen.getByRole("searchbox", { name: "Buscar orden" })
    fireEvent.change(search, { target: { value: "luis" } })
    expect(screen.queryByRole("button", { name: /^Mesa 1(\s|$)/ })).not.toBeInTheDocument()
    expect(await queueRow("Mesa 2")).toBeInTheDocument()

    fireEvent.change(search, { target: { value: "mesa 1" } })
    expect(await queueRow("Mesa 1")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /^Mesa 2(\s|$)/ })).not.toBeInTheDocument()

    fireEvent.change(search, { target: { value: "zzz" } })
    expect(screen.getByText("Ninguna orden coincide con la búsqueda")).toBeInTheDocument()
  })

  it("says there is nothing to charge when the queue is empty", async () => {
    getByStatus.mockResolvedValue([])
    renderCashier()

    expect(await screen.findByText("Nada por cobrar")).toBeInTheDocument()
  })

  it("offers quick cash amounts and shows the change to hand back", async () => {
    renderCashier()
    await openPaymentFor("Mesa 1")

    fireEvent.click(await screen.findByRole("button", { name: "Efectivo" }))
    const quick = screen.getByRole("group", { name: "Billetes rápidos" })
    expect(within(quick).getAllByRole("button").map((b) => b.textContent)).toEqual([
      expect.stringMatching(/48\.000/),
      expect.stringMatching(/50\.000/),
      expect.stringMatching(/100\.000/),
    ])

    fireEvent.click(within(quick).getByRole("button", { name: /50\.000/ }))
    fireEvent.click(screen.getByRole("button", { name: "Agregar línea" }))

    expect(screen.getByText("Cambio a entregar").nextSibling).toHaveTextContent(/2\.400/)
    expect(screen.getByTestId("payment-remaining")).toHaveTextContent(/\$\s0/)
    expect(registerButton()).toBeEnabled()

    fireEvent.click(registerButton())
    await waitFor(() => expect(payOrder).toHaveBeenCalledTimes(1))
    const input = payOrder.mock.calls[0][0] as { tenders: Array<{ amount: number; cash_received: number | null }> }
    expect(input.tenders).toEqual([expect.objectContaining({ amount: 47_600, cash_received: 50_000 })])
  })

  it("keeps the order visible but the payment disabled, with the reason, while the register is closed", async () => {
    getCurrentRegister.mockResolvedValueOnce(null as never)
    vi.mocked(toast.error).mockClear()
    renderCashier()

    expect(await screen.findByText("Caja cerrada")).toBeInTheDocument()
    await openPaymentFor("Mesa 1")

    expect(toast.error).not.toHaveBeenCalled()
    expect(screen.getByText(/La caja debe estar abierta para procesar pagos/)).toBeInTheDocument()
    expect(registerButton()).toBeDisabled()
    expect(screen.getByRole("button", { name: "Abrir caja" })).toBeInTheDocument()
  })

  it("pauses the payment while the browser is offline and resumes when it reconnects", async () => {
    renderCashier()
    await openPaymentFor("Mesa 1")
    fireEvent.click(await screen.findByRole("button", { name: "Efectivo" }))
    fireEvent.click(await screen.findByRole("button", { name: /Usar restante/ }))
    fireEvent.click(screen.getByRole("button", { name: "Agregar línea" }))
    expect(registerButton()).toBeEnabled()

    act(() => setOnline(false))
    expect(screen.getByText("Sin conexión: el pago se habilita al reconectar.")).toBeInTheDocument()
    expect(registerButton()).toBeDisabled()
    fireEvent.click(registerButton())
    expect(payOrder).not.toHaveBeenCalled()

    act(() => setOnline(true))
    expect(screen.queryByText("Sin conexión: el pago se habilita al reconectar.")).not.toBeInTheDocument()
    expect(registerButton()).toBeEnabled()
  })
})

describe("re-billing the always-visible panel when the selected order's bill changes", () => {
  const halfRow = () =>
    dbRow({
      order_items: [{ id: "oi-1", name: "Bandeja paisa", price: 20_000, quantity: 1, comments: null }],
      subtotal: 20_000,
      tax: 3_800,
      total: 23_800,
    })

  it("re-bills the panel after Dividir reduces the selected order", async () => {
    renderCashier()
    await openPaymentFor("Mesa 1")
    getByStatus.mockResolvedValue([
      halfRow(),
      dbRow({
        id: "o-child",
        order_items: [{ id: "oi-c", name: "Bandeja paisa", price: 20_000, quantity: 1, comments: null }],
        subtotal: 20_000,
        tax: 3_800,
        total: 23_800,
        is_partial_order: true,
        parent_order_id: "o-1",
      }),
    ])
    fireEvent.click(screen.getByRole("button", { name: /Dividir/ }))
    fireEvent.click(await screen.findByRole("checkbox"))
    fireEvent.click(screen.getByRole("button", { name: "Disminuir" }))
    fireEvent.click(screen.getByRole("button", { name: "Crear Orden Parcial" }))

    await waitFor(() => expect(screen.getByTestId("payment-remaining")).toHaveTextContent(/23\.800/))
    expect(registerButton()).toHaveAccessibleName(/^Registrar \$\s23\.800 y cerrar$/)
    await addCashForRemainingAndRegister()
    await waitFor(() => expect(payOrder).toHaveBeenCalledTimes(1))
    expect((payOrder.mock.calls[0][0] as any).tenders).toEqual([
      { payment_method_id: "pm-cash", amount: 23_800, cash_received: 23_800 },
    ])
  })

  it("re-bills silently after an \"Actualizar datos\" refresh changes the total", async () => {
    renderCashier()
    await openPaymentFor("Mesa 1")
    expect(screen.getByTestId("payment-remaining")).toHaveTextContent(/47\.600/)

    getByStatus.mockResolvedValue([halfRow()])
    fireEvent.click(screen.getByRole("button", { name: /Actualizar datos/ }))

    await waitFor(() => expect(screen.getByTestId("payment-remaining")).toHaveTextContent(/23\.800/))
    expect(screen.queryByText(/La cuenta cambió/)).not.toBeInTheDocument()
  })

  it("resets the lines already added and says so, never sending the old amount", async () => {
    renderCashier()
    await openPaymentFor("Mesa 1")
    fireEvent.click(await screen.findByRole("button", { name: "Efectivo" }))
    fireEvent.click(await screen.findByRole("button", { name: /Usar restante/ }))
    fireEvent.click(screen.getByRole("button", { name: "Agregar línea" }))
    expect(registerButton()).toBeEnabled()

    getByStatus.mockResolvedValue([halfRow()])
    fireEvent.click(screen.getByRole("button", { name: /Actualizar datos/ }))

    const notice = await screen.findByText(/La cuenta cambió/)
    expect(notice).toHaveTextContent(/^La cuenta cambió \(de \$\s47\.600 a \$\s23\.800\); vuelve a registrar los pagos$/)
    expect(screen.getByTestId("payment-remaining")).toHaveTextContent(/23\.800/)
    expect(registerButton()).toBeDisabled()
    fireEvent.click(registerButton())
    expect(payOrder).not.toHaveBeenCalled()

    await addCashForRemainingAndRegister()
    await waitFor(() => expect(payOrder).toHaveBeenCalledTimes(1))
    expect((payOrder.mock.calls[0][0] as any).tenders).toEqual([
      { payment_method_id: "pm-cash", amount: 23_800, cash_received: 23_800 },
    ])
  })

  it("uses a new idempotency key after a re-bill", async () => {
    renderCashier()
    await openPaymentFor("Mesa 1")
    fireEvent.click(await screen.findByRole("button", { name: "Efectivo" }))
    fireEvent.click(await screen.findByRole("button", { name: /Usar restante/ }))
    fireEvent.click(screen.getByRole("button", { name: "Agregar línea" }))
    payOrder.mockImplementationOnce(async () => {
      throw new PaymentServiceError({ kind: "unknown", message: "boom" })
    })
    fireEvent.click(registerButton())
    await waitFor(() => expect(payOrder).toHaveBeenCalledTimes(1))
    const firstKey = (payOrder.mock.calls[0][0] as any).idempotencyKey

    getByStatus.mockResolvedValue([halfRow()])
    fireEvent.click(screen.getByRole("button", { name: /Actualizar datos/ }))
    await screen.findByText(/La cuenta cambió/)
    await addCashForRemainingAndRegister()
    await waitFor(() => expect(payOrder).toHaveBeenCalledTimes(2))
    expect((payOrder.mock.calls[1][0] as any).idempotencyKey).not.toBe(firstKey)
  })
})

describe("pay_order request body parity (T14 PRESERVE: same body as the old dialog)", () => {
  const body = () => payOrder.mock.calls[0][0] as Record<string, unknown>

  it("cash exact", async () => {
    renderCashier()
    await openPaymentFor("Mesa 1")
    await addCashForRemainingAndRegister()
    await waitFor(() => expect(payOrder).toHaveBeenCalledTimes(1))
    expect(body()).toEqual({
      orderId: "o-1",
      cashRegisterId: "reg-1",
      tip: 0,
      tenders: [{ payment_method_id: "pm-cash", amount: 47_600, cash_received: 47_600 }],
      idempotencyKey: expect.any(String),
    })
  })

  it("cash with change", async () => {
    renderCashier()
    await openPaymentFor("Mesa 1")
    fireEvent.click(await screen.findByRole("button", { name: "Efectivo" }))
    fireEvent.change(screen.getByLabelText("Recibido en efectivo"), { target: { value: "100000" } })
    fireEvent.click(screen.getByRole("button", { name: "Agregar línea" }))
    fireEvent.click(registerButton())
    await waitFor(() => expect(payOrder).toHaveBeenCalledTimes(1))
    expect(body()).toEqual({
      orderId: "o-1",
      cashRegisterId: "reg-1",
      tip: 0,
      tenders: [{ payment_method_id: "pm-cash", amount: 47_600, cash_received: 100_000 }],
      idempotencyKey: expect.any(String),
    })
  })

  it("mixed tenders", async () => {
    listPaymentMethods.mockImplementation(async () => [
      { id: "pm-cash", code: "cash", name: "Efectivo", kind: "cash" as const, isActive: true, sortOrder: 1 },
      { id: "pm-card", code: "card", name: "Tarjeta", kind: "electronic" as never, isActive: true, sortOrder: 2 },
    ])
    try {
      renderCashier()
      await openPaymentFor("Mesa 1")
      fireEvent.click(await screen.findByRole("button", { name: "Tarjeta" }))
      fireEvent.change(screen.getByLabelText("Monto"), { target: { value: "30000" } })
      fireEvent.click(screen.getByRole("button", { name: "Agregar línea" }))
      fireEvent.click(screen.getByRole("button", { name: "Efectivo" }))
      fireEvent.change(screen.getByLabelText("Recibido en efectivo"), { target: { value: "20000" } })
      fireEvent.click(screen.getByRole("button", { name: "Agregar línea" }))
      fireEvent.click(registerButton())
      await waitFor(() => expect(payOrder).toHaveBeenCalledTimes(1))
      expect(body().tenders).toEqual([
        { payment_method_id: "pm-card", amount: 30_000, cash_received: null },
        { payment_method_id: "pm-cash", amount: 17_600, cash_received: 20_000 },
      ])
    } finally {
      listPaymentMethods.mockReset()
      listPaymentMethods.mockImplementation(async () => [
        { id: "pm-cash", code: "cash", name: "Efectivo", kind: "cash" as const, isActive: true, sortOrder: 1 },
      ])
    }
  })

  it("suggested tip", async () => {
    getByStatus.mockResolvedValue([dbRow({ tip_percentage: 10, tip: 4_000 })])
    renderCashier()
    await openPaymentFor("Mesa 1")
    fireEvent.click(screen.getByRole("button", { name: /Sugerida/ }))
    expect(registerButton()).toHaveAccessibleName(/^Registrar \$\s51\.600 y cerrar$/)
    await addCashForRemainingAndRegister()
    await waitFor(() => expect(payOrder).toHaveBeenCalledTimes(1))
    expect(body()).toMatchObject({
      tip: 4_000,
      tenders: [{ payment_method_id: "pm-cash", amount: 51_600, cash_received: 51_600 }],
    })
  })

  it("partial child order", async () => {
    getByStatus.mockResolvedValue([
      halfRowParent(),
      dbRow({
        id: "o-child",
        order_items: [{ id: "oi-c", name: "Bandeja paisa", price: 20_000, quantity: 1, comments: null }],
        subtotal: 20_000,
        tax: 3_800,
        total: 23_800,
        is_partial_order: true,
        parent_order_id: "o-1",
      }),
    ])
    renderCashier()
    fireEvent.click(await screen.findByRole("tab", { name: /^Parciales/ }))
    await openPaymentFor("Mesa 1 · Parcial")
    await addCashForRemainingAndRegister()
    await waitFor(() => expect(payOrder).toHaveBeenCalledTimes(1))
    expect(body()).toMatchObject({
      orderId: "o-child",
      tip: 0,
      tenders: [{ payment_method_id: "pm-cash", amount: 23_800, cash_received: 23_800 }],
    })
  })
})

function halfRowParent() {
  return dbRow({
    order_items: [{ id: "oi-1", name: "Bandeja paisa", price: 20_000, quantity: 1, comments: null }],
    subtotal: 20_000,
    tax: 3_800,
    total: 23_800,
  })
}
