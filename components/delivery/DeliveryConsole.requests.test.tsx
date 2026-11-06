import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { menuCategory, menuDish } from "@/lib/order-steps/fixtures"

/**
 * T25 — the exact requests the console and the new-delivery drawer send,
 * through the real API client (only `fetch` is routed): bodies without a
 * captured detail stay byte-identical to before; a captured one adds only its
 * own keys. Regression of the independent verifier's probes.
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
vi.mock("@/lib/api/realtime", () => ({ realtimeService: { isConnected: true, subscribeToDeliveries: () => () => {}, subscribeToZones: () => () => {} } }))

import { DeliveryOrderForm } from "@/components/delivery/DeliveryOrderForm"
import { DeliveryBoard } from "@/components/delivery/DeliveryBoard"
import { courierEtaAt } from "@/lib/delivery/dispatch-details"

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
  if (p === "/api/config") return json({ deliveryDefaultFee: 5000, deliveryLateMinutes: 45, kitchenLateMinutes: 25, taxPercentage: 0 })
  if (p === "/api/registers/current") return json(null)
  if (p === "/api/delivery/closed-today") return json({ deliveredCount: 0, cancelledCount: 0, failedCount: 0, averageDeliveryMinutes: null })
  if (p.endsWith("/status")) return json(dto({ status: "out_for_delivery", courierId: "k-1", dispatchedAt: now }))
  if (p.endsWith("/return")) return json(dto({ status: "delivered", courierId: "k-1", returnedAt: now }))
  return json({ message: `unrouted ${p}` }, 500)
}

beforeEach(() => {
  env.current = []
  env.customer = null
  ;(globalThis as unknown as { __route: typeof route }).__route = route
})
const sent = (method: string, test: (url: string) => boolean) =>
  env.current.filter((r) => r.method === method && test(r.url)).map((r) => r.body)
const createBodies = () => sent("POST", (u) => u === "/api/delivery/orders")
const ITEMS = '"items":[{"dishId":"d-3","quantity":1}]'
const EXISTING_PREPAID = `{"customer":{"id":"c-1"},"address":{"id":"a-1"},${ITEMS},"deliveryFee":4000,"paymentMode":"prepaid","cashChangeFor":null,"notes":null`
const click = async (el: HTMLElement) => { await act(async () => { fireEvent.click(el) }) }
const step = (n: string) => within(screen.getByRole("navigation", { name: "Pasos del domicilio" })).getByRole("button", { name: new RegExp(n) })
const client = () => new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })

async function fillAndSubmit(prepaid: boolean, channel?: string) {
  render(<QueryClientProvider client={client()}><DeliveryOrderForm suggestedFee={4000} taxPct={0} onSubmitted={vi.fn()} /></QueryClientProvider>)
  fireEvent.change(screen.getByLabelText("Teléfono"), { target: { value: "3001234567" } })
  await act(async () => { fireEvent.blur(screen.getByLabelText("Teléfono")) })
  if (!env.customer) {
    fireEvent.change(await screen.findByLabelText("Nombre del cliente"), { target: { value: "Luis" } })
    fireEvent.change(screen.getByLabelText("Dirección"), { target: { value: "Calle 1 # 2-3" } })
  } else {
    await screen.findByText(/dirección\(es\) guardada/)
  }
  await click(step("Productos"))
  await click(await screen.findByRole("button", { name: /^Bebidas/ }))
  await click(screen.getByRole("button", { name: /^Limonada/ }))
  await click(screen.getByRole("button", { name: /^Agregar 1 .* al pedido$/ }))
  await click(step("Pago"))
  if (prepaid) await click(screen.getByRole("radio", { name: "Anticipado" }))
  if (channel) {
    await waitFor(() => expect(screen.getByRole("radio", { name: channel })).toBeInTheDocument())
    expect(screen.queryByRole("radio", { name: "Efectivo" })).toBeNull()
    await click(screen.getByRole("radio", { name: channel }))
  }
  await click(step("Confirmar"))
  await click(screen.getByRole("button", { name: "Crear domicilio" }))
  await waitFor(() => expect(env.current.some((r) => r.method === "POST" && r.url === "/api/delivery/orders")).toBe(true))
}

const existing = {
  customer: { id: "c-1", phone: "3001234567", name: "Carolina", notes: null, createdAt: now, updatedAt: now },
  addresses: [{ id: "a-1", customerId: "c-1", label: null, addressLine: "Cra 43A", neighborhood: "Poblado", reference: null, isDefault: true, createdAt: now, updatedAt: now }],
  history: { ordersCount: 2, lastOrderAt: now, lastAddress: null },
}

describe("DeliveryConsole requests (T25)", () => {
  it("create, new customer on cash: the body is the one sent before T25", async () => {
    await fillAndSubmit(false)
    expect(createBodies()).toEqual([
      `{"customer":{"phone":"3001234567","name":"Luis"},"address":{"addressLine":"Calle 1 # 2-3","neighborhood":null,"reference":null,"label":null,"save":false},${ITEMS},"deliveryFee":4000,"paymentMode":"cash_on_delivery","cashChangeFor":null,"notes":null}`,
    ])
  })
  it("create, prepaid without a channel: no prepaidMethodId", async () => {
    env.customer = existing
    await fillAndSubmit(true)
    expect(createBodies()).toEqual([`${EXISTING_PREPAID}}`])
  })
  it("create, prepaid with Nequi: only prepaidMethodId is added", async () => {
    env.customer = existing
    await fillAndSubmit(true, "Nequi")
    expect(createBodies()).toEqual([`${EXISTING_PREPAID},"prepaidMethodId":"m-nequi"}`])
  })

  it("the last address, not saved, is sent as a new address", async () => {
    env.customer = { ...existing, history: { ordersCount: 14, lastOrderAt: new Date(Date.now() - 6 * 86_400_000 - 60_000).toISOString(), lastAddress: { addressLine: "Cl 99 # 1-1", neighborhood: "Belén", reference: null } } }
    render(<QueryClientProvider client={client()}><DeliveryOrderForm suggestedFee={4000} taxPct={0} onSubmitted={vi.fn()} /></QueryClientProvider>)
    fireEvent.change(screen.getByLabelText("Teléfono"), { target: { value: "3001234567" } })
    await act(async () => { fireEvent.blur(screen.getByLabelText("Teléfono")) })
    expect(await screen.findByText("Cliente encontrado · 14 pedidos · último hace 6 días")).toBeInTheDocument()
    await click(screen.getByRole("button", { name: "Usar esta dirección" }))
    await click(step("Productos"))
    await click(await screen.findByRole("button", { name: /^Bebidas/ }))
    await click(screen.getByRole("button", { name: /^Limonada/ }))
    await click(screen.getByRole("button", { name: /^Agregar 1 .* al pedido$/ }))
    await click(step("Confirmar"))
    await click(screen.getByRole("button", { name: "Crear domicilio" }))
    await waitFor(() => expect(env.current.some((r) => r.method === "POST" && r.url === "/api/delivery/orders")).toBe(true))
    expect(createBodies()).toEqual([
      `{"customer":{"id":"c-1"},"address":{"addressLine":"Cl 99 # 1-1","neighborhood":"Belén","reference":null,"label":null,"save":false},${ITEMS},"deliveryFee":4000,"paymentMode":"cash_on_delivery","cashChangeFor":null,"notes":null}`,
    ])
  })
  async function board() {
    env.rows = [
      { delivery: dto(), amountDue: 19000, subtotal: 19000, tax: 0, isPaid: false },
      { delivery: dto({ orderId: "22222222-2222-2222-2222-222222222222", orderNumber: 413, status: "delivered", courierId: "k-1", dispatchedAt: now, deliveredAt: now }), amountDue: 0, subtotal: 0, tax: 0, isPaid: true },
    ]
    env.couriers = [
      { id: "k-1", name: "Luis Pérez", phone: null, isActive: true, createdAt: now, updatedAt: now },
      { id: "k-2", name: "Beto Inactivo", phone: null, isActive: false, createdAt: now, updatedAt: now },
    ]
    render(<QueryClientProvider client={client()}><DeliveryBoard role="delivery_operator" /></QueryClientProvider>)
    const tab = await screen.findByRole("tab", { name: /^Listo/ })
    await act(async () => { fireEvent.mouseDown(tab, { button: 0, ctrlKey: false }) })
    await waitFor(() => expect(env.current.some((r) => r.url.startsWith("/api/delivery/couriers"))).toBe(true))
  }
  async function dispatch(eta?: string, loc?: string) {
    await click(await screen.findByRole("button", { name: "Despachar" }))
    const dialog = await screen.findByRole("dialog", { name: /^Despachar/ })
    await click(await within(dialog).findByRole("radio", { name: /Luis Pérez/ }))
    if (eta) fireEvent.change(within(dialog).getByLabelText("Vuelve a las (opcional)"), { target: { value: eta } })
    if (loc) fireEvent.change(within(dialog).getByLabelText("Zona o barrio (opcional)"), { target: { value: loc } })
    await click(within(dialog).getByRole("button", { name: /^Despachar( con|$)/ }))
    await waitFor(() => expect(env.current.some((r) => r.url.endsWith("/status"))).toBe(true))
  }
  it("mount reads the closed-today summary and the register once each", async () => {
    await board()
    await waitFor(() => expect(sent("GET", (u) => u === "/api/delivery/closed-today")).toHaveLength(1))
    await waitFor(() => expect(sent("GET", (u) => u === "/api/registers/current")).toHaveLength(1))
    await new Promise((r) => setTimeout(r, 300))
    expect(sent("GET", (u) => u === "/api/delivery/closed-today")).toHaveLength(1)
    expect(sent("GET", (u) => u === "/api/registers/current")).toHaveLength(1)
  })
  it("dispatch without ETA or location sends the old body", async () => {
    await board()
    await dispatch()
    expect(sent("POST", (u) => u.endsWith("/status"))).toEqual(['{"action":"dispatch","courierId":"k-1","reason":null}'])
  })
  it("dispatch with ETA and location adds only courierEta and the trimmed courierLocation", async () => {
    await board()
    const at = new Date(Date.now() + 60 * 60_000)
    const hhmm = `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`
    await dispatch(hhmm, "  Laureles ")
    const eta = courierEtaAt(hhmm, new Date())
    if (!eta.ok || eta.eta === null) throw new Error("test ETA must be valid")
    expect(sent("POST", (u) => u.endsWith("/status"))).toEqual([
      `{"action":"dispatch","courierId":"k-1","reason":null,"courierEta":"${eta.eta}","courierLocation":"Laureles"}`,
    ])
  })
  it("Volvió, Activar and Nuevo send exactly their bodies", async () => {
    await board()
    const rail = screen.getByRole("region", { name: "Repartidores" })
    await click(await within(rail).findByRole("button", { name: "Volvió" }))
    await waitFor(() => expect(env.current.some((r) => r.url.endsWith("/return"))).toBe(true))
    await click(within(rail).getByRole("button", { name: "Activar a Beto Inactivo" }))
    await waitFor(() => expect(env.current.some((r) => r.method === "PATCH")).toBe(true))
    await click(within(rail).getByRole("button", { name: "Nuevo repartidor" }))
    fireEvent.change(await screen.findByLabelText("Nombre"), { target: { value: "  Duván  " } })
    fireEvent.change(screen.getByLabelText("Teléfono (opcional)"), { target: { value: "310 123 4567" } })
    await click(screen.getByRole("button", { name: "Crear repartidor" }))
    await waitFor(() => expect(env.current.some((r) => r.method === "POST" && r.url === "/api/delivery/couriers")).toBe(true))
    expect(sent("POST", (u) => u.endsWith("/return"))).toEqual([""])
    expect(sent("PATCH", (u) => u.startsWith("/api/delivery/couriers/"))).toEqual(['{"isActive":true}'])
    expect(sent("POST", (u) => u === "/api/delivery/couriers")).toEqual(['{"name":"Duván","phone":"3101234567"}'])
  })
})
