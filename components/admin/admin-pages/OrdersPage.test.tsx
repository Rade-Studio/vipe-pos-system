import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type React from "react"
import { createPortal } from "react-dom"
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * T28 (S2, S6, S8) — admin Órdenes: dense table with a side detail panel
 * (design/admin-orders/01-tabla-densa-con-panel.html). Every value comes from
 * the API: the orders, the tables/zones, the delivery board, the couriers and
 * the business-config late thresholds.
 */

const api = vi.hoisted(() => ({
  thresholds: null as null | { kitchenLateMinutes: number; deliveryLateMinutes: number },
  completed: [] as unknown[],
}))

vi.mock("@/lib/api/settings", () => ({
  DEFAULT_LATE_THRESHOLDS: { kitchenLateMinutes: 25, deliveryLateMinutes: 45 },
  fetchLateThresholds: async () => {
    if (!api.thresholds) throw new Error("config unavailable")
    return api.thresholds
  },
}))
vi.mock("@/lib/api/zones", () => ({
  getAll: async () => [
    { id: "z1", name: "Salón principal" },
    { id: "z2", name: "Terraza" },
  ],
}))
vi.mock("@/lib/api/delivery", () => ({
  listActiveDeliveries: async () => [
    {
      delivery: {
        orderId: "b",
        customerName: "Laura Gómez",
        addressLine: "Cra 43A #18-35",
        neighborhood: "El Poblado",
        courierId: "k1",
      },
      amountDue: 0,
      subtotal: 0,
      tax: 0,
      isPaid: false,
    },
  ],
  listCouriers: async () => [{ id: "k1", name: "Mateo Ríos", isActive: true }],
}))
vi.mock("@/lib/api/realtime", () => ({
  realtimeService: {
    isConnected: true,
    subscribeToZones: () => () => {},
    subscribeToDeliveries: () => () => {},
    subscribeToConnectionStatus: () => () => {},
  },
}))
vi.mock("@/lib/api/completed-orders", () => ({ getOrdersByDate: async () => api.completed }))
vi.mock("@/lib/api/payments", () => ({ listPaymentMethods: async () => [] }))
const cancelled = vi.hoisted(() => ({ rows: [] as unknown[], dates: [] as string[] }))
vi.mock("@/lib/api/orders", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getCancelledOrders: async (date: string) => {
    cancelled.dates.push(date)
    return cancelled.rows
  },
}))
// F3: the step sheet has its own suite; here only the target the panel opens.
const voidFlow = vi.hoisted(() => ({ last: null as null | { target: any; onDone?: (r: unknown) => void } }))
vi.mock("@/components/voids/VoidFlow", () => ({
  VoidFlow: (props: { target: any; onDone?: (r: unknown) => void }) => {
    voidFlow.last = props
    // A portal, like the real sheet: the detail overlay hides everything rendered before it.
    return props.target
      ? createPortal(
          <div role="alertdialog" aria-label="Hoja de anulación">
            <button type="button" onClick={() => props.onDone?.({ action: props.target.action, orderId: props.target.orderId })}>
              Simular anulación
            </button>
          </div>,
          document.body,
        )
      : null
  },
}))

import { useProfileStore } from "@/store/useProfileStore"
import { useTableStore } from "@/store/useTableStore"
import { OrdersPage } from "./OrdersPage"
import type { Order, OrderItem } from "@/types"

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000 - 5_000)

function item(name: string, quantity: number, status: OrderItem["status"], comments?: string): OrderItem {
  return { id: `${name}-i`, name, price: 1000, quantity, categoryId: "", image: "", status, comments }
}

function order(partial: Partial<Order> & { id: string }): Order {
  return {
    tableId: "",
    items: [],
    status: "kitchen",
    bill: { subtotal: 0, tax: 0, taxPercentage: 0, tip: 0, tipPercentage: 0, total: 0, totalDiscounts: 0 },
    waiter: "",
    createdAt: minutesAgo(1),
    ...partial,
  } as Order
}

