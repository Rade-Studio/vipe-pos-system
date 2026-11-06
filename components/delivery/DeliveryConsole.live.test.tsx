import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { menuCategory, menuDish } from "@/lib/order-steps/fixtures"

/**
 * T25 — the console's live behaviour through the real API client (only
 * `fetch` is routed): live signal and lost-connection banner, the register
 * re-read (60 s and focus), late tones on the state clock, the closed-today
 * line and the courier controls per role. Regression of the verifier's probes.
 */

const env = vi.hoisted(() => ({
  current: [] as Array<{ method: string; url: string; body: string }>,
  customer: null as unknown,
  rows: [] as unknown[],
  couriers: [] as unknown[],
}))

vi.mock("@/lib/api/catalog", () => ({
  getMenuTree: async () => ({
    categories: [menuCategory({ id: "c-2", name: "Bebidas", dishes: [menuDish({ id: "d-3", name: "Limonada", price: 5000, allowComments: false })] })],
    uncategorized: [],
  }),
  fetchDishes: async () => [],
  fetchCategories: async () => [],
}))
vi.mock("@/lib/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/client")>("@/lib/api/client")
  return { ...actual, api: actual.createApiClient({ baseUrl: "http://test.local", fetch: (r: Request) => (globalThis as unknown as { __route: (r: Request) => Promise<Response> }).__route(r) }) }
})
vi.mock("@/hooks/use-toast", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() }, useToast: () => ({ toast: vi.fn() }) }))
const rt = vi.hoisted(() => ({ isConnected: false, handlers: [] as Array<(p: unknown) => void>, subscribeToDeliveries(h: (p: unknown) => void) { rt.handlers.push(h); return () => {} }, subscribeToZones: () => () => {} }))
vi.mock("@/lib/api/realtime", () => ({ realtimeService: rt }))

import { DeliveryBoard } from "@/components/delivery/DeliveryBoard"

const now = new Date().toISOString()
const dto = (o: Record<string, unknown> = {}) => ({
  orderId: "11111111-1111-1111-1111-111111111111", orderNumber: 412, customerId: "c-1", customerName: "Ana", customerPhone: "3101234567",
  addressLine: "Calle 5", neighborhood: null, addressReference: null, deliveryFee: 3000, paymentMode: "cash_on_delivery",
  cashChangeFor: null, courierId: null, status: "ready", failureReason: null, notes: null, dispatchedAt: null, deliveredAt: null,
  failedAt: null, cancelledAt: null, createdAt: now, updatedAt: now, prepaidMethod: null, courierEta: null, courierLocation: null,
  returnedAt: null, ...o,
})
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

async function route(req: Request): Promise<Response> {
  const u = new URL(req.url)
  const body = req.method === "GET" ? "" : await req.clone().text()
  env.current.push({ method: req.method, url: u.pathname + u.search, body })
  const p = u.pathname
  if (p === "/api/delivery/customers") return env.customer ? json(env.customer) : json({ statusCode: 404, message: "Customer not found" }, 404)
  if (p === "/api/payments/methods") return json([
    { id: "m-cash", code: "cash", name: "Efectivo", kind: "cash", isActive: true, sortOrder: 0 },
    { id: "m-nequi", code: "nequi", name: "Nequi", kind: "electronic", isActive: true, sortOrder: 1 },
  ])
  if (p === "/api/delivery/orders") return json({ orderId: "o-1", customerId: "c-1", addressId: null, delivery: dto(), consumption: { shortages: [] } })
  if (p === "/api/delivery/active") return json(env.rows)
  if (p === "/api/delivery/couriers" && req.method === "GET") return json(env.couriers)
  if (p === "/api/delivery/couriers") return json({ id: "k-9", name: "Nuevo", phone: null, isActive: true, createdAt: now, updatedAt: now })
  if (p.startsWith("/api/delivery/couriers/")) return json({ id: "k-2", name: "Beto", phone: null, isActive: true, createdAt: now, updatedAt: now })
  if (p === "/api/config") return json({ deliveryDefaultFee: 5000, deliveryLateMinutes: 10, kitchenLateMinutes: 25, taxPercentage: 0 })
  if (p === "/api/registers/current") return json(null)
  if (p === "/api/delivery/closed-today") return json({ deliveredCount: 3, cancelledCount: 1, failedCount: 2, averageDeliveryMinutes: 27 })
  if (p.endsWith("/status")) return json(dto({ status: "out_for_delivery", courierId: "k-1", dispatchedAt: now }))
  if (p.endsWith("/return")) return json(dto({ status: "delivered", courierId: "k-1", returnedAt: now }))
  return json({ message: `unrouted ${p}` }, 500)
}


beforeEach(() => {
  env.current = []
  rt.isConnected = false
  rt.handlers.length = 0
  ;(globalThis as unknown as { __route: typeof route }).__route = route
})
const ago = (m: number) => new Date(Date.now() - m * 60_000).toISOString()
const client = () => new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
const row = (o: Record<string, unknown>) => ({ delivery: dto(o), amountDue: 1, subtotal: 1, tax: 0, isPaid: false })
function mount(role: "delivery_operator" | "kitchen" | "cashier" = "delivery_operator") {
  return render(<QueryClientProvider client={client()}><DeliveryBoard role={role} /></QueryClientProvider>)
}
const regReads = () => env.current.filter((r) => r.url === "/api/registers/current").length

