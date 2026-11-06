import { act, render, screen } from "@testing-library/react"
import { QueryClientProvider } from "@tanstack/react-query"
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest"

import { useCartStore } from "@/store/useCartStore"
import { useOrderStore } from "@/store/useOrderStore"
import { useProfileStore } from "@/store/useProfileStore"
import { useTableStore } from "@/store/useTableStore"
import { useConfigStore } from "@/store/use-config-store"
import { queryClient } from "@/lib/queryClient"
import type { Profile } from "@/types"

/**
 * T6 (S1/S2) — the waiter screen tore down and rebuilt its realtime
 * subscriptions on every table selection, refetched the waiters on the way
 * (`loadWaiters` ran inside an effect keyed on the same change) and remounted the
 * whole menu. This suite drives the real view through those interactions and
 * counts the requests/subscriptions it causes, plus the delivery invariant
 * S13 (a domicilio never reaches the waiter lists).
 */

const STOCK_DISH = "d1d1d1d1-0000-4000-8000-000000000001"

const env = vi.hoisted(() => ({
  addItems: vi.fn(),
  tableGetAll: vi.fn(),
  zoneGetAll: vi.fn(),
  orderGetByStatus: vi.fn(),
  waiterGetAll: vi.fn(),
  categories: vi.fn(),
  dishesByCategory: vi.fn(),
  assignWaiter: vi.fn(),
  updateTableStatus: vi.fn(),
  releaseTable: vi.fn(),
  subscribeToTables: vi.fn(),
  subscribeToOrders: vi.fn(),
  sendCommand: vi.fn(),
  orderCreate: vi.fn(),
  checkDishesStock: vi.fn(),
  consumeOrderStock: vi.fn(),
  toastFn: vi.fn(),
  checkStockForDishes: vi.fn(),
  /** true while the dish can be sold, false once the send has reduced stock. */
  stockSoldOut: false,
  tableCallbacks: [] as ((payload: unknown) => void)[],
  orderCallbacks: [] as ((payload: unknown) => void)[],
  reset() {
    this.addItems.mockReset()
    this.tableGetAll.mockReset()
    this.zoneGetAll.mockReset()
    this.orderGetByStatus.mockReset()
    this.waiterGetAll.mockReset()
    this.categories.mockReset()
    this.dishesByCategory.mockReset()
    this.assignWaiter.mockReset()
    this.updateTableStatus.mockReset()
    this.releaseTable.mockReset()
    this.subscribeToTables.mockReset()
    this.subscribeToOrders.mockReset()
    this.sendCommand.mockReset()
    this.orderCreate.mockReset()
    this.checkDishesStock.mockReset()
    this.consumeOrderStock.mockReset()
    this.toastFn.mockReset()
    this.checkStockForDishes.mockReset()
    this.stockSoldOut = false
    this.tableCallbacks = []
    this.orderCallbacks = []
    this.tableGetAll.mockResolvedValue([])
    this.zoneGetAll.mockResolvedValue([])
    this.orderGetByStatus.mockResolvedValue([])
    this.waiterGetAll.mockResolvedValue([])
    this.categories.mockResolvedValue([])
    this.dishesByCategory.mockResolvedValue([])
    // The table DTO the floor actions answer with.
    const table = { id: "t-1", number: 1, status: "occupied", waiterId: "w-1", waiterName: null, createdAt: null, updatedAt: null }
    this.assignWaiter.mockResolvedValue(table)
    this.updateTableStatus.mockResolvedValue(table)
    this.releaseTable.mockResolvedValue({ ...table, status: "available", waiterId: null })
    this.orderCreate.mockImplementation(async () => orderDto("o-new", "t-1"))
    this.addItems.mockImplementation(async (id: string) => orderDto(id, "t-1"))
    this.checkDishesStock.mockResolvedValue({ ok: true, enabled: true, shortages: [] })
    this.consumeOrderStock.mockResolvedValue({ orderId: "o-new", enabled: true, consumedItems: 1, totalCost: 0, shortages: [] })
    this.checkStockForDishes.mockImplementation(async () =>
      new Map(env.stockSoldOut ? [[STOCK_DISH, false]] : [[STOCK_DISH, true]]),
    )
  },
  /** Unsubscribes handed back by the realtime service, in order. */
  unsubscribes: 0,
}))

