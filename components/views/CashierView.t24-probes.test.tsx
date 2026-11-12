import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { QueryClientProvider } from "@tanstack/react-query"
import { queryClient } from "@/lib/queryClient"
import { CashierView } from "./CashierView"
import { useTableStore } from "@/store/useTableStore"
import { useProfileStore } from "@/store/useProfileStore"
import { useCashRegisterStore } from "@/store/use-cash-register-store"

const items = [{ id: "oi-1", name: "Bandeja paisa", price: 20_000, quantity: 2, comments: null }]
const dbRow = (over: Record<string, unknown> = {}) => ({
  id: "o-1", table_id: "t-1", order_type: "dine_in", status: "active", subtotal: 40_000, tax: 7_600,
  tax_percentage: 19, tip: 0, tip_percentage: 0, total: 47_600, total_discounts: 0, waiter_id: "w-1",
  created_at: "2026-10-07T12:00:00.000Z", is_partial_order: false, parent_order_id: null, order_items: items, ...over,
})
const h = vi.hoisted(() => ({
  rows: [] as any[], posts: [] as any[], methods: [] as any[], postImpl: null as null | ((b: any) => any),
}))
const getById = vi.fn(async (id: string) => h.rows.find((r) => r.id === id) ?? dbRow({ id }))
vi.mock("@/lib/api/client", () => ({
  api: {
    GET: async (path: string, init: any) => {
      const { orderDtoFromWire } = await import("@/lib/api/orders")
      if (path === "/api/orders") return { data: h.rows.map((r) => orderDtoFromWire(r)) }
      if (path === "/api/orders/{id}") return { data: orderDtoFromWire(await getById(init.params.path.id)) }
      throw new Error(`unexpected GET ${path}`)
    },
    POST: async (path: string, init: any) => {
      if (path !== "/api/payments") throw new Error(`unexpected POST ${path}`)
      h.posts.push(JSON.parse(JSON.stringify(init.body)))
      if (h.postImpl) return h.postImpl(init.body)
      const total = init.body.tenders.reduce((s: number, t: any) => s + t.amount, 0)
      return { data: { paymentId: "pay-1", status: "paid", amountDue: total - init.body.tipAmount, tipAmount: init.body.tipAmount,
        totalCharged: total, changeGiven: 0, drawerWarning: false, drawerCashBefore: 50_000, alreadyPaid: false,
        tenders: init.body.tenders.map((t: any) => ({ methodCode: t.cashReceived != null ? "cash" : "card", amount: t.amount, cashReceived: t.cashReceived ?? null })) } }
    },
  },
  onSessionRefreshed: () => () => {},
}))
vi.mock("@/lib/api/registers", async (orig) => ({
  ...(await orig<any>()),
  getCurrentRegister: async () => ({ id: "reg-1", status: "open", openingTimestamp: new Date("2026-10-07T08:00:00.000Z"),
    initialCash: 50_000, finalCash: null, closingTimestamp: null, transactions: [], cashTransactions: [], openedBy: { id: "c-1", name: "Laura" } }),
  getRegisterPaidOrders: async () => [],
}))
vi.mock("@/hooks/use-zones", () => ({ useZones: () => ({ data: [] }) }))
vi.mock("@/lib/api/payments", async (orig) => ({
  ...(await orig<any>()),
  listPaymentMethods: async () => h.methods,
  getRegisterSummary: async () => ({ registersCount: 1, initialCash: 50_000, paymentsCount: 0, totalBilled: 0, totalTips: 0, totalSales: 0,
    totalChange: 0, methods: [], cashDeposits: 0, cashWithdrawals: 0, expectedCash: 500_000, tipsPayout: 0, expectedCashAfterTips: 500_000,
    legacy: { paymentsCount: 0, total: 0, tips: 0, change: 0, byMethod: {} } }),
  listRegisterPayments: async () => [],
  splitOrder: async () => ({}), undoSplit: async () => ({}),
}))
vi.mock("@/lib/api/delivery", () => ({ listActiveDeliveries: async () => [] }))
vi.mock("@/lib/api/realtime", () => ({
  realtimeService: {
    subscribeToOrders: (cb: any) => { (globalThis as any).__orderCb = cb; return () => {} },
    subscribeToTables: () => () => {}, subscribeToDeliveries: () => () => {},
    subscribeToConnectionStatus: (cb: any) => { cb(true); return () => {} },
  },
}))
vi.mock("@/lib/api/print", () => ({ sendCommand: vi.fn(), sendFactura: vi.fn() }))
vi.mock("@/utils/toast", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }))
vi.mock("@/components/layout/Header", () => ({ Header: ({ title }: any) => <h1>{title}</h1> }))