const ORDERS: Order[] = [
  order({
    id: "a",
    orderNumber: 128,
    tableId: "t8",
    waiter: "w1",
    guests: 4,
    status: "kitchen",
    createdAt: minutesAgo(18),
    items: [item("Bandeja paisa", 2, "kitchen", "Una sin chicharrón"), item("Limonada de coco", 2, "served")],
    bill: { subtotal: 110800, tax: 8864, taxPercentage: 8, tip: 11080, tipPercentage: 10, total: 130744, totalDiscounts: 0 },
  }),
  order({
    id: "b",
    orderNumber: 127,
    orderType: "delivery",
    waiter: "w2",
    status: "delivered",
    createdAt: minutesAgo(58),
    bill: { subtotal: 0, tax: 0, taxPercentage: 0, tip: 0, tipPercentage: 0, total: 82620, totalDiscounts: 0 },
  }),
  order({
    id: "c",
    orderNumber: 125,
    tableId: "t12",
    waiter: "w1",
    status: "kitchen",
    createdAt: minutesAgo(31),
    bill: { subtotal: 0, tax: 0, taxPercentage: 0, tip: 0, tipPercentage: 0, total: 314706, totalDiscounts: 0 },
  }),
  order({
    id: "d",
    orderNumber: 122,
    tableId: "t5",
    waiter: "w1",
    status: "active",
    createdAt: minutesAgo(2),
    bill: { subtotal: 0, tax: 0, taxPercentage: 0, tip: 0, tipPercentage: 0, total: 50000, totalDiscounts: 0 },
  }),
]

function renderPage(props: Partial<React.ComponentProps<typeof OrdersPage>> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const onVoided = vi.fn()
  const onRefresh = vi.fn()
  render(
    <QueryClientProvider client={client}>
      <OrdersPage
        description="Órdenes activas y completadas"
        orders={ORDERS}
        isLoading={false}
        isFetching={false}
        realtimeConnected
        newOrdersCount={0}
        onRefresh={onRefresh}
        onVoided={onVoided}
        selectedDate={new Date()}
        onDateChange={() => {}}
        {...props}
      />
    </QueryClientProvider>,
  )
  return { onVoided, onRefresh }
}

/** Order labels of the table rows, top to bottom. */
function rowLabels() {
  return screen.queryAllByTestId(/^admin-order-/).map((row) => within(row).getByTestId("order-label").textContent)
}

beforeEach(() => {
  api.thresholds = { kitchenLateMinutes: 25, deliveryLateMinutes: 45 }
  api.completed = []
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: 1024 })
  useProfileStore.setState({
    profiles: [
      { id: "w1", name: "Andrés Felipe Osorio", role: "waiter" },
      { id: "w2", name: "Valentina Cardona", role: "waiter" },
    ],
  })
  useTableStore.setState({
    tables: [
      { id: "t8", number: 8, status: "occupied", zoneId: "z1" },
      { id: "t12", number: 12, status: "occupied", zoneId: "z1" },
      { id: "t5", number: 5, status: "occupied", zoneId: "z2" },
    ],
  })
})