// T8b: tables, orders and waiters go through the API client. The fake routes
// each `METHOD path` to one recorder; a rejected recorder is an API error.
vi.mock("@/lib/api/client", () => {
  const route = async (method: string, path: string, init: any = {}) => {
    const id = init?.params?.path?.id
    const body = init?.body
    switch (`${method} ${path}`) {
      case "GET /api/tables":
        return { data: await env.tableGetAll() }
      case "GET /api/zones":
        return { data: await env.zoneGetAll() }
      case "GET /api/orders":
        return { data: await env.orderGetByStatus(init.params.query) }
      case "GET /api/staff/waiters":
        return { data: await env.waiterGetAll() }
      case "POST /api/tables/{id}/assign":
        return { data: await env.assignWaiter(id, body.waiterId) }
      case "POST /api/tables/{id}/release":
        return { data: await env.releaseTable(id, body) }
      case "PATCH /api/tables/{id}":
        return { data: await env.updateTableStatus(id, body) }
      case "POST /api/orders":
        return { data: await env.orderCreate(body) }
      case "POST /api/orders/{id}/items":
        return { data: await env.addItems(id, body) }
      default:
        throw new Error(`unexpected ${method} ${path}`)
    }
  }
  return {
    api: {
      GET: (path: string, init?: unknown) => route("GET", path, init),
      POST: (path: string, init?: unknown) => route("POST", path, init),
      PATCH: (path: string, init?: unknown) => route("PATCH", path, init),
      DELETE: (path: string, init?: unknown) => route("DELETE", path, init),
    },
    onSessionRefreshed: () => () => {},
  }
})

vi.mock("@/lib/api/catalog", () => ({
  fetchCategories: () => env.categories(),
  fetchDishes: (filter: { categoryId: string }) => env.dishesByCategory(filter.categoryId),
}))

vi.mock("@/lib/api/inventory", () => ({
  checkStockForDishes: env.checkStockForDishes,
  checkDishesStock: env.checkDishesStock,
  consumeOrderStock: env.consumeOrderStock,
}))

// A stable toast so the view's callbacks keep their identity across renders.
const toastApi = vi.hoisted(() => ({ value: null as null | { toast: (...args: unknown[]) => void } }))
vi.mock("@/hooks/use-toast", () => {
  toastApi.value = { toast: (...args: unknown[]) => env.toastFn(...args) }
  return { useToast: () => toastApi.value, toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }
})

vi.mock("@/lib/api/print", () => ({ sendCommand: env.sendCommand }))

vi.mock("@/lib/api/realtime", () => ({
  realtimeService: {
    subscribeToTables: (cb: (payload: unknown) => void) => {
      env.tableCallbacks.push(cb)
      env.subscribeToTables(cb)
      return () => {
        env.unsubscribes += 1
      }
    },
    subscribeToZones: () => () => {},
    subscribeToOrders: (cb: (payload: unknown) => void) => {
      env.orderCallbacks.push(cb)
      env.subscribeToOrders(cb)
      return () => {
        env.unsubscribes += 1
      }
    },
  },
}))

vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }))

import { WaiterView } from "./WaiterView"
import { ApiError } from "@/lib/api/errors"

// jsdom has no layout: WaiterView scrolls the menu into view after a table is
// picked, which jsdom does not implement.
Element.prototype.scrollIntoView = vi.fn()

const waiterProfile: Profile = { id: "w-1", name: "Ana", full_name: "Ana Gómez", role: "waiter" }
const adminProfile: Profile = { id: "admin-1", name: "Jefe", full_name: "Jefe", role: "admin" }

const waiterRows = [{ id: "w-1", name: "Ana Gómez", username: "ana" }]

const tableRow = (id: string, number: number, status = "available", waiterId: string | null = null) => ({
  id,
  number,
  status,
  waiterId,
  waiterName: null,
  createdAt: null,
  updatedAt: "2026-10-07T00:00:00.000Z",
})

function orderDto(id: string, tableId: string | null, orderType: "dine_in" | "delivery" = "dine_in") {
  return {
    id,
    tableId,
    orderType,
    status: "kitchen",
    subtotal: 100,
    tax: 0,
    taxPercentage: 0,
    tip: 0,
    tipPercentage: 0,
    total: 100,
    totalDiscounts: 0,
    waiterId: "w-1",
    isPartialOrder: false,
    parentOrderId: null,
    createdAt: "2026-10-07T00:00:00.000Z",
    updatedAt: null,
    items: [],
  }
}
const orderRow = orderDto