const CASH = { id: "pm-cash", code: "cash", name: "Efectivo", kind: "cash", isActive: true, sortOrder: 1 }
const CARD = { id: "pm-card", code: "card", name: "Tarjeta", kind: "electronic", isActive: true, sortOrder: 2 }
const view = () => render(<QueryClientProvider client={queryClient}><CashierView profile={{ id: "c", name: "Caja", role: "cashier" }} onChangeProfile={() => {}} authRole="cashier" /></QueryClientProvider>)
const row = (label: string) => screen.findByRole("button", { name: new RegExp(`^${label}(\\s|$)`) })
async function open(label = "Mesa 1") { fireEvent.click(await row(label)); await screen.findByRole("heading", { name: "Cobrar orden" }) }
const REGISTER = { name: /^Registrar .* y cerrar$/ }
const reg = () => screen.getByRole("button", REGISTER)
/** Awaits the Registrar button (after a send it reads "Procesando…" until the answer is in). */
const findReg = () => screen.findByRole("button", REGISTER)
/** Registrar, then the undo window's "Cerrar ahora": always awaited, never skipped. */
async function confirm() {
  fireEvent.click(await findReg())
  fireEvent.click(await screen.findByRole("button", { name: "Cerrar ahora" }))
}
/**
 * Fake clock driven only by the test (no auto-advance): the 10 s window can
 * never end on its own under load, and "after the window" is an exact jump.
 * Microtasks and React Query's 0 ms timers are flushed by the same advance.
 */
const flush = (ms = 50) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })
async function line(method: string, amount?: string) {
  fireEvent.click(await screen.findByRole("button", { name: method }))
  if (amount === undefined) fireEvent.click(await screen.findByRole("button", { name: /Usar restante/ }))
  else fireEvent.change(screen.getByLabelText(method === "Efectivo" ? "Recibido en efectivo" : "Monto"), { target: { value: amount } })
  fireEvent.click(screen.getByRole("button", { name: "Agregar línea" }))
}
// A cold first render of the real screen can take several seconds under the
// full suite's load; the default 5 s budget is a timing assumption, not a rule.
vi.setConfig({ testTimeout: 60_000 })

// Pins the exact POST /api/payments bodies (the key only by type); verified
// byte-identical to the pre-T24 cashier for these cases (L44).
const dump = (name: string) =>
  expect(h.posts.map((p) => ({ ...p, idempotencyKey: typeof p.idempotencyKey }))).toMatchSnapshot(name)

beforeEach(async () => {
  // A draft kept by a previous test's unmount during a window must not leak in.
  const m = await import("@/lib/cashier/pay-undo"); for (const id of ["o-1", "o-2", "o-child"]) m.takePendingDraft(id, "")
  queryClient.clear(); h.posts = []; h.postImpl = null; h.rows = [dbRow()]; h.methods = [CASH, CARD]
  useTableStore.setState({ tables: [{ id: "t-1", number: 1, status: "occupied" } as any] })
  useProfileStore.setState({ profiles: [{ id: "w-1", name: "Ana", role: "waiter" } as any] })
  useCashRegisterStore.setState({ currentRegister: null, registers: [] } as any)
})
afterEach(() => { vi.useRealTimers(); queryClient.clear() })

describe("parity", () => {
  it("cash exact", async () => { view(); await open(); await line("Efectivo"); await confirm(); await waitFor(() => expect(h.posts).toHaveLength(1)); dump("cash-exact") })
  it("cash change", async () => { view(); await open(); await line("Efectivo", "100000"); await confirm(); await waitFor(() => expect(h.posts).toHaveLength(1)); dump("cash-change") })
  it("mixed", async () => { view(); await open(); await line("Tarjeta", "30000"); await line("Efectivo", "20000"); await confirm(); await waitFor(() => expect(h.posts).toHaveLength(1)); dump("mixed") })
  it("tip", async () => { h.rows = [dbRow({ tip_percentage: 10, tip: 4_000 })]; view(); await open(); fireEvent.click(screen.getByRole("button", { name: /Sugerida/ })); await line("Efectivo"); await confirm(); await waitFor(() => expect(h.posts).toHaveLength(1)); dump("tip") })
  it("partial child", async () => {
    h.rows = [dbRow({ order_items: [{ ...items[0], quantity: 1 }], subtotal: 20_000, tax: 3_800, total: 23_800 }),
      dbRow({ id: "o-child", order_items: [{ id: "oi-c", name: "Bandeja paisa", price: 20_000, quantity: 1, comments: null }], subtotal: 20_000, tax: 3_800, total: 23_800, is_partial_order: true, parent_order_id: "o-1" })]
    view(); fireEvent.click(await screen.findByRole("tab", { name: /^Parciales/ })); await open("Mesa 1 · Parcial"); await line("Efectivo"); await confirm()
    await waitFor(() => expect(h.posts).toHaveLength(1)); dump("child")
  })
})

