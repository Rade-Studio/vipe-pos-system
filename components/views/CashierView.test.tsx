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
import { clockTime } from "@/lib/cashier/queue"
import { menuCategory, menuDish } from "@/lib/order-steps/fixtures"
import { sendCommand } from "@/lib/api/print"

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

/** GET /orders lines carry their option snapshot (F7); the wire adapter leaves it to the next read. */
const withSnapshot = <T extends { items: Array<{ modifiers?: unknown }> }>(dto: T, row: { order_items: unknown[] }) => ({
  ...dto,
  items: dto.items.map((item, i) => {
    const sent = (row.order_items[i] as { modifiers?: unknown } | undefined)?.modifiers
    return sent ? { ...item, modifiers: sent } : item
  }),
})

const ordersIncludes: unknown[] = []
const takeawayApi = vi.hoisted(() => ({
  menuTree: vi.fn(),
  promotionsToday: vi.fn(),
  pricingPreview: vi.fn(),
  createOrder: vi.fn(),
}))
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
  openedBy: { id: "c-1", name: "Laura Gómez" } as { id: string; name: string } | null,
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
          ordersIncludes.push(init.params.query.include)
          const rows = await getByStatus(String(init.params.query.status).split(","))
          const withWaiter = String(init.params.query.include ?? "").split(",").includes("waiter")
          return {
            data: rows.map((row) => ({
              ...withSnapshot(orderDtoFromWire(row)!, row),
              ...(withWaiter && "waiter_name" in row ? { waiterName: (row as any).waiter_name } : {}),
            })),
          }
        }
        if (path === "/api/tables") return { data: [] }
        if (path === "/api/orders/{id}") return { data: orderDtoFromWire(await getById(init.params.path.id)) }
        // S8: the takeaway step flow reads the menu and the takeaway promotions.
        if (path === "/api/catalog/menu/tree") return { data: await takeawayApi.menuTree() }
        if (path === "/api/catalog/promotions/today") return { data: await takeawayApi.promotionsToday(init.params.query) }
        throw new Error(`unexpected GET ${path}`)
      },
      POST: async (path: string, init: any) => {
        if (path === "/api/orders") return { data: await takeawayApi.createOrder(init.body) }
        if (path === "/api/orders/pricing-preview") return { data: await takeawayApi.pricingPreview(init.body) }
        throw new Error(`unexpected POST ${path}`)
      },
    },
    onSessionRefreshed: () => () => {},
  }
})
const getRegisterPaidOrders = vi.fn(async (_registerId: string): Promise<unknown[]> => [])
vi.mock("@/lib/api/registers", async (orig) => ({
  ...(await orig<any>()),
  getCurrentRegister: () => getCurrentRegister(),
  getRegisterPaidOrders: (registerId: string) => getRegisterPaidOrders(registerId),
}))
const zones = vi.hoisted(() => ({ list: [] as Array<{ id: string; name: string; aspect?: number; labels?: unknown[] }> }))
vi.mock("@/hooks/use-zones", () => ({ useZones: () => ({ data: zones.list }) }))
vi.mock("@/lib/api/payments", async (orig) => ({
  ...(await orig<any>()),
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
    subscribeToConnectionStatus: (cb: (connected: boolean) => void) => {
      ;(globalThis as Record<string, unknown>).__statusCb = cb
      cb(true)
      return () => {
        delete (globalThis as Record<string, unknown>).__statusCb
      }
    },
  },
}))
const printing = vi.hoisted(() => ({ enabled: true }))
vi.mock("@/lib/api/printing", () => ({ usePrintingEnabled: () => printing.enabled }))
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