function renderView(profile: Profile = waiterProfile) {
  return render(
    <QueryClientProvider client={queryClient}>
      <WaiterView profile={profile} onChangeProfile={() => {}} />
    </QueryClientProvider>,
  )
}

const flush = async () => {
  // Drains the query promises and lets React Query notify, so the next
  // assertion sees the settled view.
  for (let tick = 0; tick < 3; tick += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
}

beforeEach(() => {
  env.reset()
  env.unsubscribes = 0
  queryClient.clear()
  useTableStore.setState({ tables: [] })
  useOrderStore.setState({ orders: [] })
  useCartStore.setState({ cartItems: {} })
  useProfileStore.setState({ authProfile: waiterProfile, selectedProfile: null })
})

describe("WaiterView — selecting a table does not rebuild the screen (T6/S2)", () => {
  it("subscribes to realtime once and never unsubscribes on a table selection", async () => {
    env.tableGetAll.mockResolvedValue([tableRow("t-1", 1), tableRow("t-2", 2)])
    renderView()
    await flush()

    expect(env.subscribeToTables).toHaveBeenCalledTimes(1)
    expect(env.subscribeToOrders).toHaveBeenCalledTimes(1)
    expect(env.unsubscribes).toBe(0)

    await act(async () => {
      screen.getByText("Mesa 1").click()
    })
    await flush()

    expect(env.subscribeToTables).toHaveBeenCalledTimes(1)
    expect(env.subscribeToOrders).toHaveBeenCalledTimes(1)
    expect(env.unsubscribes).toBe(0)

    // And again for a second table: still one subscription pair.
    await act(async () => {
      screen.getByText("Mesa 2").click()
    })
    await flush()

    expect(env.subscribeToTables).toHaveBeenCalledTimes(1)
    expect(env.subscribeToOrders).toHaveBeenCalledTimes(1)
    expect(env.unsubscribes).toBe(0)
  })

  it("does not read the waiters again on a table selection", async () => {
    env.tableGetAll.mockResolvedValue([tableRow("t-1", 1), tableRow("t-2", 2)])
    renderView()
    await flush()

    expect(env.waiterGetAll).toHaveBeenCalledTimes(1)

    await act(async () => {
      screen.getByText("Mesa 1").click()
    })
    await flush()

    expect(env.waiterGetAll).toHaveBeenCalledTimes(1)
  })

  it("does not read the waiters again when the waiter picker opens", async () => {
    env.tableGetAll.mockResolvedValue([tableRow("t-1", 1)])
    env.waiterGetAll.mockResolvedValue(waiterRows)
    renderView(adminProfile)
    await flush()

    expect(env.waiterGetAll).toHaveBeenCalledTimes(1)

    await act(async () => {
      screen.getByText("Mesa 1").click()
    })
    await flush()

    // The picker is served by the same shared query.
    expect(env.waiterGetAll).toHaveBeenCalledTimes(1)
    expect(await screen.findByText("Ana Gómez")).toBeInTheDocument()
  })

  it("does not re-read the menu when a second table is selected", async () => {
    env.tableGetAll.mockResolvedValue([tableRow("t-1", 1), tableRow("t-2", 2)])
    env.categories.mockResolvedValue([{ id: "cat-1", name: "Platos", icon: null }])
    env.dishesByCategory.mockResolvedValue([
      {
        id: "d-1",
        name: "Bandeja",
        price: 12000,
        categoryId: "cat-1",
        imageUrl: "/dish.png",
        originalPrice: null,
        discountAmount: null,
        discountPercentage: null,
        promotionId: null,
        promotionName: null,
      },
    ])
    renderView()
    await flush()

    await act(async () => {
      screen.getByText("Mesa 1").click()
    })
    await flush()
    expect(env.dishesByCategory).toHaveBeenCalledTimes(1)

    await act(async () => {
      screen.getByText("Mesa 2").click()
    })
    await flush()

    expect(env.categories).toHaveBeenCalledTimes(1)
    expect(env.dishesByCategory).toHaveBeenCalledTimes(1)
    // The previous table's menu stayed on screen: no skeletons for the new one.
    expect(screen.getByText("Bandeja")).toBeInTheDocument()
  })

  it("keeps assigning a free table to the signed-in waiter", async () => {
    env.tableGetAll.mockResolvedValue([tableRow("t-1", 1)])
    renderView()
    await flush()

    await act(async () => {
      screen.getByText("Mesa 1").click()
    })
    await flush()

    expect(env.assignWaiter).toHaveBeenCalledTimes(1)
    expect(env.assignWaiter).toHaveBeenCalledWith("t-1", "w-1")
  })
})

describe("WaiterView — zone map (T6)", () => {
  const zoneRow = (id: string, name: string, sortOrder: number) => ({
    id,
    name,
    aspect: 1.6,
    sortOrder,
    labels: [],
    active: true,
    createdAt: null,
    updatedAt: null,
  })
  const placedRow = (id: string, number: number, zoneId: string, status = "available", waiterId: string | null = null) => ({
    ...tableRow(id, number, status, waiterId),
    zoneId,
    x: 0.3,
    y: 0.4,
    w: 0.1,
    h: 0.1,
    shape: "round",
    rotation: 0,
    seats: 4,
  })

  it("draws the tables on their zone tabs instead of the grid", async () => {
    env.zoneGetAll.mockResolvedValue([zoneRow("z-1", "Salón principal", 0), zoneRow("z-2", "Terraza", 1)])
    env.tableGetAll.mockResolvedValue([placedRow("t-1", 1, "z-1"), placedRow("t-2", 2, "z-2")])
    renderView()
    await flush()

    expect(screen.getByRole("tab", { name: /Salón principal/ })).toHaveAttribute("aria-selected", "true")
    expect(screen.getByRole("button", { name: "Mesa 1, Libre, 4 sillas" })).toBeInTheDocument()
    expect(screen.queryByText("Distribución de Mesas")).not.toBeInTheDocument()

    await act(async () => {
      screen.getByRole("tab", { name: /Terraza/ }).click()
    })
    expect(screen.getByRole("button", { name: "Mesa 2, Libre, 4 sillas" })).toBeInTheDocument()
  })

  it("opens the table panel on a tap, with the table's actions", async () => {
    env.zoneGetAll.mockResolvedValue([zoneRow("z-1", "Salón principal", 0)])
    env.tableGetAll.mockResolvedValue([placedRow("t-1", 1, "z-1", "occupied", "w-1")])
    env.waiterGetAll.mockResolvedValue(waiterRows)
    env.categories.mockResolvedValue([{ id: "cat-1", name: "Platos", icon: null }])
    renderView()
    await flush()

    expect(screen.getByText("Toca una mesa para ver su pedido.")).toBeInTheDocument()

    await act(async () => {
      screen.getByRole("button", { name: /^Mesa 1,/ }).click()
    })
    await flush()

    const panel = screen.getByRole("region", { name: "Mesa 1" })
    expect(panel).toHaveTextContent("Ocupada")
    expect(panel).toHaveTextContent("Ana Gómez")
    expect(panel).toHaveTextContent("4 sillas")
    expect(screen.getByRole("button", { name: "Reservar" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Liberar mesa" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Agregar productos" })).toBeInTheDocument()
    // The add-items UI of today stays under the map.
    expect(screen.getByText("Menú")).toBeInTheDocument()

    // Freeing the table goes through the existing release handler.
    await act(async () => {
      screen.getByRole("button", { name: "Liberar mesa" }).click()
    })
    await flush()
    expect(env.releaseTable).toHaveBeenCalledWith("t-1", {})
  })
})

describe("WaiterView — S13 delivery invariant", () => {
  it("never lists a delivery order, neither on load nor on realtime", async () => {
    env.tableGetAll.mockResolvedValue([tableRow("t-1", 1)])
    env.orderGetByStatus.mockResolvedValue([
      orderRow("o-1", "t-1"),
      orderRow("d-1", null, "delivery"),
    ])
    renderView()
    await flush()

    await act(async () => {
      screen.getByRole("tab", { name: "Órdenes" }).click()
    })
    await flush()

    expect(screen.getByText("Mesa 1")).toBeInTheDocument()
    expect(screen.queryByText(/DOMICILIO/)).not.toBeInTheDocument()

    const cached = queryClient.getQueryData(["orders"]) as { id: string }[]
    expect(cached.map((order) => order.id)).toEqual(["o-1"])

    // A delivery INSERT arriving over realtime must not paint itself in either.
    await act(async () => {
      for (const cb of env.orderCallbacks) {
        await cb({ eventType: "INSERT", new: { id: "d-2", status: "kitchen", order_type: "delivery", table_id: null }, old: {} })
      }
    })
    await flush()

    const after = queryClient.getQueryData(["orders"]) as { id: string }[]
    expect(after.map((order) => order.id)).toEqual(["o-1"])
  })
})

describe("WaiterView — existing behavior (preserve)", () => {
  it("renders the tables hydrated from the query, with the waiter names", async () => {
    env.tableGetAll.mockResolvedValue([tableRow("t-1", 1, "occupied", "w-1"), tableRow("t-2", 2)])
    env.waiterGetAll.mockResolvedValue(waiterRows)
    renderView()
    await flush()

    expect(screen.getByText("Mesa 1")).toBeInTheDocument()
    expect(screen.getByText("Mesa 2")).toBeInTheDocument()
    expect(screen.getByText("Ana Gómez")).toBeInTheDocument()
  })

  it("clears the selection when the active table is released over realtime", async () => {
    // Already occupied by the signed-in waiter: no local write to echo.
    env.tableGetAll.mockResolvedValue([tableRow("t-1", 1, "occupied", "w-1")])
    env.categories.mockResolvedValue([{ id: "cat-1", name: "Platos", icon: null }])
    renderView()
    await flush()

    await act(async () => {
      screen.getByText("Mesa 1").click()
    })
    await flush()
    expect(screen.getByText("Menú")).toBeInTheDocument()

    await act(async () => {
      for (const cb of env.tableCallbacks) {
        await cb({ eventType: "UPDATE", new: { id: "t-1", status: "available" }, old: {} })
      }
    })
    await flush()

    // The menu unmounted with the selection.
    expect(screen.queryByText("Menú")).not.toBeInTheDocument()
  })

  it("skips the echo of a local table write instead of patching the store twice", async () => {
    env.tableGetAll.mockResolvedValue([tableRow("t-1", 1)])
    renderView()
    await flush()

    await act(async () => {
      screen.getByText("Mesa 1").click()
    })
    await flush()

    const stored = useTableStore.getState().tables.find((table) => table.id === "t-1")
    expect(stored?.status).toBe("occupied")

    await act(async () => {
      for (const cb of env.tableCallbacks) {
        await cb({ eventType: "UPDATE", new: { id: "t-1", status: "occupied" }, old: {} })
      }
    })
    await flush()

    expect(useTableStore.getState().tables.find((table) => table.id === "t-1")?.status).toBe("occupied")
  })

  it("reads tables and orders once on mount", async () => {
    renderView()
    await flush()

    expect(env.tableGetAll).toHaveBeenCalledTimes(1)
    expect(env.orderGetByStatus).toHaveBeenCalledTimes(1)
  })
})

/**
 * T6 advisory accepted: after a send the grid was still reading the stock it
 * loaded up to 30 s earlier (`staleTime`), so a dish that just sold out kept its
 * "Agregar" badge until the cache expired. The send paths now invalidate the
 * `['menu','stock', ...]` prefix, so the next render shows the new stock.
 */
describe("WaiterView — stock cache after sending to the kitchen (T6 advisory)", () => {
  // The order lines carry the dish uuid the server prices.
  const dishRow = {
    id: "d1d1d1d1-0000-4000-8000-000000000001",
    name: "Bandeja",
    price: 12000,
    category_id: "cat-1",
    image_url: "/dish.png",
    originalPrice: null,
    discountAmount: null,
    discountPercentage: null,
    promotionId: null,
    promotionName: null,
  }

  beforeEach(() => {
    useConfigStore.setState({ inventoryControlEnabled: true })
    env.tableGetAll.mockResolvedValue([tableRow("t-1", 1, "occupied", "w-1")])
    env.categories.mockResolvedValue([{ id: "cat-1", name: "Platos", icon: null }])
    env.dishesByCategory.mockResolvedValue([dishRow])
    // Sending the order (the API consumes the stock) is what makes the dish sell out.
    env.orderCreate.mockImplementation(async () => {
      env.stockSoldOut = true
      return orderDto("o-new", "t-1")
    })
  })

  afterEach(() => {
    useConfigStore.setState({ inventoryControlEnabled: false })
  })

  it("invalidates the stock queries after a send and reflects the new stock on the next render", async () => {
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries")

    renderView()
    await flush()

    // The menu of the selected table is on screen and the dish is available.
    await act(async () => {
      screen.getByText("Mesa 1").click()
    })
    await flush()
    expect(await screen.findByText("Bandeja")).toBeInTheDocument()
    expect(screen.queryAllByText("Agotado")).toHaveLength(0)
    expect(env.checkStockForDishes).toHaveBeenCalledTimes(1)

    // Add the dish to the cart and send the order to the kitchen.
    const card = screen.getByText("Bandeja").closest(".cursor-pointer") as HTMLElement
    await act(async () => {
      card.click()
    })
    await flush()
    await act(async () => {
      screen.getByRole("button", { name: /Enviar/ }).click()
    })
    await flush()

    expect(env.orderCreate).toHaveBeenCalledTimes(1)
    expect(env.sendCommand).toHaveBeenCalledTimes(1)
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["menu", "stock"] })

    // The stock read ran again for the same dish set (invalidated -> refetch).
    expect(env.checkStockForDishes).toHaveBeenCalledTimes(2)

    // Next render of the same menu shows the dish as sold out, not 30 s later.
    await act(async () => {
      screen.getByText("Mesa 1").click()
    })
    await flush()

    expect(await screen.findAllByText("Agotado")).not.toHaveLength(0)

    invalidateSpy.mockRestore()
  })
})
/**
 * T8b (S3, S4) — the order goes through `POST /orders`: the server prices
 * every line, checks and consumes the stock and moves the table, so the waiter
 * no longer calls `check_dishes_stock` / `consume_order_stock`. The screen acts
 * on the API's 409 bodies: a shortage opens the existing warning and "Enviar de
 * todos modos" resends with `force: true`; a changed price reprices the cart and
 * reloads the menu without resending; an open order on the table receives the
 * cart as added items.
 */