describe("T24 only", () => {
  it("reference only on the card line, normalised; cash never", async () => {
    view(); await open()
    fireEvent.click(await screen.findByRole("button", { name: "Tarjeta" }))
    fireEvent.change(screen.getByLabelText("Referencia / últimos 4"), { target: { value: " \tAP\t\t4821 " } })
    fireEvent.change(screen.getByLabelText("Monto"), { target: { value: "30000" } })
    fireEvent.click(screen.getByRole("button", { name: "Agregar línea" }))
    // a reference typed on card, then switching to cash: the cash line takes none
    fireEvent.click(screen.getByRole("button", { name: "Tarjeta" }))
    fireEvent.change(screen.getByLabelText("Referencia / últimos 4"), { target: { value: "9999" } })
    fireEvent.click(screen.getByRole("button", { name: "Efectivo" }))
    expect(screen.queryByLabelText("Referencia / últimos 4")).toBeNull()
    fireEvent.change(screen.getByLabelText("Recibido en efectivo"), { target: { value: "20000" } })
    fireEvent.click(screen.getByRole("button", { name: "Agregar línea" }))
    await confirm(); await waitFor(() => expect(h.posts).toHaveLength(1)); dump("ref")
    expect(h.posts[0].tenders).toEqual([
      { paymentMethodId: "pm-card", amount: 30_000, reference: "AP 4821" },
      { paymentMethodId: "pm-cash", amount: 17_600, cashReceived: 20_000 },
    ])
  })
  it("whitespace-only and 61-char references", async () => {
    view(); await open()
    fireEvent.click(await screen.findByRole("button", { name: "Tarjeta" }))
    fireEvent.change(screen.getByLabelText("Referencia / últimos 4"), { target: { value: " \t\n " } })
    fireEvent.change(screen.getByLabelText("Monto"), { target: { value: "10000" } })
    fireEvent.click(screen.getByRole("button", { name: "Agregar línea" }))
    fireEvent.click(screen.getByRole("button", { name: "Tarjeta" }))
    fireEvent.change(screen.getByLabelText("Referencia / últimos 4"), { target: { value: "x".repeat(61) } })
    fireEvent.change(screen.getByLabelText("Monto"), { target: { value: "37600" } })
    fireEvent.click(screen.getByRole("button", { name: "Agregar línea" }))
    await confirm(); await waitFor(() => expect(h.posts).toHaveLength(1)); dump("ref-bounds")
    expect(h.posts[0].tenders[0]).toEqual({ paymentMethodId: "pm-card", amount: 10_000 })
    expect(h.posts[0].tenders[1].reference).toHaveLength(60)
  })
  it("timing: nothing before 10 s, once at 10 s; invoice after", async () => {
    view(); await open(); await line("Efectivo")
    vi.useFakeTimers()
    const b = reg(); fireEvent.click(b); fireEvent.click(b)
    await act(async () => { await vi.advanceTimersByTimeAsync(9_900) })
    expect(h.posts).toHaveLength(0)
    expect(screen.queryByRole("button", { name: "Cerrar" })).toBeNull()
    await act(async () => { await vi.advanceTimersByTimeAsync(200) })
    expect(h.posts).toHaveLength(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000) })
    expect(h.posts).toHaveLength(1)
  })
  it("Deshacer: nothing sent, tenders kept, new key", async () => {
    view(); await open(); await line("Efectivo", "100000")
    vi.useFakeTimers()
    fireEvent.click(reg())
    fireEvent.click(screen.getByRole("button", { name: "Deshacer" }))
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })
    expect(h.posts).toHaveLength(0)
    expect(screen.getByText(/Recibido/)).toBeInTheDocument()
    vi.useRealTimers()
    // first attempt fails (network), retry, undo, retry -> keys
    h.postImpl = () => { throw new TypeError("Failed to fetch") }
    await confirm(); await waitFor(() => expect(h.posts).toHaveLength(1))
    h.postImpl = null
    // After a failed send the confirm stays disabled until the bill or the
    // selection changes (pre-existing rule, L20): nothing is re-sent.
    await waitFor(async () => expect(await findReg()).toBeDisabled())
    expect(h.posts).toHaveLength(1)
  })
  it("switch order during window: nothing sent; kept for same bill only", async () => {
    h.rows = [dbRow(), dbRow({ id: "o-2", table_id: "t-2" })]
    useTableStore.setState({ tables: [{ id: "t-1", number: 1, status: "occupied" }, { id: "t-2", number: 2, status: "occupied" }] as any })
    const keys = vi.spyOn(crypto, "randomUUID")
    view(); await open("Mesa 1"); await line("Efectivo", "100000")
    vi.useFakeTimers()
    fireEvent.click(reg())
    expect(screen.getByRole("button", { name: "Cerrar ahora" })).toBeInTheDocument()
    const seenBeforeSwitch = new Set(keys.mock.results.map((r) => r.value))
    fireEvent.click(screen.getByRole("button", { name: /^Mesa 2(\s|$)/ }))
    await flush()
    expect(screen.getByRole("heading", { name: "Cobrar orden" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Cerrar ahora" })).toBeNull()
    await flush(10_500)
    expect(h.posts).toHaveLength(0)
    vi.useRealTimers()
    await open("Mesa 1")
    expect(await screen.findByText(/Recibido/)).toBeInTheDocument()
    const before = new Set(keys.mock.results.map((r) => r.value))
    await confirm(); await waitFor(() => expect(h.posts).toHaveLength(1))
    expect(h.posts[0].tenders).toEqual([{ paymentMethodId: "pm-cash", amount: 47_600, cashReceived: 100_000 }])
    expect(seenBeforeSwitch.has(h.posts[0].idempotencyKey)).toBe(false)
    expect(before.has(h.posts[0].idempotencyKey)).toBe(true)
    keys.mockRestore()
  })
  it("kept draft dropped when the bill changed while away", async () => {
    h.rows = [dbRow(), dbRow({ id: "o-2", table_id: "t-2" })]
    useTableStore.setState({ tables: [{ id: "t-1", number: 1, status: "occupied" }, { id: "t-2", number: 2, status: "occupied" }] as any })
    view(); await open("Mesa 1"); await line("Efectivo", "100000")
    fireEvent.click(reg()); await open("Mesa 2")
    h.rows = [dbRow({ order_items: [{ ...items[0], quantity: 1 }], subtotal: 20_000, tax: 3_800, total: 23_800 }), dbRow({ id: "o-2", table_id: "t-2" })]
    fireEvent.click(screen.getByRole("button", { name: /Actualizar datos/ }))
    // The refetch has landed when Mesa 1's row shows the new total.
    await waitFor(async () => expect(await row("Mesa 1")).toHaveTextContent(/23\.800/))
    await open("Mesa 1")
    await waitFor(async () => expect(await findReg()).toHaveAccessibleName(/23\.800/))
    expect(screen.queryByText(/Recibido/)).toBeNull()
    expect(h.posts).toHaveLength(0)
  })
  it("bill change during window: nothing sent, banner", async () => {
    view(); await open(); await line("Efectivo", "100000")
    vi.useFakeTimers()
    fireEvent.click(reg())
    expect(screen.getByRole("button", { name: "Cerrar ahora" })).toBeInTheDocument()
    h.rows = [dbRow({ order_items: [{ ...items[0], quantity: 1 }], subtotal: 20_000, tax: 3_800, total: 23_800 })]
    fireEvent.click(screen.getByRole("button", { name: /Actualizar datos/ }))
    await flush()
    expect(screen.getByRole("alert", { name: "Precio cambió" }).textContent).toMatch(/47\.600 a \$\s?23\.800/)
    expect(screen.queryByRole("button", { name: "Cerrar ahora" })).toBeNull()
    await flush(10_500)
    expect(h.posts).toHaveLength(0)
  })
  it("unmount during window: nothing sent", async () => {
    const r = view(); await open(); await line("Efectivo")
    vi.useFakeTimers(); fireEvent.click(reg()); r.unmount()
    await vi.advanceTimersByTimeAsync(15_000)
    expect(h.posts).toHaveLength(0)
  })
  it("pay refused for a changed total: banner with the server figures, re-read, no old amount resent", async () => {
    view(); await open(); await line("Efectivo")
    const { ApiError } = await import("@/lib/api/errors")
    h.postImpl = () => { throw new ApiError(400, "Bad Request", "tenders sum to 47600 but amount_due + tip = 23800", { code: "P0001" }) }
    h.rows = [dbRow({ order_items: [{ ...items[0], quantity: 1 }], subtotal: 20_000, tax: 3_800, total: 23_800 })]
    await confirm(); await waitFor(() => expect(h.posts).toHaveLength(1))
    const alert = await screen.findByRole("alert", { name: "Precio cambió" })
    expect(alert).toBeInTheDocument()
    await waitFor(async () => expect(await findReg()).toHaveAccessibleName(/23\.800/))
    expect(screen.queryByText(/Recibido/)).toBeNull()
    expect(h.posts).toHaveLength(1)
  })
})
