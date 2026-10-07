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

vi.mock("@/lib/supabase/service", () => ({
  orderService: {
    getByStatus: (statuses: string | string[]) => getByStatus(statuses),
    getById: (id: string) => getById(id),
  },
}))
vi.mock("@/lib/supabase/cash-register-service", () => ({
  cashRegisterService: { getCurrentRegister: () => getCurrentRegister() },
  default: { getCurrentRegister: () => getCurrentRegister() },
}))
vi.mock("@/lib/supabase/payments-service", () => ({
  listPaymentMethods: () => listPaymentMethods(),
  getRegisterSummary: () => getRegisterSummary(),
  listRegisterPayments: () => listRegisterPayments(),
  payOrder: (input: unknown) => payOrder(input),
  closeRegisterRpc: vi.fn(async () => ({ finalCash: 0, summary: null })),
}))
vi.mock("@/lib/supabase/delivery-service", () => ({
  listActiveDeliveries: () => listActiveDeliveries(),
}))
vi.mock("@/lib/supabase/client", () => {
  const channel = () => {
    const c: Record<string, unknown> = {}
    c.on = () => c
    c.subscribe = () => c
    c.unsubscribe = () => c
    return c
  }
  return {
    supabase: {
      channel,
      removeChannel: () => {},
      auth: { signOut: vi.fn(async () => ({})) },
      from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: null, error: null }) }) }) }),
    },
  }
})
vi.mock("@/lib/supabase/realtime-service", () => ({
  realtimeService: {
    subscribeToOrders: (cb: (payload: unknown) => void) => {
      ;(globalThis as Record<string, unknown>).__orderCb = cb
      return () => {
        delete (globalThis as Record<string, unknown>).__orderCb
      }
    },
    subscribeToTables: () => () => {},
    sendFactura: vi.fn(),
  },
}))
vi.mock("@/utils/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}))
vi.mock("@/components/layout/Header", () => ({
  Header: ({ title }: { title?: string }) => <h1>{title}</h1>,
}))

import { realtimeService } from "@/lib/supabase/realtime-service"

/* -------------------------------------------------------------- fixtures */

const profile: Profile = { id: "cashier-1", name: "Caja", role: "cashier", hasPassword: false }

function renderCashier() {
  return render(
    <QueryClientProvider client={queryClient}>
      <CashierView profile={profile} onChangeProfile={() => {}} authRole="cashier" />
    </QueryClientProvider>,
  )
}

/** Opens the payment dialog for the only card and pays it in full in cash. */
async function payTheOrderInCash() {
  fireEvent.click(screen.getByRole("button", { name: "Pago Total" }))
  await screen.findByRole("heading", { name: "Cobrar orden" })
  fireEvent.click(await screen.findByRole("button", { name: "Efectivo" }))
  fireEvent.click(await screen.findByRole("button", { name: /Usar restante/ }))
  fireEvent.click(screen.getByRole("button", { name: "Agregar línea" }))
  fireEvent.click(screen.getByRole("button", { name: "Cobrar" }))
  fireEvent.click(await screen.findByRole("button", { name: "Cerrar" }))
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
  useProfileStore.setState({ profiles: [{ id: "w-1", name: "Ana", role: "waiter", hasPassword: false }] })
  useCashRegisterStore.setState({ currentRegister: null, registers: [] })
})

afterEach(() => {
  queryClient.clear()
  delete (globalThis as Record<string, unknown>).__orderCb
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

describe("opening the payment dialog (S1: reuse the order the view already loaded)", () => {
  it("does NOT re-read the order", async () => {
    renderCashier()
    await screen.findByText("Mesa 1")

    fireEvent.click(screen.getByRole("button", { name: "Pago Total" }))
    await screen.findByRole("heading", { name: "Cobrar orden" })

    expect(getById).not.toHaveBeenCalled()
    // …and the dialog still shows the order the card was rendering.
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

    // The "Pago Total" button inside the card that renders the given table label.
    const buttonFor = (tableLabel: string) => {
      let node: HTMLElement | null = screen.getByText(tableLabel)
      while (node && within(node).queryAllByRole("button", { name: "Pago Total" }).length === 0) {
        node = node.parentElement
      }
      const [button] = within(node!).getAllByRole("button", { name: "Pago Total" })
      return button
    }

    fireEvent.click(buttonFor("Mesa 1"))
    await screen.findByRole("heading", { name: "Cobrar orden" })
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }))
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Cobrar orden" })).not.toBeInTheDocument())

    fireEvent.click(buttonFor("Mesa 2"))
    await screen.findByRole("heading", { name: "Cobrar orden" })

    fireEvent.click(await screen.findByRole("button", { name: "Efectivo" }))
    fireEvent.click(await screen.findByRole("button", { name: /Usar restante/ }))
    fireEvent.click(screen.getByRole("button", { name: "Agregar línea" }))
    fireEvent.click(screen.getByRole("button", { name: "Cobrar" }))

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

    // The refetch is in flight: the list (and the panel above it) are still
    // there — no skeletons, no unmount, no blank tab.
    await waitFor(() => expect(getByStatus).toHaveBeenCalledTimes(2))
    expect(screen.getByText("Mesa 1")).toBeInTheDocument()
    expect(screen.getByText("Órdenes Regulares")).toBeInTheDocument()
    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(0)

    await act(async () => {
      releaseSecondLoad?.()
    })
    await waitFor(() => expect(screen.getByText("Mesa 1")).toBeInTheDocument())
    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(0)
  })
})

describe("the Transacciones tab (S1: no duplicate register load, one summary query)", () => {
  it("adds no register load and no extra summary query when the tab opens", async () => {
    renderCashier()
    await screen.findByText("Mesa 1")

    const registerLoadsAtMount = getCurrentRegister.mock.calls.length
    const summariesAtMount = getRegisterSummary.mock.calls.length
    expect(summariesAtMount).toBe(1)

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Transacciones" }), { button: 0, ctrlKey: false })
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

describe("partial orders (pago parcial) still render as their own cards", () => {
  it("lists the split child above the by-table cards and keeps its actions", async () => {
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

    await screen.findByText("Mesa 1 - Orden Parcial")
    // The parent keeps its own card, and the partial is not merged into it.
    expect(screen.getByText("Órdenes Parciales")).toBeInTheDocument()
    expect(screen.getByText("Órdenes Regulares")).toBeInTheDocument()
    expect(screen.getAllByRole("button", { name: "Pago Total" })).toHaveLength(2)
    expect(screen.getByRole("button", { name: "Eliminar" })).toBeInTheDocument()
    expect(getByStatus).toHaveBeenCalledTimes(1)
  })
})

describe("regression guard", () => {
  it("still charges deliveries from DeliveryPaymentsPanel, never as a table card", async () => {
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
    await screen.findByText("Domicilios por cobrar")
    await screen.findByText("Mesa 1")

    expect(screen.getByText("DOMICILIO")).toBeInTheDocument()
    expect(screen.getByText("Ana Pérez")).toBeInTheDocument()
    // The delivery is not part of the by-table cards.
    expect(screen.getAllByText(/^Mesa /).map((n) => n.textContent)).toEqual(["Mesa 1"])

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