describe("WaiterView — sending through the API (T8b)", () => {
  const DISH = "11111111-1111-1111-1111-111111111111"
  const OTHER = "22222222-2222-2222-2222-222222222222"
  const line = (id: string, quantity: number, price = 12000) => ({
    id,
    name: id.startsWith(OTHER) ? "Sopa" : "Bandeja",
    price,
    quantity,
    categoryId: "cat-1",
    image: "/dish.png",
  })
  const items = [
    { dishId: DISH, quantity: 1, unitPrice: 12000, comments: null },
    { dishId: DISH, quantity: 2, unitPrice: 12000, comments: null },
    { dishId: OTHER, quantity: 1, unitPrice: 12000, comments: null },
  ]
  const conflict = (message: string, extra: Record<string, unknown>) =>
    new ApiError(409, "Conflict", message, { statusCode: 409, error: "Conflict", message, ...extra })
  const shortage = { ingredientId: "g-1", name: "Arroz", unit: "g", required: 300, available: 120, missing: 180 }

  beforeEach(() => {
    useConfigStore.setState({ inventoryControlEnabled: true })
    env.tableGetAll.mockResolvedValue([tableRow("t-1", 1, "occupied", "w-1")])
    useCartStore.setState({
      cartItems: { "t-1": [line(DISH, 1), line(`${DISH}-extra`, 2), line(OTHER, 1)] },
    })
  })

  afterEach(() => {
    useConfigStore.setState({ inventoryControlEnabled: false })
  })

  async function send() {
    renderView()
    await flush()
    await act(async () => {
      screen.getByText("Mesa 1").click()
    })
    await flush()
    await act(async () => {
      screen.getByRole("button", { name: /Enviar/ }).click()
    })
    await flush()
  }

  it("creates a dine-in order with the table, the shown prices and no client stock RPCs", async () => {
    await send()

    expect(env.orderCreate).toHaveBeenCalledTimes(1)
    expect(env.orderCreate).toHaveBeenCalledWith({ tableId: "t-1", orderType: "dine_in", items })
    expect(env.checkDishesStock).not.toHaveBeenCalled()
    expect(env.consumeOrderStock).not.toHaveBeenCalled()
    expect(env.updateTableStatus).not.toHaveBeenCalled()
    expect(env.sendCommand).toHaveBeenCalledTimes(1)
    expect(env.toastFn).toHaveBeenCalledWith(expect.objectContaining({ title: "Orden enviada" }))
    expect(useOrderStore.getState().orders.map((order) => order.id)).toEqual(["o-new"])
    expect(useCartStore.getState().cartItems["t-1"]).toEqual([])
  })

  it("shows the shortage warning from the 409 body and resends with force", async () => {
    env.orderCreate.mockRejectedValueOnce(conflict("Insufficient stock", { shortages: [shortage] }))
    await send()

    expect(screen.getByText("Advertencia de Inventario")).toBeInTheDocument()
    expect(screen.getByText("Arroz")).toBeInTheDocument()
    expect(screen.getByText("120 g")).toBeInTheDocument()
    expect(screen.getByText("300 g")).toBeInTheDocument()
    expect(env.sendCommand).not.toHaveBeenCalled()
    expect(env.toastFn).not.toHaveBeenCalledWith(expect.objectContaining({ title: "Error" }))

    await act(async () => {
      screen.getByRole("button", { name: "Enviar de todos modos" }).click()
      await new Promise((resolve) => setTimeout(resolve, 150))
    })
    await flush()

    expect(env.orderCreate).toHaveBeenCalledTimes(2)
    expect(env.orderCreate).toHaveBeenLastCalledWith({ tableId: "t-1", orderType: "dine_in", items, force: true })
    expect(env.sendCommand).toHaveBeenCalledTimes(1)
    expect(env.toastFn).toHaveBeenCalledWith(expect.objectContaining({ title: "Orden enviada" }))
  })

  it("on a changed price reprices the cart, reloads the menu and does not resend", async () => {
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries")
    env.orderCreate.mockRejectedValueOnce(
      conflict("Price changed", { prices: [{ dishId: DISH, price: 15000 }, { dishId: OTHER, price: 12000 }] }),
    )
    await send()

    expect(env.orderCreate).toHaveBeenCalledTimes(1)
    expect(env.sendCommand).not.toHaveBeenCalled()
    expect(env.toastFn).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Precios actualizados",
        description: "Algunos precios cambiaron. Revise el carrito y envíe de nuevo.",
      }),
    )
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["menu"] })
    expect(useCartStore.getState().cartItems["t-1"].map((item) => item.price)).toEqual([15000, 15000, 12000])
    invalidateSpy.mockRestore()
  })

  it("adds the cart to the table's open order when the API reports one", async () => {
    env.orderCreate.mockRejectedValueOnce(conflict("Table has an open order", { orderId: "o-9" }))
    await send()

    expect(env.orderCreate).toHaveBeenCalledTimes(1)
    expect(env.addItems).toHaveBeenCalledTimes(1)
    expect(env.addItems).toHaveBeenCalledWith("o-9", { items })
    expect(env.sendCommand).toHaveBeenCalledTimes(1)
    expect(env.toastFn).toHaveBeenCalledWith(expect.objectContaining({ title: "Productos adicionales enviados" }))
  })

  it("adds to the order it already lists for the table without creating another", async () => {
    env.orderGetByStatus.mockResolvedValue([orderDto("o-1", "t-1")])
    await send()

    expect(env.orderCreate).not.toHaveBeenCalled()
    expect(env.addItems).toHaveBeenCalledWith("o-1", { items })
    expect(env.toastFn).toHaveBeenCalledWith(expect.objectContaining({ title: "Productos adicionales enviados" }))
  })

  it("reads the open orders in ONE request for the three statuses", async () => {
    renderView()
    await flush()

    expect(env.orderGetByStatus).toHaveBeenCalledWith({ status: "active,kitchen,delivered" })
  })

  it("releases a table through the API and shows the API refusal", async () => {
    env.tableGetAll.mockResolvedValue([tableRow("t-1", 1, "occupied", "w-1")])
    useCartStore.setState({ cartItems: {} })
    env.releaseTable.mockRejectedValueOnce(
      new ApiError(409, "Conflict", "Table cannot be released while kitchen"),
    )
    renderView()
    await flush()

    // Selecting another table releases the empty, occupied one.
    env.tableGetAll.mockResolvedValue([tableRow("t-1", 1, "occupied", "w-1"), tableRow("t-2", 2, "occupied", "w-1")])
    useTableStore.setState({
      tables: [
        { id: "t-1", number: 1, status: "occupied", waiter: "w-1" },
        { id: "t-2", number: 2, status: "occupied", waiter: "w-1" },
      ],
    })
    await flush()
    await act(async () => {
      screen.getByText("Mesa 1").click()
    })
    await flush()
    await act(async () => {
      screen.getByText("Mesa 2").click()
    })
    await flush()

    expect(env.releaseTable).toHaveBeenCalledWith("t-1", {})
    expect(env.toastFn).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Error", description: "Table cannot be released while kitchen" }),
    )
  })
})