// F3: the step sheet has its own suite (components/voids); here only the target each entry point opens and the refresh after it.
const voidFlow = vi.hoisted(() => ({ last: null as null | { target: any; onDone?: (r: unknown) => void } }))
vi.mock("@/components/voids/VoidFlow", () => ({
  VoidFlow: (props: { target: any; onDone?: (r: unknown) => void; onClose: () => void }) => {
    voidFlow.last = props
    return props.target ? (
      <div role="dialog" aria-label="Hoja de anulación">
        <button type="button" onClick={() => props.onDone?.({ action: props.target.action, orderId: props.target.orderId })}>
          Simular anulación
        </button>
      </div>
    ) : null
  },
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

/**
 * "Registrar $X y cerrar", then "Cerrar ahora": since T24 the payment is sent
 * only when the 10 s undo window ends or the cashier closes it now.
 */
function confirmPayment() {
  fireEvent.click(registerButton())
  fireEvent.click(screen.getByRole("button", { name: "Cerrar ahora" }))
}

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
  confirmPayment()
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
  getRegisterPaidOrders.mockClear()
  zones.list = []
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

describe("Mesas (reservas-mesas T3, S4: the floor map in caja)", () => {
  it("keeps Cobro as the default tab, with its queue", async () => {
    renderCashier()
    await screen.findByText("Mesa 1")
    expect(screen.getByRole("tab", { name: "Cobro" })).toHaveAttribute("aria-selected", "true")
    expect(screen.getByRole("tab", { name: "Plano de mesas" })).toHaveAttribute("aria-selected", "false")
    expect(screen.getByRole("heading", { name: "Caja" })).toBeInTheDocument()
    expect(screen.getByRole("region", { name: "Órdenes por cobrar" })).toBeInTheDocument()
  })

  it("the Mesas tab renders the floor map with the store's tables", async () => {
    useTableStore.setState({
      tables: [{ id: "t-1", number: 1, status: "reserved", reservationName: "Familia López", zoneId: "z-1", x: 0.2, y: 0.3, w: 0.1, h: 0.1 }],
    })
    zones.list = [{ id: "z-1", name: "Salón", aspect: 1.6, labels: [] }]
    renderCashier()
    await screen.findByText("Mesa 1")
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Plano de mesas" }), { button: 0, ctrlKey: false })
    expect(await screen.findByRole("button", { name: /^Mesa 1,.*Familia López/ })).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Plano de mesas" })).toBeInTheDocument()
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

  it("F7: shows each line's options with their price and keeps different options on separate lines", async () => {
    const ched = { groupId: "g-a", groupName: "Adiciones", optionId: "o-ched", name: "Queso cheddar", price: 3000 }
    const medio = { groupId: "g-t", groupName: "Término", optionId: "o-medio", name: "Medio", price: 0 }
    const burger = { name: "Hamburguesa", quantity: 1, comments: null }
    getByStatus.mockResolvedValueOnce([
      dbRow({
        order_items: [
          { ...burger, id: "oi-1", price: 25_000, modifiers: [medio, ched] },
          { ...burger, id: "oi-2", price: 25_000, modifiers: [ched, medio] },
          { ...burger, id: "oi-3", price: 22_000, modifiers: [medio] },
        ],
      }) as unknown as Row,
    ])
    renderCashier()
    fireEvent.click(await queueRow("Mesa 1"))
    const table = await screen.findByRole("table", { name: "Productos de la orden" })
    const lines = within(table).getAllByRole("row", { name: /Hamburguesa/ })
    expect(lines).toHaveLength(2)
    expect(lines[0]).toHaveTextContent(/50\.000/)
    const options = within(lines[0]).getByRole("list", { name: "Opciones" })
    expect(options).toHaveTextContent("Término: Medio")
    expect(options).toHaveTextContent(/\+ Queso cheddar\s*\$\s3\.000/)
    expect(within(lines[1]).getByRole("list", { name: "Opciones" })).not.toHaveTextContent("Queso")
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

    confirmPayment()
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
    expect(screen.queryByText(/La cuenta sin propina cambió/)).not.toBeInTheDocument()
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

    const notice = await screen.findByText(/La cuenta sin propina cambió/)
    expect(notice).toHaveTextContent(/^La cuenta sin propina cambió de \$\s47\.600 a \$\s23\.800; vuelve a registrar los pagos$/)
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
    confirmPayment()
    await waitFor(() => expect(payOrder).toHaveBeenCalledTimes(1))
    const firstKey = (payOrder.mock.calls[0][0] as any).idempotencyKey

    getByStatus.mockResolvedValue([halfRow()])
    fireEvent.click(screen.getByRole("button", { name: /Actualizar datos/ }))
    await screen.findByText(/La cuenta sin propina cambió/)
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
    confirmPayment()
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
      confirmPayment()
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

/* ------------------------------------------------------------------ T24 */

const cardMethods = async () => [
  { id: "pm-cash", code: "cash", name: "Efectivo", kind: "cash" as const, isActive: true, sortOrder: 1 },
  { id: "pm-card", code: "card", name: "Tarjeta", kind: "electronic" as never, isActive: true, sortOrder: 2 },
]
const cashOnly = async () => [
  { id: "pm-cash", code: "cash", name: "Efectivo", kind: "cash" as const, isActive: true, sortOrder: 1 },
]

describe("T24 queue and detail: folio, guests, zone and waiter", () => {
  it("shows them on the queue row and in the detail header", async () => {
    getByStatus.mockResolvedValue([dbRow({ order_number: 128, guests: 4 })])
    useTableStore.setState({ tables: [{ id: "t-1", number: 1, status: "occupied", zoneId: "z-1" }] as never })
    zones.list = [{ id: "z-1", name: "Terraza" }]
    renderCashier()

    const row = await queueRow("Mesa 1")
    expect(row).toHaveTextContent(/#128 · Terraza · Ana · 4 personas · desde/)
    fireEvent.click(row)
    const detail = screen.getByRole("region", { name: "Detalle de la orden" })
    expect(within(detail).getByText("Orden #128 · Terraza")).toBeInTheDocument()
    expect(within(detail).getByText(/^Ana · abierta \d\d:\d\d · 4 personas$/)).toBeInTheDocument()
  })

  it("names the tip for the order's waiter", async () => {
    renderCashier()
    await openPaymentFor("Mesa 1")
    expect(screen.getByRole("heading", { name: "Propina para Ana" })).toBeInTheDocument()
  })
})

describe("T24 top bar: opener and the live pill", () => {
  it("says who opened the register and when", async () => {
    renderCashier()
    const opened = clockTime(new Date("2026-10-07T08:00:00.000Z"))
    expect(await screen.findByText(`Caja abierta por Laura Gómez · ${opened}`)).toBeInTheDocument()
  })

  it("shows En vivo / Sin conexión from the realtime connection status", async () => {
    renderCashier()
    expect(await screen.findByText("En vivo")).toBeInTheDocument()
    act(() => ((globalThis as any).__statusCb as (c: boolean) => void)(false))
    expect(screen.getByText("Sin conexión")).toBeInTheDocument()
    expect(screen.queryByText("En vivo")).not.toBeInTheDocument()
  })
})

describe("T24 tender reference", () => {
  beforeEach(() => listPaymentMethods.mockImplementation(cardMethods))
  afterEach(() => listPaymentMethods.mockImplementation(cashOnly))

  it("is offered on card/transfer lines only and shown on the applied line", async () => {
    renderCashier()
    await openPaymentFor("Mesa 1")
    fireEvent.click(await screen.findByRole("button", { name: "Efectivo" }))
    expect(screen.queryByLabelText("Referencia / últimos 4")).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Tarjeta" }))
    fireEvent.change(screen.getByLabelText("Monto"), { target: { value: "47600" } })
    fireEvent.change(screen.getByLabelText("Referencia / últimos 4"), { target: { value: " 4821\t" } })
    fireEvent.click(screen.getByRole("button", { name: "Agregar línea" }))
    expect(screen.getByText(/Ref\. 4821/)).toBeInTheDocument()

    confirmPayment()
    await waitFor(() => expect(payOrder).toHaveBeenCalledTimes(1))
    expect(payOrder.mock.calls[0][0]).toEqual({
      orderId: "o-1",
      cashRegisterId: "reg-1",
      tip: 0,
      tenders: [{ payment_method_id: "pm-card", amount: 47_600, cash_received: null, reference: "4821" }],
      idempotencyKey: expect.any(String),
    })
  })

  it("sends the pre-T24 body when no reference was typed", async () => {
    renderCashier()
    await openPaymentFor("Mesa 1")
    fireEvent.click(await screen.findByRole("button", { name: "Tarjeta" }))
    fireEvent.change(screen.getByLabelText("Monto"), { target: { value: "47600" } })
    fireEvent.click(screen.getByRole("button", { name: "Agregar línea" }))
    confirmPayment()
    await waitFor(() => expect(payOrder).toHaveBeenCalledTimes(1))
    const tenders = (payOrder.mock.calls[0][0] as any).tenders
    expect(tenders).toEqual([{ payment_method_id: "pm-card", amount: 47_600, cash_received: null }])
    expect(Object.keys(tenders[0])).toEqual(["payment_method_id", "amount", "cash_received"])
  })
})

describe("T24 10-second payment undo (the pay request waits for the window)", () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  async function readyToRegister() {
    const view = renderCashier()
    await openPaymentFor("Mesa 1")
    fireEvent.click(await screen.findByRole("button", { name: "Efectivo" }))
    fireEvent.click(await screen.findByRole("button", { name: /Usar restante/ }))
    fireEvent.click(screen.getByRole("button", { name: "Agregar línea" }))
    vi.useFakeTimers({ shouldAdvanceTime: true })
    return view
  }
  const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms))

  it("sends nothing on Deshacer and returns to the panel with the tenders intact", async () => {
    await readyToRegister()
    fireEvent.click(registerButton())
    expect(screen.getByRole("status", { name: "Cobro pendiente" })).toHaveTextContent(/0:10/)
    advance(3_000)
    expect(screen.getByRole("status", { name: "Cobro pendiente" })).toHaveTextContent(/0:07/)
    fireEvent.click(screen.getByRole("button", { name: /Deshacer/ }))
    advance(20_000)
    expect(payOrder).not.toHaveBeenCalled()
    expect(screen.queryByRole("status", { name: "Cobro pendiente" })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Eliminar línea 1" })).toBeInTheDocument()
    expect(registerButton()).toBeEnabled()
  })

  it("sends once when the window ends", async () => {
    await readyToRegister()
    fireEvent.click(registerButton())
    advance(9_900)
    expect(payOrder).not.toHaveBeenCalled()
    advance(200)
    await waitFor(() => expect(payOrder).toHaveBeenCalledTimes(1))
    advance(20_000)
    expect(payOrder).toHaveBeenCalledTimes(1)
    expect((payOrder.mock.calls[0][0] as any).tenders).toEqual([
      { payment_method_id: "pm-cash", amount: 47_600, cash_received: 47_600 },
    ])
  })

  it("sends once on Cerrar ahora, even double-clicked, and not again when the window would end", async () => {
    await readyToRegister()
    fireEvent.click(registerButton())
    const now = screen.getByRole("button", { name: "Cerrar ahora" })
    fireEvent.click(now)
    fireEvent.click(now)
    await waitFor(() => expect(payOrder).toHaveBeenCalledTimes(1))
    advance(20_000)
    expect(payOrder).toHaveBeenCalledTimes(1)
  })

  it("a double click on Registrar opens one window and sends once", async () => {
    await readyToRegister()
    const button = registerButton()
    fireEvent.click(button)
    fireEvent.click(button)
    advance(10_000)
    await waitFor(() => expect(payOrder).toHaveBeenCalledTimes(1))
    advance(20_000)
    expect(payOrder).toHaveBeenCalledTimes(1)
  })

  it("uses a new idempotency key for the attempt after an undo", async () => {
    const uuid = vi.spyOn(crypto, "randomUUID")
    await readyToRegister()
    fireEvent.click(registerButton())
    const keysBeforeUndo = uuid.mock.results.map((r) => r.value)
    fireEvent.click(screen.getByRole("button", { name: /Deshacer/ }))
    expect(uuid.mock.results).toHaveLength(keysBeforeUndo.length + 1)
    confirmPayment()
    await waitFor(() => expect(payOrder).toHaveBeenCalledTimes(1))
    const sent = (payOrder.mock.calls[0][0] as any).idempotencyKey
    expect(keysBeforeUndo).not.toContain(sent)
    expect(sent).toBe(uuid.mock.results.at(-1)!.value)
    uuid.mockRestore()
  })

  it("switching order during the window sends nothing and keeps the draft", async () => {
    getByStatus.mockResolvedValue([
      dbRow(),
      dbRow({ id: "o-2", table_id: "t-2", subtotal: 20_000, tax: 3_800, total: 23_800,
        order_items: [{ id: "oi-2", name: "Ajiaco", price: 20_000, quantity: 1, comments: null }] }),
    ])
    useTableStore.setState({ tables: [{ id: "t-1", number: 1, status: "occupied" }, { id: "t-2", number: 2, status: "occupied" }] as never })
    await readyToRegister()
    fireEvent.click(registerButton())
    fireEvent.click(await queueRow("Mesa 2"))
    advance(20_000)
    expect(payOrder).not.toHaveBeenCalled()

    fireEvent.click(await queueRow("Mesa 1"))
    await waitFor(() => expect(screen.getByRole("button", { name: "Eliminar línea 1" })).toBeInTheDocument())
    expect(screen.queryByRole("status", { name: "Cobro pendiente" })).not.toBeInTheDocument()
    expect(registerButton()).toBeEnabled()
  })

  it("leaving the screen during the window sends nothing", async () => {
    const view = await readyToRegister()
    fireEvent.click(registerButton())
    expect(screen.getByRole("status", { name: "Cobro pendiente" })).toBeInTheDocument()
    view.unmount()
    advance(20_000)
    expect(payOrder).not.toHaveBeenCalled()

    // Coming back to the same order with the same bill finds the tenders kept.
    renderCashier()
    fireEvent.click(await queueRow("Mesa 1"))
    await waitFor(() => expect(screen.getByRole("button", { name: "Eliminar línea 1" })).toBeInTheDocument())
    expect(registerButton()).toBeEnabled()
  })

  it("a bill change during the window cancels it: nothing sent, the notice asks to re-register", async () => {
    await readyToRegister()
    fireEvent.click(registerButton())
    getByStatus.mockResolvedValue([halfRowParent()])
    fireEvent.click(screen.getByRole("button", { name: /Actualizar datos/ }))
    await screen.findByText(/La cuenta sin propina cambió de \$\s47\.600 a \$\s23\.800/)
    advance(20_000)
    expect(payOrder).not.toHaveBeenCalled()
    expect(screen.queryByRole("status", { name: "Cobro pendiente" })).not.toBeInTheDocument()
  })
})

describe("T24 Precio cambió banner", () => {
  it("shows the design's banner when the bill changes under added tenders, with Entendido", async () => {
    renderCashier()
    await openPaymentFor("Mesa 1")
    fireEvent.click(await screen.findByRole("button", { name: "Efectivo" }))
    fireEvent.click(await screen.findByRole("button", { name: /Usar restante/ }))
    fireEvent.click(screen.getByRole("button", { name: "Agregar línea" }))
    getByStatus.mockResolvedValue([halfRowParent()])
    fireEvent.click(screen.getByRole("button", { name: /Actualizar datos/ }))

    const banner = await screen.findByRole("alert", { name: "Precio cambió" })
    expect(banner).toHaveTextContent("La orden cambió mientras cobrabas.")
    expect(banner).toHaveTextContent(/La cuenta sin propina cambió de \$\s47\.600 a \$\s23\.800/)
    // Over the detail pane, as in the design; never inside the payment panel.
    expect(within(screen.getByRole("region", { name: "Detalle de la orden" })).getByRole("alert", { name: "Precio cambió" })).toBe(banner)
    expect(within(screen.getByRole("region", { name: "Pago" })).queryByRole("alert", { name: "Precio cambió" })).toBeNull()
    fireEvent.click(within(banner).getByRole("button", { name: "Entendido" }))
    expect(screen.queryByRole("alert", { name: "Precio cambió" })).not.toBeInTheDocument()
  })

  it("shows it when pay reports a different total, and refreshes the order", async () => {
    payOrder.mockImplementationOnce(async () => {
      throw new PaymentServiceError({ kind: "rejected", message: "pay_order: tenders sum to 47600 but amount_due + tip = 50000" })
    })
    renderCashier()
    await openPaymentFor("Mesa 1")
    const loads = getByStatus.mock.calls.length
    await addCashForRemainingAndRegister()
    const banner = await screen.findByRole("alert", { name: "Precio cambió" })
    expect(banner).toHaveTextContent(/El total a cobrar \(con propina\) cambió de \$\s47\.600 a \$\s50\.000/)
    expect(within(screen.getByRole("region", { name: "Detalle de la orden" })).getByRole("alert", { name: "Precio cambió" })).toBe(banner)
    await waitFor(() => expect(getByStatus.mock.calls.length).toBeGreaterThan(loads))
    expect(payOrder).toHaveBeenCalledTimes(1)
  })
})

const paidRow = (over: Record<string, unknown> = {}) => ({
  orderId: "o-9",
  orderNumber: 128,
  orderType: "dine_in",
  tableNumber: 12,
  zoneName: "Terraza",
  waiter: { id: "w-1", name: "Ana" },
  paymentId: "p-1",
  amountDue: 40_000,
  tip: 4_000,
  total: 44_000,
  paidAt: new Date(2026, 10, 6, 14, 5),
  tenders: [{ methodCode: "card", methodName: "Tarjeta", methodKind: "electronic", amount: 44_000, reference: "4821" }],
  ...over,
})

describe("T24 Pagadas tab", () => {
  it("lists the register's paid orders newest first", async () => {
    getRegisterPaidOrders.mockResolvedValueOnce([
      paidRow({ paymentId: "p-old", orderNumber: 120, paidAt: new Date(2026, 10, 6, 12, 0) }),
      paidRow(),
    ])
    renderCashier()
    await screen.findByText("Mesa 1")
    await screen.findByText(/Caja abierta por/)
    expect(getRegisterPaidOrders).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("tab", { name: /^Pagadas/ }))

    const list = await screen.findByRole("list", { name: "Cuentas pagadas" })
    const items = within(list).getAllByRole("listitem")
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent("#128")
    expect(items[0]).toHaveTextContent("Mesa 12 · Terraza")
    expect(items[0]).toHaveTextContent(/44\.000/)
    expect(items[0]).toHaveTextContent(/Propina para Ana \$\s4\.000/)
    expect(items[0]).toHaveTextContent("Tarjeta · Ref. 4821")
    expect(items[0]).toHaveTextContent("14:05")
    expect(items[1]).toHaveTextContent("#120")
    expect(getRegisterPaidOrders).toHaveBeenCalledWith("reg-1")
  })

  it("says so when no register is open, without a request", async () => {
    getCurrentRegister.mockResolvedValueOnce(null as never)
    renderCashier()
    await screen.findByText("Caja cerrada")
    fireEvent.click(screen.getByRole("tab", { name: /^Pagadas/ }))
    expect(await screen.findByText("Abre la caja para ver las cuentas pagadas del turno.")).toBeInTheDocument()
    expect(getRegisterPaidOrders).not.toHaveBeenCalled()
  })
})

describe("T24 shift summary sheet", () => {
  it("shows the shift KPIs from the register summary", async () => {
    getRegisterSummary.mockResolvedValue({
      registersCount: 1,
      initialCash: 50_000,
      paymentsCount: 3,
      totalBilled: 100_000,
      totalTips: 9_000,
      totalSales: 109_000,
      totalChange: 0,
      methods: [
        { paymentMethodId: "pm-cash", code: "cash", name: "Efectivo", kind: "cash", sortOrder: 1, isActive: true, total: 60_000, tendersCount: 2 },
        { paymentMethodId: "pm-card", code: "card", name: "Tarjeta", kind: "electronic", sortOrder: 2, isActive: true, total: 49_000, tendersCount: 1 },
      ] as never,
      cashDeposits: 0,
      cashWithdrawals: 0,
      expectedCash: 110_000,
      tipsPayout: 9_000,
      expectedCashAfterTips: 101_000,
      legacy: { paymentsCount: 0, total: 0, tips: 0, change: 0, byMethod: {} },
    })
    listActiveDeliveries.mockResolvedValue([])
    try {
      renderCashier()
      await screen.findByText(/Caja abierta por/)
      fireEvent.click(screen.getByRole("button", { name: "Cifras del turno" }))
      const sheet = await screen.findByRole("dialog", { name: "Resumen del turno" })
      const kpi = (label: string) => within(sheet).getByText(label).parentElement!
      await waitFor(() => expect(kpi("Ventas")).toHaveTextContent(/100\.000/))
      expect(kpi("Propinas")).toHaveTextContent(/9\.000/)
      expect(kpi("Tickets")).toHaveTextContent("3")
      expect(kpi("Ticket promedio")).toHaveTextContent(/33\.333/)
      expect(kpi("Efectivo esperado")).toHaveTextContent(/110\.000/)
      expect(within(sheet).getByText("Laura Gómez · 3 cuentas pagadas · 1 por cobrar")).toBeInTheDocument()
      const methods = within(sheet).getByRole("list", { name: "Ventas por método" })
      expect(within(methods).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
        expect.stringMatching(/Efectivo.*60\.000/),
        expect.stringMatching(/Tarjeta.*49\.000/),
      ])
    } finally {
      getRegisterSummary.mockReset()
      getRegisterSummary.mockImplementation(async () => ({
        registersCount: 1, initialCash: 50_000, paymentsCount: 0, totalBilled: 0, totalTips: 0, totalSales: 0,
        totalChange: 0, methods: [], cashDeposits: 0, cashWithdrawals: 0, expectedCash: 50_000, tipsPayout: 0,
        expectedCashAfterTips: 50_000, legacy: { paymentsCount: 0, total: 0, tips: 0, change: 0, byMethod: {} },
      }))
    }
  })
})

describe("T24 review fixes", () => {
  it("phone: the Precio cambió banner sits at the top of the current step, outside the hidden panes", async () => {
    const width = window.innerWidth
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 })
    try {
      renderCashier()
      await openPaymentFor("Mesa 1")
      fireEvent.click(await screen.findByRole("button", { name: "Efectivo" }))
      fireEvent.click(await screen.findByRole("button", { name: /Usar restante/ }))
      fireEvent.click(screen.getByRole("button", { name: "Agregar línea" }))
      getByStatus.mockResolvedValue([halfRowParent()])
      fireEvent.click(screen.getByRole("button", { name: /Actualizar datos/ }))
      const banner = await screen.findByRole("alert", { name: "Precio cambió" })
      expect(screen.getByRole("region", { name: "Detalle de la orden" })).not.toContainElement(banner)
      expect(screen.getByRole("region", { name: "Pago" })).not.toContainElement(banner)
      expect(screen.getAllByRole("alert", { name: "Precio cambió" })).toHaveLength(1)
      // Still never the old amount.
      expect(registerButton()).toBeDisabled()
    } finally {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: width })
    }
  })

  it("names the waiter from include=waiter, falling back to the profile store", async () => {
    getByStatus.mockResolvedValue([
      dbRow({ waiter_name: "Carlos Pérez" }),
      dbRow({ id: "o-2", table_id: "t-2" }),
    ])
    useTableStore.setState({ tables: [{ id: "t-1", number: 1, status: "occupied" }, { id: "t-2", number: 2, status: "occupied" }] as never })
    ordersIncludes.length = 0
    renderCashier()
    expect(await queueRow("Mesa 1")).toHaveTextContent("Carlos Pérez")
    expect(await queueRow("Mesa 2")).toHaveTextContent("Ana")
    expect(ordersIncludes[0]).toBe("waiter")
    await openPaymentFor("Mesa 1")
    expect(screen.getByRole("heading", { name: "Propina para Carlos Pérez" })).toBeInTheDocument()
    expect(within(screen.getByRole("region", { name: "Detalle de la orden" })).getByText(/^Carlos Pérez · abierta/)).toBeInTheDocument()
  })

  it("shift sheet: arqueo de efectivo with a live difference, nothing saved, and Ir al cierre de caja", async () => {
    getRegisterSummary.mockResolvedValue({
      registersCount: 1, initialCash: 50_000, paymentsCount: 3, totalBilled: 100_000, totalTips: 9_000, totalSales: 109_000,
      totalChange: 0,
      methods: [
        { paymentMethodId: "pm-cash", code: "cash", name: "Efectivo", kind: "cash", sortOrder: 1, isActive: true, total: 55_000, tendersCount: 2 },
        { paymentMethodId: "pm-card", code: "card", name: "Tarjeta", kind: "electronic", sortOrder: 2, isActive: true, total: 54_000, tendersCount: 1 },
      ] as never,
      cashDeposits: 10_000, cashWithdrawals: 5_000, expectedCash: 110_000, tipsPayout: 9_000,
      expectedCashAfterTips: 101_000, legacy: { paymentsCount: 0, total: 0, tips: 0, change: 0, byMethod: {} },
    })
    try {
      renderCashier()
      await screen.findByText(/Caja abierta por/)
      fireEvent.click(screen.getByRole("button", { name: "Cifras del turno" }))
      const sheet = await screen.findByRole("dialog", { name: "Resumen del turno" })
      const arqueo = await within(sheet).findByRole("region", { name: "Arqueo de efectivo" })
      const stat = (label: string) => within(arqueo).getByText(label).parentElement!
      expect(stat("Base inicial")).toHaveTextContent(/50\.000/)
      expect(stat("Ingresos / retiros")).toHaveTextContent(/\+\$\s10\.000 \/ −\$\s5\.000/)
      expect(stat("Propinas a meseros")).toHaveTextContent(/−\$\s9\.000/)
      expect(stat("Esperado después de propinas")).toHaveTextContent(/101\.000/)
      expect(stat("Ventas en efectivo")).toHaveTextContent(/55\.000/)
      // The visible rows add up to the shown total: 50.000 + 55.000 + 10.000 − 5.000 − 9.000 = 101.000.
      const pesos = (label: string) =>
        [...stat(label).textContent!.matchAll(/([+−-]?)\$\s([\d.]+)/g)].map(([, sign, n]) => (sign === "−" || sign === "-" ? -1 : 1) * Number(n.replace(/\./g, "")))
      const sum = ["Base inicial", "Ventas en efectivo", "Ingresos / retiros", "Propinas a meseros"].flatMap(pesos).reduce((a, b) => a + b, 0)
      expect(sum).toBe(pesos("Esperado después de propinas")[0])

      const counted = within(arqueo).getByLabelText("Efectivo contado")
      fireEvent.change(counted, { target: { value: "100000" } })
      expect(within(arqueo).getByRole("status")).toHaveTextContent(/Falta \$\s1\.000/)
      fireEvent.change(counted, { target: { value: "102500" } })
      expect(within(arqueo).getByRole("status")).toHaveTextContent(/Sobra \$\s1\.500/)
      fireEvent.change(counted, { target: { value: "101000" } })
      expect(within(arqueo).getByRole("status")).toHaveTextContent("Cuadra")

      fireEvent.click(within(sheet).getByRole("button", { name: "Ir al cierre de caja" }))
      expect(await screen.findByRole("dialog", { name: "Cierre de turno" })).toBeInTheDocument()
      const { closeRegisterRpc } = (await import("@/lib/api/payments")) as any
      expect(closeRegisterRpc).not.toHaveBeenCalled()
    } finally {
      getRegisterSummary.mockReset()
      getRegisterSummary.mockImplementation(async () => ({
        registersCount: 1, initialCash: 50_000, paymentsCount: 0, totalBilled: 0, totalTips: 0, totalSales: 0,
        totalChange: 0, methods: [], cashDeposits: 0, cashWithdrawals: 0, expectedCash: 50_000, tipsPayout: 0,
        expectedCashAfterTips: 50_000, legacy: { paymentsCount: 0, total: 0, tips: 0, change: 0, byMethod: {} },
      }))
    }
  })
})

describe("queue tabs keep one layout (S6: no tab row shift on selection or scroll)", () => {
  it("renders the same tab row whichever tab is selected, inside scrollers that reserve the scrollbar gutter", async () => {
    getByStatus.mockResolvedValue([])
    const { container } = renderCashier()
    const tablist = await screen.findByRole("tablist", { name: "Tipo de orden" })
    const layout = () => ({
      row: tablist.className,
      tabs: within(tablist)
        .getAllByRole("tab")
        .map((tab) => tab.className.replace(/bg-surface text-fg shadow-sm|text-muted-fg hover:text-fg/, "STATE")),
    })
    const initial = layout()
    for (const name of [/^Domicilios/, /^Parciales/, /^Pagadas/, /^Mesas/]) {
      fireEvent.click(within(tablist).getByRole("tab", { name }))
      expect(layout()).toEqual(initial)
    }
    // A scrollbar that appears only on a long list would narrow the row: every
    // scroller around it keeps the gutter reserved.
    expect(screen.getByRole("region", { name: "Órdenes por cobrar" }).className).toContain("[scrollbar-gutter:stable]")
    expect((container.firstElementChild as HTMLElement).className).toMatch(/overflow-y-auto.*\[scrollbar-gutter:stable\]/)
  })
})

describe("F3 cashier voids", () => {
  it("'Cancelar orden' opens the sheet for the charged order with its lines and total", async () => {
    getByStatus.mockResolvedValue([dbRow({ order_number: 128 })])
    renderCashier()
    fireEvent.click(await queueRow("Mesa 1"))
    fireEvent.click(await screen.findByRole("button", { name: "Cancelar orden" }))
    expect(voidFlow.last?.target).toEqual({
      action: "order",
      orderId: "o-1",
      label: "#128 · Mesa 1",
      lines: [{ id: "oi-1", name: "Bandeja paisa", price: 20_000, quantity: 2, comments: undefined }],
      total: 47_600,
    })
    const reads = getByStatus.mock.calls.length
    fireEvent.click(screen.getByRole("button", { name: "Simular anulación" }))
    await waitFor(() => expect(getByStatus.mock.calls.length).toBeGreaterThan(reads))
  })

  it("'Anular plato' opens the item sheet on the same order", async () => {
    renderCashier()
    fireEvent.click(await queueRow("Mesa 1"))
    fireEvent.click(await screen.findByRole("button", { name: "Anular plato" }))
    expect(voidFlow.last?.target).toMatchObject({ action: "item", orderId: "o-1", label: "Mesa 1" })
    expect(voidFlow.last?.target.lines.map((l: { id: string }) => l.id)).toEqual(["oi-1"])
  })

  it("Pagadas: 'Anular' opens the payment sheet; the voided payment leaves the list", async () => {
    getRegisterPaidOrders.mockResolvedValueOnce([paidRow()]).mockResolvedValueOnce([])
    renderCashier()
    await screen.findByText(/Caja abierta por/)
    fireEvent.click(screen.getByRole("tab", { name: /^Pagadas/ }))
    fireEvent.click(await screen.findByRole("button", { name: "Anular pago #128 Mesa 12 · Terraza" }))
    expect(voidFlow.last?.target).toEqual({
      action: "payment",
      orderId: "o-9",
      label: "#128 · Mesa 12 · Terraza",
      payments: [{ id: "p-1", title: "Tarjeta · Ref. 4821", detail: "14:05", amount: 44_000 }],
      paymentId: "p-1",
    })
    const reads = getByStatus.mock.calls.length
    fireEvent.click(screen.getByRole("button", { name: "Simular anulación" }))
    expect(await screen.findByText("Aún no hay cuentas pagadas")).toBeInTheDocument()
    expect(getRegisterPaidOrders).toHaveBeenCalledTimes(2)
    await waitFor(() => expect(getByStatus.mock.calls.length).toBeGreaterThan(reads))
  })

  it("keeps Dividir and Reimprimir in the detail (PRESERVE)", async () => {
    renderCashier()
    fireEvent.click(await queueRow("Mesa 1"))
    expect(await screen.findByRole("button", { name: "Dividir" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Reimprimir" })).toBeInTheDocument()
  })

  it("shows the invoice instead of reprinting when the restaurant does not use printers (F6, S2)", async () => {
    printing.enabled = false
    try {
      renderCashier()
      fireEvent.click(await queueRow("Mesa 1"))
      expect(await screen.findByRole("button", { name: "Ver factura" })).toBeInTheDocument()
      expect(screen.queryByRole("button", { name: "Reimprimir" })).not.toBeInTheDocument()
    } finally {
      printing.enabled = true
    }
  })
})

describe("Para llevar (S8)", () => {
  const ARROZ = "44444444-4444-4444-8444-444444444444"
  beforeEach(() => {
    takeawayApi.menuTree.mockResolvedValue({
      categories: [menuCategory({ id: "cat-2", name: "Postres", dishes: [menuDish({ id: ARROZ, name: "Arroz con leche", price: 7000 })] })],
    })
    takeawayApi.promotionsToday.mockRejectedValue(new Error("no promotions"))
    takeawayApi.pricingPreview.mockRejectedValue(new Error("no preview"))
    takeawayApi.createOrder.mockReset()
    vi.mocked(sendCommand).mockClear()
  })

  it("lists takeaway orders under Para llevar, labelled with the customer, and charges them like a table", async () => {
    getByStatus.mockResolvedValue([
      dbRow(),
      dbRow({ id: "o-take", table_id: null, order_type: "takeaway", customer_name: "Ana María", subtotal: 6_000, tax: 1_140, total: 7_140 }),
    ])
    renderCashier()
    await queueRow("Mesa 1")
    expect(screen.queryByRole("button", { name: /^Para llevar · Ana María/ })).toBeNull()
    expect(screen.getByRole("tab", { name: /^Para llevar\s*1$/ })).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: /^Mesas\s*1$/ })).toBeInTheDocument()

    fireEvent.click(screen.getByRole("tab", { name: /^Para llevar/ }))
    fireEvent.click(await queueRow("Para llevar · Ana María"))
    expect(await screen.findByText("Cobrar · Para llevar · Ana María")).toBeInTheDocument()
    expect(registerButton()).toBeInTheDocument()
  })

  it("Nuevo para llevar asks the name and sends the order on channel takeaway with no table", async () => {
    takeawayApi.createOrder.mockImplementation(async (body: Record<string, unknown>) => ({
      ...(await import("@/lib/api/orders")).orderDtoFromWire(dbRow({ id: "o-new", table_id: null, order_type: "takeaway", customer_name: "Luis" })),
      ...body,
    }))
    renderCashier()
    await queueRow("Mesa 1")

    fireEvent.click(screen.getByRole("button", { name: "Nuevo para llevar" }))
    const dialog = await screen.findByRole("dialog", { name: "Pedido para llevar" })
    fireEvent.click(within(dialog).getByRole("button", { name: "Tomar pedido" }))
    expect(within(dialog).getByText("El nombre debe tener entre 2 y 60 caracteres")).toBeInTheDocument()
    fireEvent.change(within(dialog).getByLabelText(/Teléfono/), { target: { value: "12" } })
    fireEvent.change(within(dialog).getByLabelText("Nombre del cliente"), { target: { value: "Luis" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Tomar pedido" }))
    expect(within(dialog).getByText("El teléfono debe tener entre 7 y 15 dígitos")).toBeInTheDocument()
    fireEvent.change(within(dialog).getByLabelText(/Teléfono/), { target: { value: "" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Tomar pedido" }))

    expect(await screen.findByRole("heading", { name: "¿Qué categoría?" })).toBeInTheDocument()
    expect(takeawayApi.promotionsToday).toHaveBeenCalledWith({ channel: "takeaway" })
    fireEvent.click(await screen.findByRole("button", { name: /Postres/ }))
    fireEvent.click(await screen.findByRole("button", { name: /^Arroz con leche,/ }))
    fireEvent.click(await screen.findByRole("button", { name: /^Agregar 1 ·/ }))
    await waitFor(() => expect(takeawayApi.pricingPreview).toHaveBeenCalledWith(expect.objectContaining({ channel: "takeaway" })))
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Enviar a cocina (1)" }))
    })

    await waitFor(() => expect(takeawayApi.createOrder).toHaveBeenCalledTimes(1))
    expect(takeawayApi.createOrder).toHaveBeenCalledWith({
      orderType: "takeaway",
      customerName: "Luis",
      items: [{ dishId: ARROZ, quantity: 1, unitPrice: 7000, comments: null }],
    })
    expect(sendCommand).toHaveBeenCalledWith({ orderId: "o-new", items: [expect.objectContaining({ name: "Arroz con leche" })] })
    await waitFor(() => expect(screen.queryByRole("heading", { name: "¿Qué categoría?" })).toBeNull())
    expect(screen.getByRole("tab", { name: /^Para llevar/ })).toHaveAttribute("aria-selected", "true")
    // The queue is read again so the new order shows up.
    await waitFor(() => expect(getByStatus).toHaveBeenCalledTimes(2))
  })
})