describe("OrdersPage — header and table", () => {
  it("shows the summary line, the tab counts and the rows oldest first with place, waiter and status", async () => {
    renderPage()

    expect(screen.getByRole("heading", { level: 1, name: "Órdenes" })).toBeInTheDocument()
    expect(screen.getByText("4 activas · 1 domicilio · la más antigua lleva 58 min")).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: /Activas\s*4/ })).toBeInTheDocument()
    expect(rowLabels()).toEqual(["#127", "#125", "#128", "#122"])

    const row = screen.getByTestId("admin-order-a")
    expect(row).toHaveTextContent("Mesa 8")
    expect(row).toHaveTextContent("Andrés Felipe Osorio")
    expect(row).toHaveTextContent("En cocina")
    expect(row).toHaveTextContent("18 min")
    await waitFor(() => expect(row).toHaveTextContent("Salón principal"))
    await waitFor(() => expect(screen.getByTestId("admin-order-b")).toHaveTextContent("Laura Gómez"))
    expect(screen.getByRole("columnheader", { name: /Tiempo/ })).toHaveAttribute("aria-sort", "descending")
  })

  it("sorts by Orden, Total and Tiempo with aria-sort", async () => {
    renderPage()

    fireEvent.click(screen.getByRole("button", { name: /^Orden/ }))
    expect(rowLabels()).toEqual(["#122", "#125", "#127", "#128"])
    expect(screen.getByRole("columnheader", { name: /Orden/ })).toHaveAttribute("aria-sort", "ascending")
    expect(screen.getByRole("columnheader", { name: /Tiempo/ })).toHaveAttribute("aria-sort", "none")

    fireEvent.click(screen.getByRole("button", { name: /^Total/ }))
    expect(rowLabels()).toEqual(["#125", "#128", "#127", "#122"])
    expect(screen.getByRole("columnheader", { name: /Total/ })).toHaveAttribute("aria-sort", "descending")

    fireEvent.click(screen.getByRole("button", { name: /^Tiempo/ }))
    fireEvent.click(screen.getByRole("button", { name: /^Tiempo/ }))
    expect(rowLabels()).toEqual(["#122", "#128", "#125", "#127"])
    expect(screen.getByRole("columnheader", { name: /Tiempo/ })).toHaveAttribute("aria-sort", "ascending")
  })

  it("marks late orders with the business-config thresholds (kitchen and delivery), none for other statuses", async () => {
    renderPage()

    await waitFor(() => expect(screen.getByTestId("admin-order-c")).toHaveTextContent(/Atrasada/))
    expect(screen.getByTestId("admin-order-b")).toHaveTextContent(/Atrasada/)
    expect(screen.getByTestId("admin-order-a")).not.toHaveTextContent(/Atrasada/)
    expect(screen.getByTestId("admin-order-d")).not.toHaveTextContent(/Atrasada/)
  })

  it("follows a lower kitchen threshold from the config", async () => {
    api.thresholds = { kitchenLateMinutes: 15, deliveryLateMinutes: 60 }
    renderPage()

    await waitFor(() => expect(screen.getByTestId("admin-order-a")).toHaveTextContent(/Atrasada/))
    expect(screen.getByTestId("admin-order-b")).not.toHaveTextContent(/Atrasada/)
  })

  it("shows no late marker when the config cannot be read (no invented threshold)", async () => {
    api.thresholds = null
    renderPage()

    await waitFor(() => expect(screen.getByTestId("admin-order-b")).toHaveTextContent("Laura Gómez"))
    expect(screen.queryByText(/Atrasada/)).toBeNull()
  })
})