/**
 * T8b correction — the server's echoes can beat the HTTP response. A mark set
 * after the response is never consumed by its echo, and swallows the next real
 * change instead; orders are not marked at all (merging them is idempotent).
 */
describe("echo that beats the POST /orders response", () => {
  const DISH = "11111111-1111-1111-1111-111111111111"
  const tableEvent = (status: string, updatedAt: string) => ({
    eventType: "UPDATE",
    new: { id: "t-1", number: 1, status, waiter_id: "w-1", waiter_name: null, updated_at: updatedAt },
    old: { id: "t-1" },
  })
  const orderEvent = (eventType: string, status: string) => ({
    eventType,
    new: {
      id: "o-new",
      table_id: "t-1",
      waiter_id: "w-1",
      status,
      order_type: "dine_in",
      total: 100,
      created_at: "2026-10-07T00:00:00.000Z",
      order_items: [{ id: "i-1", order_id: "o-new", dish_id: DISH, name: "Bandeja", price: 12000, quantity: 1, status: "kitchen" }],
    },
    old: eventType === "INSERT" ? {} : { id: "o-new" },
  })
  const fire = async (callbacks: ((payload: unknown) => void)[], payload: unknown) => {
    for (const cb of callbacks) await cb(payload)
  }

  beforeEach(() => {
    env.tableGetAll.mockResolvedValue([tableRow("t-1", 1, "occupied", "w-1")])
    useCartStore.setState({
      cartItems: { "t-1": [{ id: DISH, name: "Bandeja", price: 12000, quantity: 1, categoryId: "cat-1", image: "" }] },
    })
  })

  async function send() {
    renderView()
    await flush()
    await act(async () => {
      screen.getByText("Mesa 1").click()
    })
    await flush()
    await act(async () => {
      screen.getByRole("button", { name: /Enviar/ }).click()
    })
    await flush()
  }

  it("applies the kitchen's served after the table echo arrived before the response", async () => {
    env.orderCreate.mockImplementation(async () => {
      await fire(env.tableCallbacks, tableEvent("kitchen", "2026-10-07T00:01:00.000Z"))
      return orderDto("o-new", "t-1")
    })
    await send()
    expect(useTableStore.getState().tables.find((t) => t.id === "t-1")?.status).toBe("kitchen")

    await act(async () => {
      await fire(env.tableCallbacks, tableEvent("served", "2026-10-07T00:02:00.000Z"))
    })
    await flush()

    expect(useTableStore.getState().tables.find((t) => t.id === "t-1")?.status).toBe("served")
  })

  it("forgets the table mark when the send fails", async () => {
    env.orderCreate.mockRejectedValue(new Error("boom"))
    await send()

    await act(async () => {
      await fire(env.tableCallbacks, tableEvent("served", "2026-10-07T00:02:00.000Z"))
    })
    await flush()

    expect(useTableStore.getState().tables.find((t) => t.id === "t-1")?.status).toBe("served")
  })

  it("keeps the delivered UPDATE that follows the order's INSERT and UPDATE", async () => {
    env.orderCreate.mockImplementation(async () => {
      await fire(env.orderCallbacks, orderEvent("INSERT", "kitchen"))
      await fire(env.orderCallbacks, orderEvent("UPDATE", "kitchen"))
      return orderDto("o-new", "t-1")
    })
    await send()

    await act(async () => {
      await fire(env.orderCallbacks, orderEvent("UPDATE", "delivered"))
    })
    await flush()

    const cached = queryClient.getQueryData(["orders"]) as { id: string; status: string }[]
    expect(cached.filter((order) => order.id === "o-new").map((order) => order.status)).toEqual(["delivered"])
  })

  it("lists the open order the cart went into after a Table has an open order", async () => {
    env.orderCreate.mockRejectedValueOnce(
      new ApiError(409, "Conflict", "Table has an open order", { message: "Table has an open order", orderId: "o-9" }),
    )
    await send()

    const cached = queryClient.getQueryData(["orders"]) as { id: string }[]
    expect(cached.map((order) => order.id)).toContain("o-9")
  })
})