describe("DeliveryConsole live behaviour (T25)", () => {
  it("never connected: no banner, no age", async () => {
    env.rows = []; env.couriers = []
    mount()
    await waitFor(() => expect(env.current.some((r) => r.url === "/api/delivery/active")).toBe(true))
    expect(screen.getByRole("status", { name: "Sin conexión en vivo" })).toBeInTheDocument()
    expect(screen.queryByRole("alert")).toBeNull()
  })
  it("late tones and clock per state (late 10 → risk from 6)", async () => {
    env.couriers = []
    env.rows = [
      row({ orderId: "a", customerName: "R5", status: "received", createdAt: ago(5), updatedAt: ago(5) }),
      row({ orderId: "b", customerName: "R6", status: "preparing", createdAt: ago(6), updatedAt: ago(1) }),
      row({ orderId: "c", customerName: "Ready10", status: "ready", createdAt: ago(10), updatedAt: ago(1) }),
      row({ orderId: "d", customerName: "Road", status: "out_for_delivery", courierId: "k", createdAt: ago(60), dispatchedAt: ago(2), updatedAt: ago(2) }),
      row({ orderId: "e", customerName: "Fail", status: "failed", courierId: "k", createdAt: ago(60), dispatchedAt: ago(30), failedAt: ago(11), updatedAt: ago(11) }),
      row({ orderId: "f", customerName: "Done", status: "delivered", courierId: "k", createdAt: ago(90), dispatchedAt: ago(80), deliveredAt: ago(70), updatedAt: ago(70) }),
    ]
    mount()
    await screen.findByRole("tab", { name: /^Recibido/ })
    const text: Record<string, string> = {}
    for (const tab of screen.getAllByRole("tab")) {
      await act(async () => { fireEvent.mouseDown(tab, { button: 0, ctrlKey: false }) })
      for (const a of screen.queryAllByRole("article")) text[a.getAttribute("aria-label")!.split(",")[0]] = a.textContent!.replace(/\s+/g, " ")
    }
    const tone = (n: string) => (/Demorado/.test(text[n] ?? "") ? "late" : /En riesgo/.test(text[n] ?? "") ? "risk" : text[n] === undefined ? "missing" : "none")
    expect({ R5: tone("R5"), R6: tone("R6"), Ready10: tone("Ready10"), Road: tone("Road"), Fail: tone("Fail") }).toEqual({ R5: "none", R6: "risk", Ready10: "late", Road: "none", Fail: "late" })
    const closed = screen.getByRole("group", { name: "Cerrados hoy" })
    expect(closed.textContent!.replace(/\s+/g, " ")).toBe("Cerrados hoy: 3 entregados · 1 cancelado · 2 fallidosPromedio de entrega 27 min")
  })
  it("register: 1 read on mount, +1 at 60 s, +1 on focus", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      env.rows = []; env.couriers = []
      mount()
      await waitFor(() => expect(screen.getByLabelText("Turno")).toHaveTextContent("Caja cerrada"))
      await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })
      expect(regReads()).toBe(1)
      await act(async () => { await vi.advanceTimersByTimeAsync(56_000) })
      expect(regReads()).toBe(2)
      await act(async () => { window.dispatchEvent(new Event("focus")) })
      await waitFor(() => expect(regReads()).toBe(3))
    } finally { vi.useRealTimers() }
  })
  it("connect → lose → banner with age; reconnect clears it", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      env.rows = []; env.couriers = []
      rt.isConnected = true
      mount()
      await waitFor(() => expect(screen.getByRole("status", { name: /^En vivo · hace \d+ s$/ })).toBeInTheDocument())
      expect(screen.queryByRole("alert")).toBeNull()
      rt.isConnected = false
      await act(async () => { await vi.advanceTimersByTimeAsync(20_000) })
      expect(screen.getByRole("alert")).toHaveTextContent(/Se perdió la conexión en vivo hace \d+ s\./)
      rt.isConnected = true
      await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
      expect(screen.queryByRole("alert")).toBeNull()
      expect(screen.getByRole("status", { name: /^En vivo · hace \d+ s$/ })).toBeInTheDocument()
    } finally { vi.useRealTimers() }
  })
  it.each(["kitchen", "cashier"] as const)("%s: no courier write controls, no Volvió", async (role) => {
    env.rows = [row({ orderId: "g", status: "delivered", courierId: "k-1", dispatchedAt: ago(20), deliveredAt: ago(5), updatedAt: ago(5) })]
    env.couriers = [{ id: "k-1", name: "Luis", phone: null, isActive: true, createdAt: now, updatedAt: now }, { id: "k-2", name: "Beto", phone: null, isActive: false, createdAt: now, updatedAt: now }]
    mount(role)
    const rail = await screen.findByRole("region", { name: "Repartidores" })
    await within(rail).findByText("Beto")
    await waitFor(() => expect(within(rail).getByText("Luis").closest("li")).toHaveTextContent("De regreso"))
    expect(within(rail).queryByRole("button", { name: "Nuevo repartidor" })).toBeNull()
    expect(within(rail).queryByRole("button", { name: /^(Activar|Desactivar)/ })).toBeNull()
    expect(within(rail).queryByRole("button", { name: "Volvió" })).toBeNull()
  })

  it("the operator sees Volvió for the same trip", async () => {
    env.rows = [row({ orderId: "g", status: "delivered", courierId: "k-1", dispatchedAt: ago(20), deliveredAt: ago(5), updatedAt: ago(5) })]
    env.couriers = [{ id: "k-1", name: "Luis", phone: null, isActive: true, createdAt: now, updatedAt: now }]
    mount()
    const rail = await screen.findByRole("region", { name: "Repartidores" })
    expect(await within(rail).findByRole("button", { name: "Volvió" })).toBeInTheDocument()
  })
})
