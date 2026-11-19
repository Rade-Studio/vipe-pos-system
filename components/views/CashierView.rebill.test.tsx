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
const getRegisterPaidOrders = vi.fn(async (_registerId: string): Promise<unknown[]> => [])
vi.mock("@/lib/api/registers", async (orig) => ({
  ...(await orig<any>()),
  getCurrentRegister: () => getCurrentRegister(),
  getRegisterPaidOrders: (registerId: string) => getRegisterPaidOrders(registerId),
}))
const zones = vi.hoisted(() => ({ list: [] as Array<{ id: string; name: string }> }))
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


const halfItems = [{ id: "oi-1", name: "Bandeja paisa", price: 20_000, quantity: 1, comments: null }]
const emit = (row: Record<string, unknown>) =>
  act(() => {
    ;((globalThis as any).__orderCb as (p: unknown) => void)({ eventType: "UPDATE", new: row })
  })
async function addCashLine() {
  fireEvent.click(await screen.findByRole("button", { name: "Efectivo" }))
  fireEvent.click(await screen.findByRole("button", { name: /Usar restante/ }))
  fireEvent.click(screen.getByRole("button", { name: "Agregar línea" }))
}
const bodyAt = (i: number) => payOrder.mock.calls[i][0] as any

describe("payment saved but its reply lost (H-065 / F3)", () => {
  it("shows Pago registrado and the invoice when the order turns paid after a failed submit", async () => {
    renderCashier()
    await openPaymentFor("Mesa 1")
    await addCashLine()
    payOrder.mockImplementationOnce(async () => { throw new PaymentServiceError({ kind: "unknown", message: "Failed to fetch" }) })
    confirmPayment()
    await waitFor(() => expect(payOrder).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(registerButton()).toBeEnabled())
    vi.mocked(toast.success).mockClear()

    // G3: the invoice comes from the server's paid order and its payment.
    getById.mockImplementation(async (id: string) => dbRow({ id, status: "paid", tip: 4_000, tip_percentage: 10, total: 51_600 }))
    listPaymentMethods.mockResolvedValue([
      { id: "pm-cash", code: "cash", name: "Efectivo", kind: "cash" as const, isActive: true, sortOrder: 1 },
      { id: "pm-nequi", code: "nequi", name: "Nequi", kind: "electronic", isActive: true, sortOrder: 2 },
    ] as never)
    listRegisterPayments.mockResolvedValue([
      {
        id: "pay-9", orderId: "o-1", cashRegisterId: "reg-1", cashierProfileId: "cashier-1", amountDue: 47_600, tipAmount: 4_000,
        totalCharged: 51_600, changeGiven: 0, idempotencyKey: "k", createdAt: "2026-10-07T12:30:00.000Z",
        tenders: [{ id: "t-1", paymentId: "pay-9", lineNo: 1, paymentMethodId: "pm-nequi", methodCode: "nequi", methodKind: "electronic", amount: 51_600, cashReceived: null }],
      },
    ] as never)
    emit(dbRow({ status: "paid" }))

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Pago registrado. La orden quedó pagada; se muestra su factura."))
    expect(await screen.findByRole("button", { name: "Cerrar" })).toBeInTheDocument()
    const text = (document.body.textContent ?? "").replace(/\s+/g, " ")
    expect(text).toMatch(/Propina \(10%\):\s*\$ 4\.000/)
    expect(text).toContain("$ 51.600")
    expect(text).toContain("Nequi")
    expect(text).not.toContain("—")
    expect(payOrder).toHaveBeenCalledTimes(1)
    getById.mockImplementation(async (id: string) => dbRow({ id }))
    listRegisterPayments.mockResolvedValue([])
  })

  it("if the paid order cannot be read, shows Pago registrado only, with no invoice (G3)", async () => {
    renderCashier()
    await openPaymentFor("Mesa 1")
    await addCashLine()
    payOrder.mockImplementationOnce(async () => { throw new PaymentServiceError({ kind: "unknown", message: "Failed to fetch" }) })
    confirmPayment()
    await waitFor(() => expect(registerButton()).toBeEnabled())
    vi.mocked(toast.success).mockClear()
    getById.mockImplementationOnce(async () => { throw new Error("offline") })
    emit(dbRow({ status: "paid" }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Pago registrado. La orden quedó pagada."))
    expect(screen.queryByRole("button", { name: "Cerrar" })).not.toBeInTheDocument()
  })

  const twoTables = () => {
    getByStatus.mockResolvedValue([dbRow(), dbRow({ id: "o-2", table_id: "t-2", order_items: halfItems, subtotal: 20_000, tax: 3_800, total: 23_800 })])
    useTableStore.setState({ tables: [{ id: "t-1", number: 1, status: "occupied" }, { id: "t-2", number: 2, status: "occupied" }] as any })
  }

  it("a definitive refusal forgets the attempt: o-1 paid later shows nothing over Mesa 2 (G2)", async () => {
    twoTables()
    renderCashier()
    await openPaymentFor("Mesa 1")
    await addCashLine()
    payOrder.mockImplementationOnce(async () => { throw new PaymentServiceError({ kind: "rejected", message: "Register is closed" }) })
    confirmPayment()
    await waitFor(() => expect(payOrder).toHaveBeenCalledTimes(1))
    fireEvent.click(await queueRow("Mesa 2"))
    await screen.findByText(/Cobrar · Mesa 2/)
    vi.mocked(toast.success).mockClear()
    emit(dbRow({ status: "paid" }))
    await new Promise((r) => setTimeout(r, 50))
    expect(toast.success).not.toHaveBeenCalled()
    expect(screen.queryByRole("button", { name: "Cerrar" })).not.toBeInTheDocument()
    expect(screen.getByText(/Cobrar · Mesa 2/)).toBeInTheDocument()
  })

  it("switching rows forgets an uncertain attempt: o-1 paid later shows nothing (G2)", async () => {
    twoTables()
    renderCashier()
    await openPaymentFor("Mesa 1")
    await addCashLine()
    payOrder.mockImplementationOnce(async () => { throw new PaymentServiceError({ kind: "unknown", message: "Failed to fetch" }) })
    confirmPayment()
    await waitFor(() => expect(payOrder).toHaveBeenCalledTimes(1))
    fireEvent.click(await queueRow("Mesa 2"))
    await screen.findByText(/Cobrar · Mesa 2/)
    vi.mocked(toast.success).mockClear()
    emit(dbRow({ status: "paid" }))
    await new Promise((r) => setTimeout(r, 50))
    expect(toast.success).not.toHaveBeenCalled()
    expect(screen.getByText(/Cobrar · Mesa 2/)).toBeInTheDocument()
  })

  it("an order paid elsewhere without an attempt here still leaves silently (PRESERVE)", async () => {
    renderCashier()
    await openPaymentFor("Mesa 1")
    vi.mocked(toast.success).mockClear()
    emit(dbRow({ status: "paid" }))
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Cobrar orden" })).not.toBeInTheDocument())
    expect(toast.success).not.toHaveBeenCalled()
    expect(screen.queryByRole("button", { name: "Cerrar" })).not.toBeInTheDocument()
  })
})

describe("PROBE re-bill", () => {
  it("P1 realtime items/qty change with a line added: notice, lines dropped, new amount", async () => {
    renderCashier()
    await openPaymentFor("Mesa 1")
    await addCashLine()
    emit(dbRow({ order_items: halfItems, subtotal: 20_000, tax: 3_800, total: 23_800 }))
    await screen.findByText(/La cuenta sin propina cambió de \$\s47\.600 a \$\s23\.800/)
    expect(registerButton()).toBeDisabled()
    await addCashForRemainingAndRegister()
    await waitFor(() => expect(payOrder).toHaveBeenCalledTimes(1))
    expect(bodyAt(0).tenders).toEqual([{ payment_method_id: "pm-cash", amount: 23_800, cash_received: 23_800 }])
  })

  it("P2 realtime unit price change (same qty, same item id)", async () => {
    renderCashier()
    await openPaymentFor("Mesa 1")
    await addCashLine()
    emit(dbRow({ order_items: [{ ...orderItems[0], price: 25_000 }], subtotal: 50_000, tax: 9_500, total: 59_500 }))
    await screen.findByText(/La cuenta sin propina cambió/)
    await addCashForRemainingAndRegister()
    await waitFor(() => expect(payOrder).toHaveBeenCalledTimes(1))
    expect(bodyAt(0).tenders[0].amount).toBe(59_500)
  })

  it("P3 refresh changes tax % only (19 -> 8)", async () => {
    renderCashier()
    await openPaymentFor("Mesa 1")
    await addCashLine()
    getByStatus.mockResolvedValue([dbRow({ tax_percentage: 8, tax: 3_200, total: 43_200 })])
    fireEvent.click(screen.getByRole("button", { name: /Actualizar datos/ }))
    await screen.findByText(/La cuenta sin propina cambió/)
    await addCashForRemainingAndRegister()
    await waitFor(() => expect(payOrder).toHaveBeenCalledTimes(1))
    expect(bodyAt(0).tenders[0].amount).toBe(43_200)
  })

  it("P4 realtime tip % change re-seeds the suggested tip", async () => {
    renderCashier()
    await openPaymentFor("Mesa 1")
    emit(dbRow({ tip_percentage: 10, tip: 4_000 }))
    await waitFor(() => expect(screen.getByRole("button", { name: /Sugerida/ })).toBeInTheDocument())
    fireEvent.click(screen.getByRole("button", { name: /Sugerida/ }))
    await addCashForRemainingAndRegister()
    await waitFor(() => expect(payOrder).toHaveBeenCalledTimes(1))
    expect(bodyAt(0)).toMatchObject({ tip: 4_000, tenders: [{ amount: 51_600, cash_received: 51_600 }] })
  })

  it("P5 status-only realtime UPDATE keeps lines and key (no reset, no notice)", async () => {
    renderCashier()
    await openPaymentFor("Mesa 1")
    await addCashLine()
    emit(dbRow({ status: "kitchen" }))
    expect(screen.queryByText(/La cuenta sin propina cambió/)).not.toBeInTheDocument()
    expect(registerButton()).toBeEnabled()
    confirmPayment()
    await waitFor(() => expect(payOrder).toHaveBeenCalledTimes(1))
    expect(bodyAt(0).tenders[0].amount).toBe(47_600)
  })

  // H-065: after a failed pay_order the cashier can retry the same bill with the same key.
  it("P6 same-bill failure keeps the idempotency key on retry", async () => {
    renderCashier()
    await openPaymentFor("Mesa 1")
    await addCashLine()
    payOrder.mockImplementationOnce(async () => { throw new PaymentServiceError({ kind: "unknown", message: "boom" }) })
    confirmPayment()
    await waitFor(() => expect(payOrder).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(registerButton()).toBeEnabled())
    confirmPayment()
    await waitFor(() => expect(payOrder).toHaveBeenCalledTimes(2))
    expect(bodyAt(1).idempotencyKey).toBe(bodyAt(0).idempotencyKey)
    expect(bodyAt(1).tenders[0].amount).toBe(47_600)
  })

  it("P7 bill changes DURING submit, submit fails: re-seed after, old amount never re-sent, new key", async () => {
    renderCashier()
    await openPaymentFor("Mesa 1")
    await addCashLine()
    let reject!: (e: unknown) => void
    payOrder.mockImplementationOnce(() => new Promise((_r, rj) => { reject = rj }) as any)
    confirmPayment()
    await waitFor(() => expect(payOrder).toHaveBeenCalledTimes(1))
    expect(screen.getByRole("button", { name: /Procesando/ })).toBeDisabled()
    emit(dbRow({ order_items: halfItems, subtotal: 20_000, tax: 3_800, total: 23_800 }))
    // still submitting: no re-seed yet, no second call possible
    expect(screen.getByRole("button", { name: /Procesando/ })).toBeDisabled()
    await act(async () => { reject(new PaymentServiceError({ kind: "rejected", message: "monto no coincide" })) })
    await screen.findByText(/La cuenta sin propina cambió de \$\s47\.600 a \$\s23\.800/)
    expect(registerButton()).toBeDisabled()
    fireEvent.click(registerButton())
    expect(payOrder).toHaveBeenCalledTimes(1)
    await addCashForRemainingAndRegister()
    await waitFor(() => expect(payOrder).toHaveBeenCalledTimes(2))
    expect(bodyAt(1).tenders[0].amount).toBe(23_800)
    expect(bodyAt(1).idempotencyKey).not.toBe(bodyAt(0).idempotencyKey)
  })

  it("P8 bill changes DURING submit, submit succeeds: exactly one call, invoice shown", async () => {
    renderCashier()
    await openPaymentFor("Mesa 1")
    await addCashLine()
    let resolve!: (v: unknown) => void
    payOrder.mockImplementationOnce(() => new Promise((r) => { resolve = r }) as any)
    confirmPayment()
    await waitFor(() => expect(payOrder).toHaveBeenCalledTimes(1))
    emit(dbRow({ order_items: halfItems, subtotal: 20_000, tax: 3_800, total: 23_800 }))
    await act(async () => {
      resolve({ paymentId: "p", status: "paid", amountDue: 47_600, tipAmount: 0, totalCharged: 47_600, changeGiven: 0,
        drawerWarning: false, drawerCashBefore: 0, alreadyPaid: false, tenders: [{ methodCode: "cash", amount: 47_600, cashReceived: 47_600 }] })
    })
    await screen.findByRole("button", { name: "Cerrar" })
    expect(payOrder).toHaveBeenCalledTimes(1)
  })

  it("P9 switching to another table then back starts clean (no notice)", async () => {
    getByStatus.mockResolvedValue([dbRow(), dbRow({ id: "o-2", table_id: "t-2", order_items: halfItems, subtotal: 20_000, tax: 3_800, total: 23_800 })])
    useTableStore.setState({ tables: [{ id: "t-1", number: 1, status: "occupied" }, { id: "t-2", number: 2, status: "occupied" }] as any })
    renderCashier()
    await openPaymentFor("Mesa 1")
    await addCashLine()
    fireEvent.click(await queueRow("Mesa 2"))
    await waitFor(() => expect(screen.getByTestId("payment-remaining")).toHaveTextContent(/23\.800/))
    expect(screen.queryByText(/La cuenta sin propina cambió/)).not.toBeInTheDocument()
    await addCashForRemainingAndRegister()
    await waitFor(() => expect(payOrder).toHaveBeenCalledTimes(1))
    expect(bodyAt(0)).toMatchObject({ orderId: "o-2", tenders: [{ amount: 23_800 }] })
  })
})