describe("OrdersPage — search and filters", () => {
  it("searches by #number, waiter, customer and courier, with the result hint and Quitar filtros", async () => {
    renderPage()
    const search = screen.getByRole("searchbox", { name: "Buscar órdenes" })

    fireEvent.change(search, { target: { value: "#128" } })
    expect(rowLabels()).toEqual(["#128"])
    expect(screen.getByRole("status")).toHaveTextContent("1 de 4 órdenes para “#128”")

    // The courier comes from the couriers read: the search waits for it.
    fireEvent.change(search, { target: { value: "mateo" } })
    await waitFor(() => expect(rowLabels()).toEqual(["#127"]))

    fireEvent.change(search, { target: { value: "mesa 30" } })
    expect(screen.getByText("Ninguna orden coincide con “mesa 30”")).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole("button", { name: "Quitar filtros" })[0])
    expect(rowLabels()).toHaveLength(4)
    expect(search).toHaveValue("")
  })

  it("filters by real status chips with counts and by type", () => {
    renderPage()
    const chips = screen.getByRole("group", { name: "Filtrar por estado" })

    expect(within(chips).getByRole("button", { name: /Todos\s*4/ })).toHaveAttribute("aria-pressed", "true")
    expect(within(chips).getByRole("button", { name: /Abierta\s*1/ })).toBeInTheDocument()
    expect(within(chips).getByRole("button", { name: /Servida\s*1/ })).toBeInTheDocument()

    fireEvent.click(within(chips).getByRole("button", { name: /En cocina\s*2/ }))
    expect(rowLabels()).toEqual(["#125", "#128"])
    expect(within(chips).getByRole("button", { name: /En cocina/ })).toHaveAttribute("aria-pressed", "true")

    fireEvent.click(within(chips).getByRole("button", { name: /Todos/ }))
    fireEvent.change(screen.getByRole("combobox", { name: "Tipo de orden" }), { target: { value: "delivery" } })
    expect(rowLabels()).toEqual(["#127"])
    fireEvent.change(screen.getByRole("combobox", { name: "Tipo de orden" }), { target: { value: "table" } })
    expect(rowLabels()).toEqual(["#125", "#128", "#122"])
  })

  it("shows the empty state when there are no active orders", () => {
    const { onRefresh } = renderPage({ orders: [] })

    expect(screen.getByText("No hay órdenes activas")).toBeInTheDocument()
    expect(screen.getByText("Sin órdenes abiertas ahora")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /Verificar nuevamente/ }))
    expect(onRefresh).toHaveBeenCalled()
  })
})

describe("OrdersPage — selection and detail panel", () => {
  it("opens the detail of a row with place, waiter, guests, zone, items and totals", async () => {
    renderPage()
    await waitFor(() => expect(screen.getByTestId("admin-order-a")).toHaveTextContent("Salón principal"))

    fireEvent.click(within(screen.getByTestId("admin-order-a")).getByRole("button", { name: /Abrir orden 128/ }))

    const panel = await screen.findByRole("dialog", { name: /#128/ })
    expect(panel).toHaveTextContent("En cocina")
    expect(panel).toHaveTextContent("Mesa 8 · Salón principal")
    expect(panel).toHaveTextContent("Andrés Felipe Osorio")
    expect(panel).toHaveTextContent("Comensales4")
    expect(panel).toHaveTextContent(/hace 18 min/)
    expect(panel).toHaveTextContent("Bandeja paisa")
    expect(panel).toHaveTextContent("“Una sin chicharrón”")
    expect(panel).toHaveTextContent("Pendiente")
    expect(panel).toHaveTextContent("Servido")
    expect(panel).toHaveTextContent("Platos · 4")
    expect(panel).toHaveTextContent("2 pendientes")
    expect(panel).toHaveTextContent("Impuesto (8%)")
    expect(panel).toHaveTextContent("Propina (10%)")
    expect(panel).toHaveTextContent(/Total\s*\$\s*130\.744/)
    expect(screen.getByTestId("admin-order-a")).toHaveAttribute("data-selected", "true")
  })

  it("F7: shows a line's options with their price under the dish", async () => {
    const modifiers = [
      { groupId: "g-t", groupName: "Término", optionId: "o-m", name: "Medio", price: 0 },
      { groupId: "g-a", groupName: "Adiciones", optionId: "o-c", name: "Queso cheddar", price: 3000 },
    ]
    const withOptions = ORDERS.map((o) =>
      o.id === "a" ? { ...o, items: [{ ...item("Hamburguesa", 1, "kitchen"), price: 25000, modifiers }] } : o,
    )
    renderPage({ orders: withOptions })
    fireEvent.click(within(screen.getByTestId("admin-order-a")).getByRole("button", { name: /Abrir orden 128/ }))
    const panel = await screen.findByRole("dialog", { name: /#128/ })
    const options = within(panel).getByRole("list", { name: "Opciones" })
    expect(options).toHaveTextContent("Término: Medio")
    expect(options).toHaveTextContent(/\+ Queso cheddar\s*\$\s3\.000/)
  })

  it("shows the delivery customer, address and courier in the detail", async () => {
    renderPage()
    await waitFor(() => expect(screen.getByTestId("admin-order-b")).toHaveTextContent("Laura Gómez"))

    fireEvent.click(within(screen.getByTestId("admin-order-b")).getByRole("button", { name: /Abrir orden 127/ }))
    const panel = await screen.findByRole("dialog", { name: /#127/ })
    expect(panel).toHaveTextContent("Cra 43A #18-35, El Poblado")
    expect(panel).toHaveTextContent("Mateo Ríos")
  })

  it("moves the selection with the arrow keys", () => {
    renderPage()
    const first = within(screen.getByTestId("admin-order-b")).getByRole("button", { name: /Abrir orden 127/ })
    first.focus()

    fireEvent.keyDown(first, { key: "ArrowDown" })
    expect(screen.getByTestId("admin-order-c")).toHaveAttribute("data-selected", "true")
    expect(within(screen.getByTestId("admin-order-c")).getByRole("button", { name: /Abrir orden 125/ })).toHaveFocus()

    fireEvent.keyDown(document.activeElement as Element, { key: "ArrowUp" })
    expect(screen.getByTestId("admin-order-b")).toHaveAttribute("data-selected", "true")
  })

  it("docks the panel beside the table from 1280 px with the oldest order selected", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: 1440 })
    renderPage()

    const panel = await screen.findByRole("complementary", { name: "Detalle de la orden" })
    expect(panel).toHaveTextContent("#127")
    expect(screen.queryByRole("dialog")).toBeNull()
  })
})

describe("OrdersPage — F3 anular plato y cancelar orden (hoja por pasos)", () => {
  async function openPanel() {
    const utils = renderPage()
    fireEvent.click(within(screen.getByTestId("admin-order-a")).getByRole("button", { name: /Abrir orden 128/ }))
    const panel = await screen.findByRole("dialog", { name: /#128/ })
    return { ...utils, panel }
  }

  it("'Cancelar orden' opens the step sheet for that order; no typed order number any more", async () => {
    const { onVoided, panel } = await openPanel()
    expect(within(panel).queryByLabelText(/para confirmar/)).toBeNull()
    fireEvent.click(within(panel).getByRole("button", { name: "Cancelar orden" }))
    expect(voidFlow.last?.target).toEqual({
      action: "order",
      orderId: "a",
      label: "#128 · Mesa 8",
      lines: [
        { id: "Bandeja paisa-i", name: "Bandeja paisa", price: 1000, quantity: 2, comments: "Una sin chicharrón" },
        { id: "Limonada de coco-i", name: "Limonada de coco", price: 1000, quantity: 2, comments: undefined },
      ],
      total: 130744,
    })
    fireEvent.click(screen.getByRole("button", { name: "Simular anulación" }))
    expect(onVoided).toHaveBeenCalledWith({ action: "order", orderId: "a" })
  })

  it("'Anular plato' opens the item sheet with the order's lines", async () => {
    const { panel } = await openPanel()
    fireEvent.click(within(panel).getByRole("button", { name: "Anular plato" }))
    expect(voidFlow.last?.target).toMatchObject({ action: "item", orderId: "a", label: "#128 · Mesa 8" })
    expect(voidFlow.last?.target.lines).toHaveLength(2)
  })

  it("a delivery is cancelled from Domicilios, not from here", async () => {
    renderPage()
    fireEvent.click(within(screen.getByTestId("admin-order-b")).getByRole("button", { name: /Abrir orden 127/ }))
    const panel = await screen.findByRole("dialog", { name: /#127/ })
    expect(within(panel).queryByRole("button", { name: "Cancelar orden" })).toBeNull()
    expect(within(panel).getByText("Los domicilios se cancelan desde Domicilios.")).toBeInTheDocument()
  })
})

describe("OrdersPage — F3 Canceladas", () => {
  // Today, never a fixed date: the page only lists the selected day's cancellations (#144, the time-bomb rule).
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const pad = (n: number) => String(n).padStart(2, "0")
  const todayKey = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`
  const cancelledRow = (id: string, orderNumber: number, total: number, over: Record<string, unknown> = {}) => ({
    id,
    orderNumber,
    tableNumber: 11,
    waiterName: "Valentina Cardona",
    items: [],
    cancellation: {
      reason: "customer_left",
      reasonLabel: "El cliente se fue",
      reasonText: null,
      cancelledBy: { id: "w2", name: "Valentina Cardona" },
      authorizedBy: { id: "c1", name: "Laura Gómez" },
      selfAuthorized: false,
      previousStatus: "kitchen",
      subtotal: total,
      tax: 0,
      tip: 0,
      total,
      sentItems: 3,
      cancelledAt: new Date(today.getTime() + 60_000).toISOString(),
    },
    ...over,
  })

  it("lists the day's cancelled orders with their amounts from GET /orders/cancelled and the total", async () => {
    cancelled.rows = [
      cancelledRow("x", 130, 23800),
      cancelledRow("y", 127, 39300, {
        tableNumber: 4,
        cancellation: {
          ...cancelledRow("y", 127, 39300).cancellation,
          reasonLabel: "Error del mesero",
          authorizedBy: { id: "c1", name: "Laura Gómez" },
          selfAuthorized: true,
        },
      }),
    ]
    renderPage({ selectedDate: today })
    await waitFor(() => expect(screen.getByRole("tab", { name: /Canceladas\s*2/ })).toBeInTheDocument())
    act(() => {
      fireEvent.mouseDown(screen.getByRole("tab", { name: /Canceladas/ }))
    })
    expect(cancelled.dates).toContain(todayKey)
    const table = await screen.findByRole("table", { name: "Órdenes canceladas" })
    const rows = within(table).getAllByRole("row")
    expect(rows[1]).toHaveTextContent("#130")
    expect(rows[1]).toHaveTextContent("Mesa 11")
    expect(rows[1]).toHaveTextContent("El cliente se fue")
    expect(rows[1]).toHaveTextContent("Laura Gómez")
    expect(rows[1]).toHaveTextContent(/23\.800/)
    expect(rows[2]).toHaveTextContent("Autoautorizada")
    expect(rows[3]).toHaveTextContent(/Total cancelado.*63\.100/)
    expect(screen.getByText(/2 órdenes canceladas · \$\s63\.100/)).toBeInTheDocument()
  })

  // F3b: Domicilios cancelled through the audited path, and those cancelled before it.
  it("shows deliveries with a Domicilio label, who cancelled them, and legacy ones without inventing an actor", async () => {
    cancelled.rows = [
      cancelledRow("d", 41, 37000, {
        orderType: "delivery",
        tableNumber: null,
        waiterName: null,
        delivery: { customerName: "Ana Ruiz", deliveryFee: 5000 },
        cancellation: { ...cancelledRow("d", 41, 37000).cancellation, cancelledBy: { id: "op", name: "Operadora Ana" }, authorizedBy: null },
      }),
      cancelledRow("l", 40, 12000, {
        orderType: "delivery",
        tableNumber: null,
        waiterName: null,
        delivery: { customerName: "Bea Gil", deliveryFee: 3000 },
        cancellation: {
          ...cancelledRow("l", 40, 12000).cancellation,
          reason: null,
          reasonLabel: "Sin motivo registrado (antes de la auditoría)",
          cancelledBy: null,
          authorizedBy: null,
          previousStatus: null,
          legacy: true,
        },
      }),
    ]
    renderPage({ selectedDate: today })
    await waitFor(() => expect(screen.getByRole("tab", { name: /Canceladas\s*2/ })).toBeInTheDocument())
    act(() => {
      fireEvent.mouseDown(screen.getByRole("tab", { name: /Canceladas/ }))
    })
    const table = await screen.findByRole("table", { name: "Órdenes canceladas" })
    expect(within(table).getByRole("columnheader", { name: "Canceló" })).toBeInTheDocument()
    const rows = within(table).getAllByRole("row")
    expect(rows[1]).toHaveTextContent(/Domicilio\s*Ana Ruiz/)
    expect(rows[1]).toHaveTextContent("Operadora Ana")
    expect(rows[1]).toHaveTextContent("No hizo falta")
    expect(rows[1]).toHaveTextContent(/37\.000/)
    expect(rows[2]).toHaveTextContent(/Domicilio\s*Bea Gil/)
    expect(rows[2]).toHaveTextContent("Sin motivo registrado (antes de la auditoría)")
    expect(within(rows[2]).getAllByText("Sin registro")).toHaveLength(2)
    expect(rows[2]).not.toHaveTextContent("No hizo falta")
  })

  it("says so when nothing was cancelled", async () => {
    cancelled.rows = []
    renderPage()
    act(() => {
      fireEvent.mouseDown(screen.getByRole("tab", { name: /Canceladas/ }))
    })
    expect(await screen.findByText("No hay órdenes canceladas este día.")).toBeInTheDocument()
  })
})

describe("OrdersPage — tab switch shape", () => {
  it("rounds the active tab like its pill container", async () => {
    renderPage()
    const tab = await screen.findByRole("tab", { name: /Activas/ })
    expect(tab.className).toMatch(/\brounded-full\b/)
    expect(tab.className).not.toMatch(/\brounded-sm\b/)
  })
})

describe("OrdersPage — Completadas hoy", () => {
  it("shows the day's paid count, sales and tips from /orders/completed, and its list", async () => {
    api.completed = [
      order({ id: "p1", orderNumber: 112, tableId: "t8", waiter: "w1", status: "paid", bill: { subtotal: 0, tax: 0, taxPercentage: 0, tip: 10000, tipPercentage: 10, total: 110000, totalDiscounts: 0 } }),
      order({ id: "p2", orderNumber: 111, orderType: "delivery", waiter: "w2", status: "paid", bill: { subtotal: 0, tax: 0, taxPercentage: 0, tip: 0, tipPercentage: 0, total: 50000, totalDiscounts: 0 } }),
    ]
    renderPage()

    await waitFor(() => expect(screen.getByRole("tab", { name: /Completadas hoy\s*2/ })).toBeInTheDocument())
    await act(async () => {
      fireEvent.mouseDown(screen.getByRole("tab", { name: /Completadas hoy/ }))
    })

    const totals = await screen.findByRole("group", { name: "Totales del día" })
    expect(within(totals).getByText("Órdenes pagadas").nextElementSibling).toHaveTextContent("2")
    expect(within(totals).getByText("Ventas del día").nextElementSibling).toHaveTextContent(/\$\s*160\.000/)
    expect(within(totals).getByText("Propinas").nextElementSibling).toHaveTextContent(/\$\s*10\.000/)
    // Cancelling deletes the order: nothing stored to count, so no invented number.
    expect(within(totals).getByText("Canceladas").nextElementSibling).toHaveTextContent("—")

    const list = await screen.findByTestId("completed-order-p1")
    expect(list).toHaveTextContent("#112")
    expect(list).toHaveTextContent("Mesa 8")
    expect(list).toHaveTextContent("Andrés Felipe Osorio")
    expect(list).toHaveTextContent("Pagada")
    expect(screen.getByTestId("completed-order-p2")).toHaveTextContent("Domicilio")
  })
})

describe("OrdersPage — S6 touch targets", () => {
  it("every tab is at least 44 px tall", () => {
    renderPage()
    for (const name of [/Activas/, /Completadas/, /Canceladas/]) {
      expect(screen.getByRole("tab", { name })).toHaveClass("min-h-11")
    }
  })
})
