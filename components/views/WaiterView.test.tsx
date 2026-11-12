import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
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
  updateDetails: vi.fn(),
  tableGetAll: vi.fn(),
  zoneGetAll: vi.fn(),
  orderGetByStatus: vi.fn(),
  waiterGetAll: vi.fn(),
  categories: vi.fn(),
  dishesByCategory: vi.fn(),
  menuTree: vi.fn(),
  assignWaiter: vi.fn(),
  reserveTable: vi.fn(),
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
  promotionsToday: vi.fn(),
  pricingPreview: vi.fn(),
  /** true while the dish can be sold, false once the send has reduced stock. */
  stockSoldOut: false,
  tableCallbacks: [] as ((payload: unknown) => void)[],
  orderCallbacks: [] as ((payload: unknown) => void)[],
  reset() {
    this.addItems.mockReset()
    this.updateDetails.mockReset()
    this.tableGetAll.mockReset()
    this.zoneGetAll.mockReset()
    this.orderGetByStatus.mockReset()
    this.waiterGetAll.mockReset()
    this.categories.mockReset()
    this.dishesByCategory.mockReset()
    this.menuTree.mockReset()
    this.assignWaiter.mockReset()
    this.reserveTable.mockReset()
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
    this.promotionsToday.mockReset()
    this.pricingPreview.mockReset()
    // S11: without promotions data the order screen works at list prices.
    this.promotionsToday.mockRejectedValue(new Error("no promotions"))
    this.pricingPreview.mockRejectedValue(new Error("no preview"))
    this.stockSoldOut = false
    this.tableCallbacks = []
    this.orderCallbacks = []
    this.tableGetAll.mockResolvedValue([])
    this.zoneGetAll.mockResolvedValue([])
    this.orderGetByStatus.mockResolvedValue([])
    this.waiterGetAll.mockResolvedValue([])
    this.categories.mockResolvedValue([])
    this.dishesByCategory.mockResolvedValue([])
    this.menuTree.mockResolvedValue({ categories: [] })
    // The table DTO the floor actions answer with.
    const table = { id: "t-1", number: 1, status: "occupied", waiterId: "w-1", waiterName: null, createdAt: null, updatedAt: null }
    this.assignWaiter.mockResolvedValue(table)
    this.reserveTable.mockImplementation(async (id: string, body: { name: string }) => ({ ...table, id, status: "reserved", waiterId: null, reservationName: body.name }))
    this.updateTableStatus.mockResolvedValue(table)
    this.releaseTable.mockResolvedValue({ ...table, status: "available", waiterId: null })
    this.orderCreate.mockImplementation(async () => orderDto("o-new", "t-1"))
    this.addItems.mockImplementation(async (id: string) => orderDto(id, "t-1"))
    this.updateDetails.mockImplementation(async (id: string, body: object) => ({ ...orderDto(id, "t-1"), ...body }))
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
      case "POST /api/tables/{id}/reserve":
        return { data: await env.reserveTable(id, body) }
      case "POST /api/tables/{id}/release":
        return { data: await env.releaseTable(id, body) }
      case "PATCH /api/tables/{id}":
        return { data: await env.updateTableStatus(id, body) }
      case "POST /api/orders":
        return { data: await env.orderCreate(body) }
      case "POST /api/orders/{id}/items":
        return { data: await env.addItems(id, body) }
      case "PATCH /api/orders/{id}":
        return { data: await env.updateDetails(id, body) }
      case "GET /api/catalog/promotions/today":
        return { data: await env.promotionsToday(init.params.query) }
      case "POST /api/orders/pricing-preview":
        return { data: await env.pricingPreview(body) }
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
  getMenuTree: () => env.menuTree(),
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
const printing = vi.hoisted(() => ({ enabled: true }))
vi.mock("@/lib/api/printing", () => ({ usePrintingEnabled: () => printing.enabled }))

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

import { WaiterView, releaseRefusal } from "./WaiterView"
import { ApiError } from "@/lib/api/errors"
import { menuCategory, menuDish } from "@/lib/order-steps/fixtures"
import { formatCurrency } from "@/utils/helpers"
import { modifierGroup } from "@/lib/modifiers/fixtures"
import { active, happyHour, menuEjecutivo, other, today as todayDto } from "@/lib/promotions/fixtures"

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

function orderDto(id: string, tableId: string | null, orderType: "dine_in" | "takeaway" | "delivery" = "dine_in") {
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
  // assertion sees the settled view. Three ticks are the floor; under a
  // loaded full-suite run the reads can take longer, so it keeps ticking
  // (bounded) until no query is fetching instead of assuming a tick count.
  for (let tick = 0; tick < 200 && (tick < 3 || queryClient.isFetching() > 0); tick += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
}

/**
 * "Agregar productos" of the table panel opens the full-screen step flow
 * (T10). On a table without an open order it first asks the guests (T22):
 * "Sin indicar" keeps the create body as it was.
 */
const openOrderFlow = async () => {
  await act(async () => {
    screen.getByRole("button", { name: "Agregar productos" }).click()
  })
  await flush()
  const skip = screen.queryByRole("button", { name: "Sin indicar" })
  if (skip) {
    await act(async () => {
      skip.click()
    })
    await flush()
  }
}

const tap = async (name: string | RegExp) => {
  await act(async () => {
    screen.getByRole("button", { name }).click()
  })
  await flush()
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
    // reservas-mesas T2: a free table is taken by "Agregar productos".
    await tap("Agregar productos")

    // The picker is served by the same shared query.
    expect(env.waiterGetAll).toHaveBeenCalledTimes(1)
    expect(await screen.findByText("Ana Gómez")).toBeInTheDocument()
  })

  it("does not re-read the menu when a second table is selected", async () => {
    env.tableGetAll.mockResolvedValue([tableRow("t-1", 1, "occupied", "w-1"), tableRow("t-2", 2, "occupied", "w-1")])
    env.menuTree.mockResolvedValue({
      categories: [menuCategory({ id: "cat-1", name: "Platos", dishes: [menuDish({ id: "d-1", name: "Bandeja" })] })],
    })
    renderView()
    await flush()

    await act(async () => {
      screen.getByText("Mesa 1").click()
    })
    await flush()
    await openOrderFlow()
    expect(env.menuTree).toHaveBeenCalledTimes(1)
    await act(async () => {
      screen.getByRole("button", { name: "Mapa" }).click()
    })
    await flush()

    await act(async () => {
      screen.getByText("Mesa 2").click()
    })
    await flush()
    await openOrderFlow()

    // The second table's flow reads the cached tree: no request, no skeleton.
    expect(env.menuTree).toHaveBeenCalledTimes(1)
    expect(screen.getByRole("button", { name: /Platos/ })).toBeInTheDocument()
  })

  it("keeps assigning a free table to the signed-in waiter", async () => {
    env.tableGetAll.mockResolvedValue([tableRow("t-1", 1)])
    renderView()
    await flush()

    await act(async () => {
      screen.getByText("Mesa 1").click()
    })
    await flush()
    // reservas-mesas T2: the tap only selects a free table (it can still be
    // reserved); "Agregar productos" takes it.
    expect(env.assignWaiter).not.toHaveBeenCalled()
    await openOrderFlow()

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
    // reservas-mesas S1: an occupied table cannot be reserved.
    expect(screen.queryByRole("button", { name: "Reservar" })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Liberar mesa" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Agregar productos" })).toBeInTheDocument()
    // T10: the old menu under the map is gone; "Agregar productos" opens the step flow.
    expect(screen.queryByText("Menú")).not.toBeInTheDocument()

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

    // T29: the waiter has no orders tab; the map is the screen.
    expect(screen.queryByRole("tab", { name: "Órdenes" })).not.toBeInTheDocument()
    expect(screen.queryByRole("tab", { name: "Mesas" })).not.toBeInTheDocument()
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

describe("WaiterView — personal session header (F4b preserve)", () => {
  it("keeps its own header with Cerrar Sesión and Cambiar mi PIN on a personal session", async () => {
    renderView()
    await flush()
    expect(screen.getByRole("button", { name: /Cerrar Sesión/ })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Cambiar mi PIN/ })).toBeInTheDocument()
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
    env.menuTree.mockResolvedValue({ categories: [menuCategory({ id: "cat-1", name: "Platos" })] })
    renderView()
    await flush()

    await act(async () => {
      screen.getByText("Mesa 1").click()
    })
    await flush()
    await openOrderFlow()
    expect(screen.getByRole("heading", { name: "¿Qué categoría?" })).toBeInTheDocument()

    await act(async () => {
      for (const cb of env.tableCallbacks) {
        await cb({ eventType: "UPDATE", new: { id: "t-1", status: "available" }, old: {} })
      }
    })
    await flush()

    // The order flow closed with the selection.
    expect(screen.queryByRole("heading", { name: "¿Qué categoría?" })).not.toBeInTheDocument()
  })

  it("skips the echo of a local table write instead of patching the store twice", async () => {
    env.tableGetAll.mockResolvedValue([tableRow("t-1", 1)])
    renderView()
    await flush()

    await act(async () => {
      screen.getByText("Mesa 1").click()
    })
    await flush()
    // reservas-mesas T2: a free table is taken by "Agregar productos".
    await tap("Agregar productos")

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
  // The order lines carry the dish uuid the server prices; T10 reads "Agotado"
  // from the menu tree's `available`.
  const tree = () => ({
    categories: [
      menuCategory({
        id: "cat-1",
        name: "Platos",
        dishes: [menuDish({ id: STOCK_DISH, name: "Bandeja", price: 12000, available: !env.stockSoldOut })],
      }),
    ],
  })

  beforeEach(() => {
    useConfigStore.setState({ inventoryControlEnabled: true })
    env.tableGetAll.mockResolvedValue([tableRow("t-1", 1, "occupied", "w-1")])
    env.menuTree.mockImplementation(async () => tree())
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

    // The step flow of the selected table is on screen and the dish is available.
    await act(async () => {
      screen.getByText("Mesa 1").click()
    })
    await flush()
    await openOrderFlow()
    await tap(/Platos/)
    expect(screen.getByRole("button", { name: /^Bandeja,/ })).not.toHaveAttribute("aria-disabled")
    expect(screen.queryAllByText("Agotado")).toHaveLength(0)
    expect(env.menuTree).toHaveBeenCalledTimes(1)

    // Add the dish and send the order to the kitchen.
    await tap(/^Bandeja,/)
    await tap(/^Agregar 1 ·/)
    await tap("Enviar a cocina (1)")

    expect(env.orderCreate).toHaveBeenCalledTimes(1)
    expect(env.sendCommand).toHaveBeenCalledTimes(1)
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["menu", "stock"] })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["menu", "tree"] })

    // The next flow reads the tree again and shows the dish as sold out, not 30 s later.
    await act(async () => {
      screen.getByText("Mesa 1").click()
    })
    await flush()
    await openOrderFlow()
    await tap(/Platos/)

    expect(env.menuTree).toHaveBeenCalledTimes(2)
    expect(screen.getByRole("button", { name: /^Bandeja,.*agotado/ })).toHaveAttribute("aria-disabled", "true")

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

  it("sends the order but queues no comanda when the restaurant does not use printers (F6, S2)", async () => {
    printing.enabled = false
    try {
      await send()
      expect(env.orderCreate).toHaveBeenCalledTimes(1)
      expect(env.sendCommand).not.toHaveBeenCalled()
      expect(env.toastFn).toHaveBeenCalledWith(expect.objectContaining({ title: "Orden enviada" }))
    } finally {
      printing.enabled = true
    }
  })

  it("creates a dine-in order with the table, the shown prices and no client stock RPCs", async () => {
    await send()

    expect(env.orderCreate).toHaveBeenCalledTimes(1)
    expect(env.orderCreate).toHaveBeenCalledWith({ tableId: "t-1", orderType: "dine_in", items })
    expect(env.checkDishesStock).not.toHaveBeenCalled()
    expect(env.consumeOrderStock).not.toHaveBeenCalled()
    expect(env.updateTableStatus).not.toHaveBeenCalled()
    expect(env.sendCommand).toHaveBeenCalledTimes(1)
    // S1/S2: the comanda names its order; the API fills the waiter and the number.
    const [command] = env.sendCommand.mock.calls[0]
    expect(command).toEqual({ orderId: "o-new", table: expect.any(Number), items: expect.any(Array) })
    expect(JSON.stringify(command)).not.toContain("Mesero")
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
    expect(env.sendCommand).toHaveBeenCalledWith(expect.objectContaining({ orderId: "o-9" }))
    expect(env.toastFn).toHaveBeenCalledWith(expect.objectContaining({ title: "Productos adicionales enviados" }))
  })

  it("adds to the order it already lists for the table without creating another", async () => {
    env.orderGetByStatus.mockResolvedValue([orderDto("o-1", "t-1")])
    await send()

    expect(env.orderCreate).not.toHaveBeenCalled()
    expect(env.addItems).toHaveBeenCalledWith("o-1", { items })
    expect(env.sendCommand).toHaveBeenCalledWith(expect.objectContaining({ orderId: "o-1" }))
    expect(env.toastFn).toHaveBeenCalledWith(expect.objectContaining({ title: "Productos adicionales enviados" }))
  })

  it("reads the open orders in ONE request for the three statuses", async () => {
    renderView()
    await flush()

    expect(env.orderGetByStatus).toHaveBeenCalledWith({ status: "active,kitchen,delivered" })
  })

  it("releases a table through the API on a switch and does not toast its refusal (S1)", async () => {
    env.tableGetAll.mockResolvedValue([tableRow("t-1", 1, "occupied", "w-1")])
    useCartStore.setState({ cartItems: {} })
    env.releaseTable.mockRejectedValueOnce(
      new ApiError(409, "Conflict", "La mesa no se puede liberar mientras está en cocina"),
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
    expect(env.toastFn).not.toHaveBeenCalled()
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

/**
 * T10 (S5) — "Agregar productos" opens the full-screen step flow. What it adds
 * goes to the same cart, and "Enviar a cocina" goes through the same send
 * handler (create / add items, stock shortage, open order) as the cart.
 */
describe("WaiterView — step order flow (T10)", () => {
  const BANDEJA = "33333333-3333-4333-8333-333333333333"
  const ARROZ = "44444444-4444-4444-8444-444444444444"
  const menu = {
    categories: [
      menuCategory({
        id: "cat-1",
        name: "Platos fuertes",
        subcategories: [{ id: "sub-1", name: "Carnes" }],
        dishes: [menuDish({ id: BANDEJA, name: "Bandeja paisa", price: 32000, subcategoryId: "sub-1" })],
      }),
      menuCategory({ id: "cat-2", name: "Postres", dishes: [menuDish({ id: ARROZ, name: "Arroz con leche", price: 7000 })] }),
    ],
  }
  const shortage = { ingredientId: "g-1", name: "Arroz", unit: "g", required: 300, available: 120, missing: 180 }

  beforeEach(() => {
    useConfigStore.setState({ inventoryControlEnabled: true })
    env.tableGetAll.mockResolvedValue([tableRow("t-1", 1, "occupied", "w-1")])
    env.menuTree.mockResolvedValue(menu)
  })

  afterEach(() => {
    useConfigStore.setState({ inventoryControlEnabled: false })
  })

  async function addTwoItems() {
    renderView()
    await flush()
    await act(async () => {
      screen.getByText("Mesa 1").click()
    })
    await flush()
    await openOrderFlow()

    await tap(/Platos fuertes/)
    await tap(/Carnes/)
    await tap(/^Bandeja paisa,/)
    await tap("Sumar uno")
    await tap(/^Agregar 2 ·/)
    expect(env.toastFn).toHaveBeenCalledWith(expect.objectContaining({ title: "✓ 2× Bandeja paisa agregada" }))
    expect(screen.getByRole("heading", { name: "¿Qué categoría?" })).toBeInTheDocument()

    await tap(/Postres/)
    await tap(/^Arroz con leche,/)
    await tap(/^Agregar 1 ·/)
  }

  const items = [
    { dishId: BANDEJA, quantity: 2, unitPrice: 32000, comments: null },
    { dishId: ARROZ, quantity: 1, unitPrice: 7000, comments: null },
  ]

  it("adds two dishes through the steps to the table cart and sends them through the existing create path", async () => {
    await addTwoItems()

    expect(useCartStore.getState().cartItems["t-1"].map((item) => [item.name, item.quantity])).toEqual([
      ["Bandeja paisa", 2],
      ["Arroz con leche", 1],
    ])
    expect(screen.getByRole("button", { name: /Mesa 1, 3 productos, .*71\.000.*Ver pedido/ })).toBeInTheDocument()

    await tap("Enviar a cocina (3)")

    expect(env.orderCreate).toHaveBeenCalledTimes(1)
    expect(env.orderCreate).toHaveBeenCalledWith({ tableId: "t-1", orderType: "dine_in", items })
    expect(env.sendCommand).toHaveBeenCalledTimes(1)
    expect(env.toastFn).toHaveBeenCalledWith(expect.objectContaining({ title: "Orden enviada" }))
    expect(useCartStore.getState().cartItems["t-1"]).toEqual([])
    // Back on the map.
    expect(screen.queryByRole("heading", { name: "¿Qué categoría?" })).not.toBeInTheDocument()
    expect(screen.getByText("Mesa 1")).toBeInTheDocument()
  })

  it("Para llevar asks the name, takes the order with the steps on channel takeaway and sends it without a table (S8)", async () => {
    env.orderCreate.mockImplementation(async (body: object) => ({ ...orderDto("o-take", null), orderType: "takeaway", customerName: "Ana", ...body }))
    renderView()
    await flush()
    await tap("Para llevar")
    const dialog = screen.getByRole("dialog", { name: "Pedido para llevar" })
    fireEvent.change(within(dialog).getByLabelText("Nombre del cliente"), { target: { value: " A " } })
    await act(async () => within(dialog).getByRole("button", { name: "Tomar pedido" }).click())
    expect(within(dialog).getByText("El nombre debe tener entre 2 y 60 caracteres")).toBeInTheDocument()
    expect(within(dialog).getByLabelText("Nombre del cliente")).toHaveAttribute("aria-invalid", "true")

    fireEvent.change(within(dialog).getByLabelText("Nombre del cliente"), { target: { value: "  Ana  " } })
    fireEvent.change(within(dialog).getByLabelText(/Teléfono/), { target: { value: "315 000 1122" } })
    await act(async () => within(dialog).getByRole("button", { name: "Tomar pedido" }).click())
    await flush()

    expect(screen.queryByRole("dialog", { name: "Pedido para llevar" })).toBeNull()
    expect(screen.getByRole("heading", { name: "¿Qué categoría?" })).toBeInTheDocument()
    expect(screen.getAllByText("Para llevar · Ana").length).toBeGreaterThan(0)
    expect(env.promotionsToday).toHaveBeenCalledWith({ channel: "takeaway" })

    await tap(/Postres/)
    await tap(/^Arroz con leche,/)
    await tap(/^Agregar 1 ·/)
    await waitFor(() => expect(env.pricingPreview).toHaveBeenCalledWith(expect.objectContaining({ channel: "takeaway" })))

    await tap("Enviar a cocina (1)")
    expect(env.orderCreate).toHaveBeenCalledTimes(1)
    expect(env.orderCreate).toHaveBeenCalledWith({
      orderType: "takeaway",
      customerName: "Ana",
      customerPhone: "3150001122",
      items: [{ dishId: ARROZ, quantity: 1, unitPrice: 7000, comments: null }],
    })
    expect(env.sendCommand).toHaveBeenCalledWith({ orderId: "o-take", items: [expect.objectContaining({ name: "Arroz con leche" })] })
    expect(env.sendCommand.mock.calls[0][0]).not.toHaveProperty("table")
    expect(env.toastFn).toHaveBeenCalledWith(expect.objectContaining({ title: "Pedido para llevar enviado" }))
    // Back on the map; no table was touched.
    expect(screen.queryByRole("heading", { name: "¿Qué categoría?" })).not.toBeInTheDocument()
    expect(screen.getByText("Mesa 1")).toBeInTheDocument()
    expect(env.assignWaiter).not.toHaveBeenCalled()
  })

  it("lists the open takeaway orders and adds items to one with POST /orders/:id/items; a table is unaffected (S8)", async () => {
    env.orderGetByStatus.mockResolvedValue([
      { ...orderDto("o-take", null, "takeaway"), customerName: "Ana", status: "kitchen", total: 7000 },
      orderDto("o-1", "t-1"),
    ])
    renderView()
    await flush()
    const list = screen.getByRole("region", { name: "Pedidos para llevar" })
    const entry = within(list).getByRole("button", { name: /Para llevar · Ana/ })
    expect(entry).toHaveTextContent("En cocina")
    expect(entry.textContent).toContain(formatCurrency(7000))
    expect(within(list).getAllByRole("button")).toHaveLength(1)
    expect(screen.getByText("Mesa 1")).toBeInTheDocument()

    // A realtime UPDATE without order_type keeps the order a takeaway (still listed).
    await act(async () => {
      for (const cb of env.orderCallbacks) cb({ eventType: "UPDATE", new: { id: "o-take", status: "delivered" }, old: { id: "o-take" } })
    })
    await flush()
    expect(within(list).getByRole("button", { name: /Para llevar · Ana/ })).toHaveTextContent("Entregado")

    await act(async () => entry.click())
    await flush()
    expect(screen.getByRole("heading", { name: "¿Qué categoría?" })).toBeInTheDocument()
    await tap(/Postres/)
    await tap(/^Arroz con leche,/)
    await tap(/^Agregar 1 ·/)
    await tap(/^Enviar a cocina \(1\)/)
    expect(env.orderCreate).not.toHaveBeenCalled()
    expect(env.addItems).toHaveBeenCalledWith("o-take", {
      items: [{ dishId: ARROZ, quantity: 1, unitPrice: 7000, comments: null }],
    })
    expect(env.assignWaiter).not.toHaveBeenCalled()
  })

  it("Para llevar: Cancelar opens no flow and creates nothing (S8)", async () => {
    renderView()
    await flush()
    await tap("Para llevar")
    await tap("Cancelar")
    expect(screen.queryByRole("dialog", { name: "Pedido para llevar" })).toBeNull()
    expect(screen.queryByRole("heading", { name: "¿Qué categoría?" })).toBeNull()
    expect(env.orderCreate).not.toHaveBeenCalled()
  })

  it("sends the list price as unitPrice for a dish with an active promotion (S8)", async () => {
    env.menuTree.mockResolvedValue({
      categories: [
        menuCategory({
          id: "cat-2",
          name: "Postres",
          dishes: [
            menuDish({
              id: ARROZ,
              name: "Arroz con leche",
              price: 7000,
              promotionId: "p-1",
              promotionName: "Martes dulce",
              promotionBadge: "20%",
              promotionEndsAt: null,
              promoPrice: 5600,
            }),
          ],
        }),
      ],
    })
    renderView()
    await flush()
    await act(async () => {
      screen.getByText("Mesa 1").click()
    })
    await flush()
    await openOrderFlow()
    await tap(/Postres/)
    await tap(/^Arroz con leche,/)
    await tap(/^Agregar 1 ·/)
    await tap("Enviar a cocina (1)")

    expect(env.orderCreate).toHaveBeenCalledWith({
      tableId: "t-1",
      orderType: "dine_in",
      items: [{ dishId: ARROZ, quantity: 1, unitPrice: 7000, comments: null }],
    })
  })

  it("adds to the table's open order through the existing add-items path", async () => {
    env.orderCreate.mockRejectedValueOnce(
      new ApiError(409, "Conflict", "Table has an open order", { message: "Table has an open order", orderId: "o-9" }),
    )
    await addTwoItems()
    await tap("Enviar a cocina (3)")

    expect(env.addItems).toHaveBeenCalledWith("o-9", { items })
    expect(env.toastFn).toHaveBeenCalledWith(expect.objectContaining({ title: "Productos adicionales enviados" }))
  })

  it("keeps the stock shortage dialog and resends with force", async () => {
    env.orderCreate.mockRejectedValueOnce(
      new ApiError(409, "Conflict", "Insufficient stock", {
        statusCode: 409,
        error: "Conflict",
        message: "Insufficient stock",
        shortages: [shortage],
      }),
    )
    await addTwoItems()
    await tap("Enviar a cocina (3)")

    expect(screen.getByText("Advertencia de Inventario")).toBeInTheDocument()
    expect(screen.getByText("120 g")).toBeInTheDocument()
    expect(env.sendCommand).not.toHaveBeenCalled()
    // The flow stays open behind the dialog with the cart intact.
    expect(useCartStore.getState().cartItems["t-1"]).toHaveLength(2)

    await act(async () => {
      screen.getByRole("button", { name: "Enviar de todos modos" }).click()
      await new Promise((resolve) => setTimeout(resolve, 150))
    })
    await flush()

    expect(env.orderCreate).toHaveBeenCalledTimes(2)
    expect(env.orderCreate).toHaveBeenLastCalledWith({ tableId: "t-1", orderType: "dine_in", items, force: true })
    expect(env.sendCommand).toHaveBeenCalledTimes(1)
  })

  it("offers the tree's dishes without category under Otros with their real stock (T22)", async () => {
    const LOOSE = "55555555-5555-4555-8555-555555555555"
    const GONE = "66666666-6666-4666-8666-666666666666"
    env.menuTree.mockResolvedValue({
      ...menu,
      uncategorized: [
        menuDish({ id: LOOSE, name: "Porción de arroz", price: 4000 }),
        menuDish({ id: GONE, name: "Empanada", price: 3000, available: false }),
      ],
    })
    renderView()
    await flush()
    await act(async () => {
      screen.getByText("Mesa 1").click()
    })
    await flush()
    await openOrderFlow()

    await tap(/^Otros/)
    expect(screen.getByRole("button", { name: /^Empanada, .*agotado$/ })).toHaveAttribute("aria-disabled", "true")
    await tap(/^Porción de arroz,/)
    await tap(/^Agregar 1 ·/)
    expect(useCartStore.getState().cartItems["t-1"].map((item) => item.name)).toEqual(["Porción de arroz"])
    // The dishes list is not read any more for "Otros".
    expect(env.dishesByCategory).not.toHaveBeenCalled()
  })

  it("undoes an add from the toast", async () => {
    await addTwoItems()
    const added = env.toastFn.mock.calls.filter(([arg]) => arg.title === "✓ 1× Arroz con leche agregada")
    expect(added).toHaveLength(1)
    await act(async () => {
      added[0][0].action.props.onClick()
    })
    await flush()

    expect(useCartStore.getState().cartItems["t-1"].map((item) => item.name)).toEqual(["Bandeja paisa"])
  })

  it("Ver pedido shows the sent and the new lines, edits the new ones and undoes a removal", async () => {
    const sent = { ...orderDto("o-1", "t-1"), items: [] as unknown[] }
    sent.items = [
      { id: "i-1", orderId: "o-1", dishId: ARROZ, name: "Ajiaco", price: 28000, quantity: 1, status: "kitchen", comments: null },
    ]
    env.orderGetByStatus.mockResolvedValue([sent])
    await addTwoItems()

    await tap(/Ver pedido/)
    const fresh = screen.getByRole("region", { name: "Nuevos" })
    const already = screen.getByRole("region", { name: "Enviados" })
    expect(fresh).toHaveTextContent("Bandeja paisa")
    expect(fresh).toHaveTextContent("Arroz con leche")
    expect(already).toHaveTextContent("Ajiaco")
    expect(within(already).queryByRole("button")).not.toBeInTheDocument()

    await act(async () => {
      within(fresh).getByRole("button", { name: "Sumar uno a Arroz con leche" }).click()
    })
    await flush()
    expect(useCartStore.getState().cartItems["t-1"].find((item) => item.name === "Arroz con leche")?.quantity).toBe(2)

    await act(async () => {
      within(fresh).getByRole("button", { name: "Quitar Bandeja paisa" }).click()
    })
    await flush()
    expect(useCartStore.getState().cartItems["t-1"].map((item) => item.name)).toEqual(["Arroz con leche"])
    const removed = env.toastFn.mock.calls.find(([arg]) => arg.title === "Quitaste 2× Bandeja paisa")
    expect(removed).toBeDefined()
    await act(async () => {
      removed![0].action.props.onClick()
    })
    await flush()
    expect(useCartStore.getState().cartItems["t-1"].map((item) => item.name)).toEqual(["Bandeja paisa", "Arroz con leche"])

    // The send counts only the new lines; it goes to the order already listed.
    await tap("Enviar a cocina (4)")
    expect(env.orderCreate).not.toHaveBeenCalled()
    expect(env.addItems).toHaveBeenCalledWith("o-1", {
      items: [items[0], { ...items[1], quantity: 2 }],
    })
  })
})

describe("WaiterView — guests, order note, sent time and order number (T22)", () => {
  const BANDEJA = "33333333-3333-4333-8333-333333333333"
  const menu = {
    categories: [
      menuCategory({ id: "cat-2", name: "Postres", dishes: [menuDish({ id: BANDEJA, name: "Arroz con leche", price: 7000 })] }),
    ],
    uncategorized: [],
  }
  const item = { dishId: BANDEJA, quantity: 1, unitPrice: 7000, comments: null }
  const sentAt = new Date(2026, 10, 6, 19, 48, 12)
  const openOrder = () => ({
    ...orderDto("o-1", "t-1"),
    orderNumber: 128,
    guests: 4,
    notes: "Cumpleaños",
    items: [
      {
        id: "i-1",
        orderId: "o-1",
        dishId: BANDEJA,
        name: "Ajiaco",
        price: 28000,
        quantity: 1,
        status: "kitchen",
        comments: null,
        addedAt: sentAt.toISOString(),
      },
    ],
  })

  beforeEach(() => {
    env.tableGetAll.mockResolvedValue([{ ...tableRow("t-1", 1, "occupied", "w-1"), seats: 4 }])
    env.menuTree.mockResolvedValue(menu)
    env.orderCreate.mockImplementation(async () => ({ ...orderDto("o-new", "t-1"), orderNumber: 129 }))
  })

  const selectTable = async () => {
    renderView()
    await flush()
    await act(async () => {
      screen.getByText("Mesa 1").click()
    })
    await flush()
  }
  const addOne = async () => {
    await tap(/Postres/)
    await tap(/^Arroz con leche,/)
    await tap(/^Agregar 1 ·/)
  }

  it("asks the guests with a stepper on the first Agregar productos and sends them with the new order", async () => {
    await selectTable()
    await tap("Agregar productos")

    const dialog = screen.getByRole("dialog", { name: "¿Cuántas personas?" })
    // Starts at the table's chairs.
    expect(within(dialog).getByRole("status")).toHaveTextContent("4")
    await act(async () => {
      within(dialog).getByRole("button", { name: "Sumar una persona" }).click()
    })
    expect(within(dialog).getByRole("status")).toHaveTextContent("5")
    await act(async () => {
      within(dialog).getByRole("button", { name: "Continuar" }).click()
    })
    await flush()

    expect(screen.getByText("Mesa 1 · 5 personas")).toBeInTheDocument()
    await addOne()
    await tap("Enviar a cocina (1)")
    expect(env.orderCreate).toHaveBeenCalledWith({ tableId: "t-1", orderType: "dine_in", items: [item], guests: 5 })
    // The toast names the database order number, not an invented one.
    expect(env.toastFn).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Orden enviada", description: "La orden #129 ha sido enviada a cocina." }),
    )
  })

  it("Sin indicar sends the new order without guests and does not ask again while the cart is open", async () => {
    await selectTable()
    await openOrderFlow()
    await tap("Volver al mapa del salón")
    await tap("Agregar productos")
    expect(screen.queryByRole("dialog", { name: "¿Cuántas personas?" })).not.toBeInTheDocument()
    await addOne()
    await tap("Enviar a cocina (1)")
    expect(env.orderCreate).toHaveBeenCalledWith({ tableId: "t-1", orderType: "dine_in", items: [item] })
  })

  it("sends the order note typed in Ver pedido with the new order", async () => {
    await selectTable()
    await openOrderFlow()
    await addOne()
    await tap(/Ver pedido/)
    const note = screen.getByLabelText("Nota del pedido (opcional)")
    await act(async () => {
      fireEvent.change(note, { target: { value: "  Alérgico al maní " } })
    })
    await tap("Enviar a cocina (1)")
    expect(env.orderCreate).toHaveBeenCalledWith({ tableId: "t-1", orderType: "dine_in", items: [item], notes: "Alérgico al maní" })
  })

  it("an open order shows its number, guests and note, and edits them through PATCH /orders/:id", async () => {
    env.orderGetByStatus.mockResolvedValue([openOrder()])
    env.updateDetails.mockImplementation(async (_id: string, body: object) => ({ ...openOrder(), ...body }))
    await selectTable()

    const panel = screen.getByRole("region", { name: "Mesa 1" })
    expect(panel).toHaveTextContent("#128")
    expect(within(panel).getByRole("status")).toHaveTextContent("4")
    await act(async () => {
      within(panel).getByRole("button", { name: "Sumar una persona" }).click()
    })
    await flush()
    expect(env.updateDetails).toHaveBeenCalledWith("o-1", { guests: 5 })
    expect(within(screen.getByRole("region", { name: "Mesa 1" })).getByRole("status")).toHaveTextContent("5")

    // No guests question: the order exists.
    await tap("Agregar productos")
    expect(screen.queryByRole("dialog", { name: "¿Cuántas personas?" })).not.toBeInTheDocument()
    expect(screen.getByText("Mesa 1 · 5 personas")).toBeInTheDocument()

    await tap(/Ver pedido/)
    expect(screen.getByText("#128")).toBeInTheDocument()
    expect(screen.getByRole("region", { name: "Enviados" })).toHaveTextContent("Enviado a cocina · 19:48")
    const note = screen.getByLabelText("Nota del pedido (opcional)")
    expect(note).toHaveValue("Cumpleaños")
    expect(screen.getByRole("button", { name: "Guardar nota" })).toBeDisabled()
    await act(async () => {
      fireEvent.change(note, { target: { value: "Cumpleaños, traer vela" } })
    })
    await tap("Guardar nota")
    expect(env.updateDetails).toHaveBeenLastCalledWith("o-1", { notes: "Cumpleaños, traer vela" })
    expect(env.addItems).not.toHaveBeenCalled()
  })

  it("entering a table with an open order shows its sent lines, state, send time, note and total (T29)", async () => {
    const later = new Date(2026, 10, 6, 20, 5, 0)
    env.orderGetByStatus.mockResolvedValue([
      {
        ...openOrder(),
        // The bill total (tax and tip included), not the sum of the lines.
        subtotal: 42_000,
        total: 49_560,
        items: [
          { ...openOrder().items[0], status: "served" },
          {
            id: "i-2",
            orderId: "o-1",
            dishId: BANDEJA,
            name: "Arroz con leche",
            price: 7000,
            quantity: 2,
            status: "kitchen",
            comments: "Sin canela",
            addedAt: later.toISOString(),
          },
        ],
      },
    ])
    await selectTable()

    const current = within(screen.getByRole("region", { name: "Mesa 1" })).getByRole("region", { name: "Pedido en curso" })
    const groups = within(current).getAllByRole("list")
    expect(groups).toHaveLength(2)
    expect(current).toHaveTextContent("Enviado a cocina · 19:48")
    expect(current).toHaveTextContent("Enviado a cocina · 20:05")
    expect(groups[0]).toHaveTextContent("1× Ajiaco")
    expect(groups[0]).toHaveTextContent("Servido")
    expect(groups[1]).toHaveTextContent("2× Arroz con leche")
    expect(groups[1]).toHaveTextContent("“Sin canela”")
    expect(groups[1]).toHaveTextContent("En cocina")
    expect(current).toHaveTextContent("Cumpleaños")
    expect(current).toHaveTextContent(/Total\s*\$\s?49\.560/)
    // Read only: no quantity controls in the panel.
    expect(within(current).queryByRole("button")).not.toBeInTheDocument()
  })

  it("a table without an open order shows no order in progress (T29)", async () => {
    await selectTable()
    expect(screen.getByRole("region", { name: "Mesa 1" })).toBeInTheDocument()
    expect(screen.queryByRole("region", { name: "Pedido en curso" })).not.toBeInTheDocument()
  })

  it("an unsaved note change on an open order goes with the add-items send", async () => {
    env.orderGetByStatus.mockResolvedValue([openOrder()])
    await selectTable()
    await tap("Agregar productos")
    await addOne()
    await tap(/Ver pedido/)
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Nota del pedido (opcional)"), { target: { value: "Sin prisa" } })
    })
    await tap("Enviar a cocina (1)")
    expect(env.addItems).toHaveBeenCalledWith("o-1", { items: [item], notes: "Sin prisa" })
  })

  it("sends an unsaved open-order note with exactly one add-items", async () => {
    let listed = { ...openOrder(), notes: null as string | null }
    env.orderGetByStatus.mockImplementation(async () => [listed])
    env.addItems.mockImplementation(
      async (_id: string, body: any) => (listed = { ...listed, ...("notes" in body ? { notes: body.notes } : {}) }),
    )
    await selectTable()
    await tap("Agregar productos")
    await addOne()
    await tap(/Ver pedido/)
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Nota del pedido (opcional)"), { target: { value: "Sin prisa" } })
    })
    await tap("Enviar a cocina (1)")
    await act(async () => {
      screen.getByText("Mesa 1").click()
    })
    await flush()
    await tap("Agregar productos")
    await addOne()
    await tap("Enviar a cocina (1)")
    expect(env.addItems.mock.calls.map(([, b]: any) => b)).toEqual([{ items: [item], notes: "Sin prisa" }, { items: [item] }])
    expect(env.updateDetails).not.toHaveBeenCalled()
  })

  it("a blank order note adds no notes key", async () => {
    await selectTable()
    await openOrderFlow()
    await addOne()
    await tap(/Ver pedido/)
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Nota del pedido (opcional)"), { target: { value: "   " } })
    })
    await tap("Enviar a cocina (1)")
    expect(env.orderCreate).toHaveBeenCalledWith({ tableId: "t-1", orderType: "dine_in", items: [item] })
  })

  it("S5: the line comment is the free note only; merge on same dish + note; undo of merge", async () => {
    const A = "aaaaaaaa-1111-4111-8111-111111111111"
    env.menuTree.mockResolvedValue({
      categories: [menuCategory({ id: "cat-1", name: "Platos", dishes: [menuDish({ id: A, name: "Bandeja", price: 30000 })] })],
      uncategorized: [],
    })
    const cart = () => (useCartStore.getState().cartItems["t-1"] ?? []).map((l) => [l.name, l.quantity, l.comments ?? null])
    const pick = async (qty: number, note: string | undefined) => {
      await tap(/^Platos/)
      await tap(/^Bandeja,/)
      for (let i = 1; i < qty; i += 1) await tap("Sumar uno")
      if (note !== undefined) fireEvent.change(screen.getByLabelText(/Nota para cocina/), { target: { value: note } })
      await tap(new RegExp(`^Agregar ${qty} ·`))
    }
    await selectTable()
    await openOrderFlow()
    expect(screen.queryByText("Indicaciones rápidas")).not.toBeInTheDocument()
    await pick(1, "rápido")
    await pick(2, " rápido ")
    await pick(1, undefined)
    expect(cart()).toEqual([
      ["Bandeja", 3, "rápido"],
      ["Bandeja", 1, null],
    ])
    const undo = env.toastFn.mock.calls.filter(([a]: any) => a.title === "✓ 2× Bandeja agregada")[0][0].action.props.onClick
    await act(async () => undo())
    await flush()
    expect(cart()[0]).toEqual(["Bandeja", 1, "rápido"])
  })

  it("refuses a new order on an inactive table without assigning it", async () => {
    env.tableGetAll.mockResolvedValue([{ ...tableRow("t-1", 1), isActive: false }])
    renderView()
    await flush()
    await act(async () => {
      screen.getByRole("button", { name: /^Mesa 1/ }).click()
    })
    await flush()
    expect(env.assignWaiter).not.toHaveBeenCalled()
    expect(env.toastFn).toHaveBeenCalledWith(expect.objectContaining({ title: "La mesa está inactiva" }))
    expect(screen.queryByRole("button", { name: "Agregar productos" })).not.toBeInTheDocument()
  })

  it("shows the API refusal of an inactive table on send", async () => {
    env.orderCreate.mockRejectedValueOnce(new ApiError(409, "Conflict", "La mesa está inactiva", { message: "La mesa está inactiva" }))
    await selectTable()
    await openOrderFlow()
    await addOne()
    await tap("Enviar a cocina (1)")
    expect(env.toastFn).toHaveBeenCalledWith(expect.objectContaining({ description: "La mesa está inactiva" }))
  })
})

describe("WaiterView — elapsed time on the map (T22)", () => {
  it("draws the minutes since the open order started on its table", async () => {
    env.zoneGetAll.mockResolvedValue([
      { id: "z-1", name: "Salón principal", aspect: 1.6, sortOrder: 0, labels: [], active: true, createdAt: null, updatedAt: null },
    ])
    const placed = (id: string, number: number, status: string, waiterId: string | null) => ({
      ...tableRow(id, number, status, waiterId),
      zoneId: "z-1",
      x: number / 4,
      y: 0.4,
      w: 0.1,
      h: 0.1,
      shape: "round",
      rotation: 0,
      seats: 4,
    })
    env.tableGetAll.mockResolvedValue([placed("t-1", 1, "kitchen", "w-1"), placed("t-2", 2, "available", null)])
    env.orderGetByStatus.mockResolvedValue([
      { ...orderDto("o-1", "t-1"), createdAt: new Date(Date.now() - 18 * 60_000 - 5_000).toISOString() },
    ])
    renderView()
    await flush()
    expect(screen.getByRole("button", { name: /^Mesa 1, En cocina, .*abierta hace 18 min$/ })).toHaveTextContent("18 min")
    expect(screen.getByRole("button", { name: /^Mesa 2,/ })).not.toHaveTextContent("min")
  })
})

describe("WaiterView — F3 anular plato y cancelar orden", () => {
  const zoneRow = (id: string, name: string, sortOrder: number) => ({
    id, name, aspect: 1.6, sortOrder, labels: [], active: true, createdAt: null, updatedAt: null,
  })
  const placedRow = (id: string, number: number, zoneId: string, status: string, waiterId: string) => ({
    ...tableRow(id, number, status, waiterId), zoneId, x: 0.3, y: 0.4, w: 0.1, h: 0.1, shape: "round", rotation: 0, seats: 4,
  })
  const sentItem = (id: string, name: string, quantity: number) => ({
    id,
    orderId: "o-1",
    dishId: STOCK_DISH,
    name,
    price: 32900,
    quantity,
    comments: null,
    status: "kitchen",
    addedAt: "2026-10-07T00:01:00.000Z",
    createdAt: null,
    updatedAt: null,
  })

  it("offers 'Anular plato' per sent line and 'Cancelar orden', each opening the step sheet", async () => {
    env.zoneGetAll.mockResolvedValue([zoneRow("z-1", "Salón principal", 0)])
    env.tableGetAll.mockResolvedValue([placedRow("t-1", 1, "z-1", "kitchen", "w-1")])
    env.waiterGetAll.mockResolvedValue(waiterRows)
    env.orderGetByStatus.mockResolvedValue([{ ...orderDto("o-1", "t-1"), orderNumber: 128, items: [sentItem("i-1", "Bandeja paisa", 2)] }])
    renderView()
    await flush()
    await tap(/^Mesa 1,/)

    await tap("Anular Bandeja paisa")
    expect(screen.getByRole("heading", { name: "¿Qué plato y por qué?" })).toBeInTheDocument()
    expect(screen.getByText("Anular plato · #128 · Mesa 1")).toBeInTheDocument()
    await tap("Cerrar")

    await tap("Cancelar orden")
    expect(screen.getByRole("heading", { name: "¿Por qué se cancela?" })).toBeInTheDocument()
  })

  it("does not offer voids on a table without a sent order (PRESERVE)", async () => {
    env.zoneGetAll.mockResolvedValue([zoneRow("z-1", "Salón principal", 0)])
    env.tableGetAll.mockResolvedValue([placedRow("t-1", 1, "z-1", "occupied", "w-1")])
    env.waiterGetAll.mockResolvedValue(waiterRows)
    renderView()
    await flush()
    await tap(/^Mesa 1,/)
    expect(screen.getByRole("button", { name: "Agregar productos" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Cancelar orden" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /^Anular / })).not.toBeInTheDocument()
  })

  it("a realtime UPDATE with its lines drops the voided one live", async () => {
    env.tableGetAll.mockResolvedValue([tableRow("t-1", 1, "kitchen", "w-1")])
    env.orderGetByStatus.mockResolvedValue([
      { ...orderDto("o-1", "t-1"), items: [sentItem("i-1", "Bandeja paisa", 2), sentItem("i-2", "Limonada", 1)] },
    ])
    renderView()
    await flush()
    await act(async () => {
      for (const cb of env.orderCallbacks) {
        await cb({
          eventType: "UPDATE",
          new: {
            id: "o-1",
            status: "kitchen",
            table_id: "t-1",
            order_items: [
              { ...sentItem("i-1", "Bandeja paisa", 2), order_id: "o-1" },
              { ...sentItem("i-2", "Limonada", 0), order_id: "o-1", status: "cancelled" },
            ],
          },
          old: {},
        })
      }
    })
    await flush()
    const cached = queryClient.getQueryData(["orders"]) as { id: string; items: { id: string }[] }[]
    expect(cached.find((order) => order.id === "o-1")?.items.map((item) => item.id)).toEqual(["i-1"])
  })

  it("a realtime UPDATE without lines keeps the loaded ones (PRESERVE)", async () => {
    env.tableGetAll.mockResolvedValue([tableRow("t-1", 1, "kitchen", "w-1")])
    env.orderGetByStatus.mockResolvedValue([{ ...orderDto("o-1", "t-1"), items: [sentItem("i-1", "Bandeja paisa", 2)] }])
    renderView()
    await flush()
    const before = (queryClient.getQueryData(["orders"]) as { id: string; items: unknown[] }[])[0].items
    await act(async () => {
      for (const cb of env.orderCallbacks) await cb({ eventType: "UPDATE", new: { id: "o-1", status: "delivered", table_id: "t-1" }, old: {} })
    })
    await flush()
    const after = (queryClient.getQueryData(["orders"]) as { id: string; items: unknown[]; status: string }[])[0]
    expect(after.items).toBe(before)
    expect(after.status).toBe("delivered")
  })

  it("a realtime INSERT never paints a 0-unit cancelled line", async () => {
    env.tableGetAll.mockResolvedValue([tableRow("t-1", 1)])
    renderView()
    await flush()
    await act(async () => {
      for (const cb of env.orderCallbacks) {
        await cb({
          eventType: "INSERT",
          new: {
            id: "o-9",
            status: "kitchen",
            order_type: "dine_in",
            table_id: "t-1",
            order_items: [
              { id: "live", name: "Ajiaco", price: 1, quantity: 1, status: "kitchen" },
              { id: "gone", name: "Limonada", price: 1, quantity: 0, status: "cancelled" },
            ],
          },
          old: {},
        })
      }
    })
    await flush()
    const cached = queryClient.getQueryData(["orders"]) as { id: string; items: { id: string }[] }[]
    expect(cached.find((order) => order.id === "o-9")?.items.map((item) => item.id)).toEqual(["live"])
  })
})

describe("WaiterView — reservations (reservas-mesas T2, S1, S2, S5)", () => {
  const zone = { id: "z-1", name: "Salón principal", aspect: 1.6, sortOrder: 0, labels: [], active: true, createdAt: null, updatedAt: null }
  const placed = (status: string, extra: object = {}) => ({
    ...tableRow("t-1", 1, status, status === "occupied" ? "w-1" : null),
    zoneId: "z-1", x: 0.3, y: 0.4, w: 0.1, h: 0.1, shape: "round", rotation: 0, seats: 4,
    ...extra,
  })

  it("Reservar on a free table opens the reserve sheet and reserves it, never assigning a waiter", async () => {
    env.zoneGetAll.mockResolvedValue([zone])
    env.tableGetAll.mockResolvedValue([placed("available")])
    renderView()
    await flush()
    await tap(/^Mesa 1,/)
    expect(env.assignWaiter).not.toHaveBeenCalled()

    await tap("Reservar")
    expect(screen.queryByText("Seleccionar Mesero")).not.toBeInTheDocument()
    const sheet = screen.getByRole("dialog")
    expect(within(sheet).getByRole("heading", { name: "Reservar mesa 1" })).toBeInTheDocument()
    fireEvent.change(within(sheet).getByLabelText("¿A nombre de quién?"), { target: { value: "Familia López" } })
    await act(async () => {
      fireEvent.click(within(sheet).getByRole("button", { name: "Reservar" }))
    })
    await flush()

    expect(env.reserveTable).toHaveBeenCalledWith("t-1", { name: "Familia López" })
    expect(env.assignWaiter).not.toHaveBeenCalled()
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    const panel = screen.getByRole("region", { name: "Mesa 1" })
    expect(panel).toHaveTextContent("Reservada")
    expect(panel).toHaveTextContent("Reserva: Familia López")
    expect(within(panel).getByRole("button", { name: "Sentar clientes" })).toBeInTheDocument()
  })

  it("a reserved table: the tap only selects it; Sentar clientes seats it through assign", async () => {
    env.zoneGetAll.mockResolvedValue([zone])
    env.tableGetAll.mockResolvedValue([placed("reserved", { reservationName: "Familia López" })])
    renderView()
    await flush()
    await tap(/^Mesa 1,/)
    expect(env.assignWaiter).not.toHaveBeenCalled()
    expect(screen.getByRole("region", { name: "Mesa 1" })).toHaveTextContent("Reserva: Familia López")

    await tap("Sentar clientes")
    expect(env.assignWaiter).toHaveBeenCalledWith("t-1", "w-1")
    expect(env.reserveTable).not.toHaveBeenCalled()
  })

  it("a tap alone on a free table does not call assign (user's answer A)", async () => {
    env.zoneGetAll.mockResolvedValue([zone])
    env.tableGetAll.mockResolvedValue([placed("available")])
    renderView()
    await flush()
    await tap(/^Mesa 1,/)

    expect(env.assignWaiter).not.toHaveBeenCalled()
    const panel = screen.getByRole("region", { name: "Mesa 1" })
    expect(panel).toHaveTextContent("Libre")
    expect(within(panel).getByRole("button", { name: "Agregar productos" })).toBeInTheDocument()
    expect(within(panel).getByRole("button", { name: "Reservar" })).toBeInTheDocument()
  })

  it("admin: Agregar productos on a free table picks the waiter, assigns and goes on to the guests", async () => {
    env.zoneGetAll.mockResolvedValue([zone])
    env.tableGetAll.mockResolvedValue([placed("available")])
    env.waiterGetAll.mockResolvedValue(waiterRows)
    renderView(adminProfile)
    await flush()
    await tap(/^Mesa 1,/)
    expect(env.assignWaiter).not.toHaveBeenCalled()

    await tap("Agregar productos")
    expect(screen.getByText("Seleccionar Mesero")).toBeInTheDocument()
    await act(async () => {
      screen.getByText("Ana Gómez").click()
    })
    await flush()
    expect(env.assignWaiter).toHaveBeenCalledWith("t-1", "w-1")
    expect(screen.getByRole("button", { name: "Sin indicar" })).toBeInTheDocument()
  })

  it("Cancelar reserva releases a reserved table (no refusal toast)", async () => {
    env.zoneGetAll.mockResolvedValue([zone])
    env.tableGetAll.mockResolvedValue([placed("reserved", { reservationName: "Familia López" })])
    renderView()
    await flush()
    await tap(/^Mesa 1,/)
    await tap("Cancelar reserva")

    expect(env.releaseTable).toHaveBeenCalledWith("t-1", {})
    expect(env.toastFn).not.toHaveBeenCalledWith(expect.objectContaining({ title: "Acción no permitida" }))
  })
})

describe("WaiterView — modifiers (F7 T3)", () => {
  const BURGER = "55555555-5555-4555-8555-555555555555"
  const PAPAS = "66666666-6666-4666-8666-666666666666"
  const termino = modifierGroup({ id: "g-t", name: "Término de la carne", minSelect: 1, maxSelect: 1, options: [["o-azul", "Azul", 0], ["o-medio", "Medio", 0]] })
  const adic = modifierGroup({ id: "g-a", name: "Adiciones", maxSelect: 3, options: [["o-ched", "Queso cheddar", 3000], ["o-toc", "Tocineta", 4000]] })
  const menu = {
    categories: [
      menuCategory({
        id: "cat-h",
        name: "Hamburguesas",
        dishes: [
          menuDish({ id: BURGER, name: "Hamburguesa artesanal", price: 22000, modifierGroups: [termino, adic] }),
          menuDish({ id: PAPAS, name: "Papas", price: 8000 }),
        ],
      }),
    ],
    uncategorized: [],
  }
  const conflict = (message: string, extra: Record<string, unknown>) =>
    new ApiError(409, "Conflict", message, { statusCode: 409, error: "Conflict", message, ...extra })
  const sheet = () => screen.getByRole("dialog", { name: "Hamburguesa artesanal" })
  const pickIn = async (role: "radio" | "checkbox" | "button", name: RegExp) => {
    await act(async () => {
      within(sheet()).getByRole(role, { name }).click()
    })
    await flush()
  }
  const cart = () => useCartStore.getState().cartItems["t-1"] ?? []

  beforeEach(() => {
    env.tableGetAll.mockResolvedValue([tableRow("t-1", 1, "occupied", "w-1")])
    env.menuTree.mockResolvedValue(menu)
  })

  const addBurger = async (options: RegExp[]) => {
    await tap(/^Hamburguesas/)
    await tap(/^Hamburguesa artesanal,/)
    expect(within(sheet()).getByRole("button", { name: /^Agregar ·/ })).toBeDisabled()
    await pickIn("radio", /^Medio/)
    for (const name of options) await pickIn("checkbox", name)
    await pickIn("button", /^Agregar ·/)
  }
  const start = async () => {
    renderView()
    await flush()
    await act(async () => {
      screen.getByText("Mesa 1").click()
    })
    await flush()
    await openOrderFlow()
  }

  it("adds a dish with options as its own line priced dish + options, and sends modifiers [{optionId}]", async () => {
    await start()
    await addBurger([/^Queso cheddar/, /^Tocineta/])
    await addBurger([/^Queso cheddar/])
    await tap(/^Hamburguesas/)
    await tap(/^Papas,/)
    await tap(/^Agregar 1 ·/)
    expect(cart().map((line) => [line.name, line.quantity, line.price])).toEqual([
      ["Hamburguesa artesanal", 1, 29000],
      ["Hamburguesa artesanal", 1, 25000],
      ["Papas", 1, 8000],
    ])
    await tap("Enviar a cocina (3)")
    expect(env.orderCreate).toHaveBeenCalledWith({
      tableId: "t-1",
      orderType: "dine_in",
      items: [
        { dishId: BURGER, quantity: 1, unitPrice: 29000, comments: null, modifiers: [{ optionId: "o-medio" }, { optionId: "o-ched" }, { optionId: "o-toc" }] },
        { dishId: BURGER, quantity: 1, unitPrice: 25000, comments: null, modifiers: [{ optionId: "o-medio" }, { optionId: "o-ched" }] },
        { dishId: PAPAS, quantity: 1, unitPrice: 8000, comments: null },
      ],
    })
  })

  it("Ver pedido lists the options under the dish; Cambiar opciones reopens the sheet and Guardar edits the line", async () => {
    await start()
    await addBurger([/^Queso cheddar/])
    await tap(/Ver pedido/)
    const review = screen.getByRole("region", { name: "Nuevos" })
    expect(within(review).getByText("Término de la carne: Medio")).toBeInTheDocument()
    expect(within(review).getByText("+ Queso cheddar")).toBeInTheDocument()
    await tap("Cambiar opciones de Hamburguesa artesanal")
    expect(within(sheet()).getByRole("checkbox", { name: /^Queso cheddar/ })).toHaveAttribute("aria-checked", "true")
    await pickIn("checkbox", /^Tocineta/)
    await pickIn("button", /^Guardar ·/)
    expect(cart()).toHaveLength(1)
    expect(cart()[0]).toMatchObject({ price: 29000, quantity: 1 })
    expect(cart()[0]!.modifiers!.map((m) => m.optionId)).toEqual(["o-medio", "o-ched", "o-toc"])
  })

  it("a 409 Price changed with lines reprices each option line with the server unit price", async () => {
    env.orderCreate.mockRejectedValueOnce(
      conflict("Price changed", { prices: [{ dishId: BURGER, price: 23000 }], lines: [{ index: 0, dishId: BURGER, unitPrice: 26000 }] }),
    )
    await start()
    await addBurger([/^Queso cheddar/])
    await tap("Enviar a cocina (1)")
    expect(env.toastFn).toHaveBeenCalledWith(expect.objectContaining({ title: "Precios actualizados" }))
    expect(cart().map((line) => line.price)).toEqual([26000])
  })

  it("shows the server's modifier refusal (422) instead of the generic error", async () => {
    env.orderCreate.mockRejectedValueOnce(
      new ApiError(422, "Unprocessable Entity", "Falta elegir Término de la carne", { code: "modifier_required", message: "Falta elegir Término de la carne" }),
    )
    await start()
    await addBurger([])
    await tap("Enviar a cocina (1)")
    expect(env.toastFn).toHaveBeenCalledWith(expect.objectContaining({ description: "Falta elegir Término de la carne", variant: "destructive" }))
    expect(cart()).toHaveLength(1)
  })
})

/**
 * QA S1 — the inactivity timer freed the selected table after two minutes of an
 * empty cart through the manual path, so a kitchen or served table (empty cart
 * right after the send) showed "No se puede liberar una mesa en estado served"
 * every minute. The automatic release is silent and only frees `occupied`.
 */
describe("WaiterView — automatic release is silent (S1)", () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  async function selectAndWait(status: string) {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    env.tableGetAll.mockResolvedValue([tableRow("t-1", 1, status, "w-1")])
    useCartStore.setState({ cartItems: {} })
    renderView()
    await flush()
    await act(async () => {
      screen.getByText("Mesa 1").click()
    })
    await flush()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4 * 60 * 1000)
    })
    await flush()
  }

  it.each(["kitchen", "served"])("never toasts nor releases a %s table with an empty cart", async (status) => {
    await selectAndWait(status)

    expect(env.releaseTable).not.toHaveBeenCalled()
    expect(env.toastFn).not.toHaveBeenCalled()
  })

  it("still frees an occupied table with an empty cart after two minutes, without a toast (PRESERVE)", async () => {
    await selectAndWait("occupied")

    expect(env.releaseTable).toHaveBeenCalledWith("t-1", {})
    expect(env.toastFn).not.toHaveBeenCalled()
  })

  it("does not toast an API refusal of the automatic release", async () => {
    env.releaseTable.mockRejectedValue(new ApiError(409, "Conflict", "La mesa no se puede liberar mientras está en cocina"))
    await selectAndWait("occupied")

    expect(env.releaseTable).toHaveBeenCalled()
    expect(env.toastFn).not.toHaveBeenCalled()
  })
})

// The panel hides "Liberar mesa" on these statuses, so the guard is the
// fallback of a stale tap: its message is checked directly.
describe("WaiterView — manual release refusal (S1)", () => {
  it.each([
    ["served", "No se puede liberar una mesa servida."],
    ["kitchen", "No se puede liberar una mesa en cocina."],
  ] as const)("names a %s table in Spanish", (status, message) => {
    expect(releaseRefusal(status)).toBe(message)
  })
})

describe("WaiterView — promotions while taking the order (S11, S12)", () => {
  const MOJITO = "a1a1a1a1-0000-4000-8000-000000000001"
  const MARGARITA = "a1a1a1a1-0000-4000-8000-000000000002"
  const CLUB = "a1a1a1a1-0000-4000-8000-000000000003"
  const AJIACO = "a1a1a1a1-0000-4000-8000-000000000004"
  const BANDEJA_E = "a1a1a1a1-0000-4000-8000-000000000005"
  const MORA = "a1a1a1a1-0000-4000-8000-000000000006"
  const menu = {
    categories: [
      menuCategory({
        id: "cat-bebidas",
        name: "Bebidas",
        subcategories: [
          { id: "sub-cocteles", name: "Cócteles" },
          { id: "sub-cervezas", name: "Cervezas" },
        ],
        dishes: [
          menuDish({ id: MOJITO, name: "Mojito", price: 24000, subcategoryId: "sub-cocteles" }),
          menuDish({ id: MARGARITA, name: "Margarita", price: 26000, subcategoryId: "sub-cocteles" }),
          menuDish({ id: CLUB, name: "Club Colombia", price: 9000, subcategoryId: "sub-cervezas" }),
        ],
      }),
      menuCategory({
        id: "cat-casa",
        name: "De la casa",
        dishes: [
          menuDish({ id: AJIACO, name: "Ajiaco", price: 9000 }),
          menuDish({ id: BANDEJA_E, name: "Bandeja ejecutiva", price: 17000 }),
          menuDish({ id: MORA, name: "Jugo de mora", price: 7000 }),
        ],
      }),
    ],
  }
  const hh = { ...happyHour, targets: { dishIds: [], categoryIds: [], subcategoryIds: ["sub-cocteles"] } }
  const combo = {
    ...menuEjecutivo,
    comboGroups: [
      { id: "g-sopa", name: "Sopa", dishIds: [AJIACO] },
      { id: "g-principio", name: "Principio", dishIds: [BANDEJA_E] },
      { id: "g-bebida", name: "Bebida", dishIds: [MORA] },
    ],
  }

  beforeEach(() => {
    env.tableGetAll.mockResolvedValue([tableRow("t-1", 1, "occupied", "w-1")])
    env.menuTree.mockResolvedValue(menu)
  })

  const openFlow = async () => {
    renderView()
    await flush()
    await act(async () => {
      screen.getByText("Mesa 1").click()
    })
    await flush()
    await openOrderFlow()
  }
  const aside = () => screen.getByRole("complementary", { name: "Pedido" })
  const addMojito = async () => {
    await tap(/^Bebidas/)
    await tap(/^Cócteles/)
    await tap(/^Mojito,/)
    await tap(/^Agregar 1 ·/)
  }

  it("shows the active strip and the 2x1 tags on the category, subcategory and dish tiles", async () => {
    env.promotionsToday.mockResolvedValue(todayDto({ active: [active(hh, "19:00", 50)] }))
    await openFlow()

    expect(env.promotionsToday).toHaveBeenCalledWith({ channel: "dine_in" })
    const strip = screen.getByRole("status", { name: "" })
    expect(strip).toHaveTextContent("Happy hour 2x1 en cócteles")
    expect(strip).toHaveTextContent("quedan 50 min")
    expect(screen.getByRole("button", { name: /^Bebidas/ })).toHaveTextContent("2x1 · hasta 19:00")
    expect(screen.getByRole("button", { name: /^De la casa/ })).not.toHaveTextContent("2x1")
    await tap(/^Bebidas/)
    expect(screen.getByRole("button", { name: /^Cócteles/ })).toHaveTextContent("2x1 · hasta 19:00")
    expect(screen.getByRole("button", { name: /^Cervezas/ })).not.toHaveTextContent("2x1")
    await tap(/^Cócteles/)
    expect(screen.getByRole("button", { name: /^Mojito, .*24\.000, 2x1 · hasta 19:00$/ })).toBeInTheDocument()
  })

  it("the strip says Sin promociones en este momento without one, and Promociones opens the sheet", async () => {
    env.promotionsToday.mockResolvedValue(todayDto({ others: [other(hh, "outside_hours")] }))
    await openFlow()
    expect(screen.getByText("Sin promociones en este momento")).toBeInTheDocument()
    await tap("Promociones: 0 activas ahora")
    const sheet = screen.getByRole("dialog", { name: "Promociones de hoy" })
    expect(within(sheet).getByRole("region", { name: "No aplican ahora en el salón" })).toHaveTextContent("Happy hour 2x1 en cócteles")
  })

  it("refreshes today every minute, so the strip turns yellow without a reload", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      env.promotionsToday.mockResolvedValue(todayDto({ active: [active(hh, "19:00", 11)] }))
      await openFlow()
      expect(screen.getByText("Happy hour 2x1 en cócteles").closest("[role=status]")).toHaveAttribute("data-state", "active")
      env.promotionsToday.mockResolvedValue(todayDto({ active: [active(hh, "19:00", 10)] }))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000)
      })
      await flush()
      const strip = screen.getByText("Happy hour 2x1 en cócteles").closest("[role=status]")
      expect(strip).toHaveAttribute("data-state", "ending")
      expect(strip).toHaveTextContent("Termina a las 19:00. Envía el pedido antes para que se aplique.")
    } finally {
      vi.useRealTimers()
    }
  })

  it("prices the order from the preview: line discounts, savings, total and the nudge's quick add", async () => {
    env.promotionsToday.mockResolvedValue(todayDto({ active: [active(hh, "19:00", 50)] }))
    env.pricingPreview.mockImplementation(async (body: { lines: { dishId: string; quantity: number }[] }) => {
      const units = body.lines.reduce((sum, line) => sum + line.quantity, 0)
      const free = Math.floor(units / 2) * 24000
      return {
        channel: "dine_in",
        now: "2026-11-12T23:10:00.000Z",
        lines: body.lines.map((line, index) => ({
          sent: false,
          orderItemId: null,
          draftIndex: index,
          dishId: line.dishId,
          name: "Mojito",
          quantity: line.quantity,
          unitPrice: 24000,
          promotionId: "p-hh",
          promotionName: "Happy hour 2x1",
          comboId: null,
          addedAt: null,
          discounts: free ? [{ kind: "promotion_item", promotionId: "p-hh", label: "Happy hour 2x1", amount: free }] : [],
        })),
        billDiscount: null,
        manualDiscounts: [],
        grossSubtotal: units * 24000,
        totalDiscounts: free,
        netSubtotal: units * 24000 - free,
        hints: units % 2 ? [{ kind: "missing_units", promotionId: "p-hh", message: "Falta 1 unidad para otro 2x1.", missing: 1 }] : [],
      }
    })
    await openFlow()
    await addMojito()

    await waitFor(() => expect(within(aside()).getByText("Falta 1 unidad para otro 2x1.")).toBeInTheDocument())
    expect(env.pricingPreview).toHaveBeenLastCalledWith({ channel: "dine_in", lines: [{ dishId: MOJITO, quantity: 1 }] })
    expect(within(aside()).queryByText("Ahorro con promociones")).not.toBeInTheDocument()

    await act(async () => {
      within(aside()).getByRole("button", { name: "+ Mojito" }).click()
    })
    expect(useCartStore.getState().cartItems["t-1"].map((item) => [item.name, item.quantity])).toEqual([["Mojito", 2]])
    expect(env.toastFn).toHaveBeenCalledWith(expect.objectContaining({ title: "+1 Mojito" }))

    await waitFor(() => expect(within(aside()).getByText("Ahorro con promociones")).toBeInTheDocument())
    expect(aside()).toHaveTextContent(/Happy hour 2x1\s*−\$\s?24\.000/)
    expect(aside()).toHaveTextContent(/Total\s*\$\s?24\.000/)
    expect(within(aside()).queryByText("Falta 1 unidad para otro 2x1.")).not.toBeInTheDocument()
  })

  it("keeps the last good preview when it fails, and still sends at list price", async () => {
    env.pricingPreview.mockResolvedValueOnce({
      channel: "dine_in",
      now: "2026-11-12T23:10:00.000Z",
      lines: [],
      billDiscount: null,
      manualDiscounts: [],
      grossSubtotal: 24000,
      totalDiscounts: 1000,
      netSubtotal: 23000,
      hints: [],
    })
    await openFlow()
    await addMojito()
    await waitFor(() => expect(within(aside()).getByText("Ahorro con promociones")).toBeInTheDocument())

    await addMojito()
    await waitFor(() => expect(env.pricingPreview).toHaveBeenCalledTimes(2))
    await flush()
    expect(within(aside()).getByText("Ahorro con promociones")).toBeInTheDocument()

    await tap("Enviar a cocina (2)")
    expect(env.orderCreate).toHaveBeenCalledWith({
      tableId: "t-1",
      orderType: "dine_in",
      items: [{ dishId: MOJITO, quantity: 2, unitPrice: 24000, comments: null }],
    })
  })

  it("warns to send before the window ends while eligible lines are unsent", async () => {
    env.promotionsToday.mockResolvedValue(todayDto({ active: [active(hh, "19:00", 8)] }))
    await openFlow()
    expect(within(aside()).queryByText("Envía antes de las 19:00.")).not.toBeInTheDocument()
    await addMojito()
    expect(within(aside()).getByText("Envía antes de las 19:00.").closest("[role=status]")).toHaveTextContent("Quedan 8 min")
  })

  it("a sent line shows its discount fixed at its send time", async () => {
    const sentAt = new Date(2026, 10, 12, 18, 12, 0)
    env.orderGetByStatus.mockResolvedValue([
      {
        ...orderDto("o-1", "t-1"),
        items: [
          {
            id: "i-1",
            orderId: "o-1",
            dishId: MARGARITA,
            name: "Margarita",
            price: 26000,
            quantity: 1,
            status: "kitchen",
            comments: null,
            addedAt: sentAt.toISOString(),
          },
          {
            id: "i-2",
            orderId: "o-1",
            dishId: MOJITO,
            name: "Mojito",
            price: 24000,
            quantity: 1,
            status: "kitchen",
            comments: null,
            addedAt: sentAt.toISOString(),
            discounts: [
              { id: "od-1", kind: "promotion_item", source: "automatic", label: "Happy hour 2x1", amount: 24000, promotionId: "p-hh", orderItemId: "i-2", comboId: null, reason: null, authorizedBy: null },
            ],
          },
        ],
      },
    ])
    await openFlow()
    expect(aside()).toHaveTextContent(/Happy hour 2x1 · fijado 18:12\s*−\$\s?24\.000/)
    expect(within(aside()).getByText("Ahorro con promociones")).toBeInTheDocument()
    expect(aside()).toHaveTextContent(/Total\s*\$\s?26\.000/)
  })

  it("outside its schedule the combo tile is disabled and says when it is sold", async () => {
    env.promotionsToday.mockResolvedValue(todayDto({ others: [other(combo, "outside_hours")] }))
    await openFlow()
    const tile = screen.getByRole("button", { name: /^Menú ejecutivo/ })
    expect(tile).toHaveAttribute("aria-disabled", "true")
    expect(tile).toHaveTextContent("Lun–Vie · 12:00–15:00")
    await tap(/^Menú ejecutivo/)
    expect(env.toastFn).toHaveBeenCalledWith({ title: "El Menú ejecutivo se vende de lunes a viernes de 12:00 a 15:00" })
    expect(screen.queryByText(/Elige 1 de cada grupo/)).not.toBeInTheDocument()
  })

  it("builds a live combo, sends it in combos and prints its dishes without prices", async () => {
    env.promotionsToday.mockResolvedValue(todayDto({ active: [active(combo, "15:00", 150)] }))
    await openFlow()
    const tile = screen.getByRole("button", { name: /^Menú ejecutivo/ })
    expect(tile).not.toHaveAttribute("aria-disabled")
    expect(tile).toHaveTextContent("Combo · hasta 15:00")
    await tap(/^Menú ejecutivo/)
    expect(screen.getByRole("heading", { name: "Menú ejecutivo" })).toHaveFocus()
    await tap(/^Ajiaco/)
    await tap(/^Bandeja ejecutiva/)
    await tap(/^Jugo de mora/)
    expect(screen.getByText(/Por separado/).parentElement).toHaveTextContent(/Por separado \$\s?33\.000 · ahorra \$\s?9\.000/)
    await tap(/^Agregar menú ·/)

    expect(env.toastFn).toHaveBeenCalledWith({ title: expect.stringMatching(/^Menú ejecutivo agregado · ahorra \$\s?9\.000$/) })
    const [line] = useCartStore.getState().cartItems["t-1"]
    expect(line).toMatchObject({ name: "Menú ejecutivo", price: 33000, quantity: 1 })
    expect(aside()).toHaveTextContent("Ajiaco · Bandeja ejecutiva · Jugo de mora")
    expect(aside()).toHaveTextContent(/Menú ejecutivo\s*−\$\s?9\.000/)
    expect(aside()).toHaveTextContent(/Total\s*\$\s?24\.000/)

    await tap("Enviar a cocina (1)")
    expect(env.orderCreate).toHaveBeenCalledWith({
      tableId: "t-1",
      orderType: "dine_in",
      items: [],
      combos: [
        {
          comboPromotionId: "p-ejec",
          choices: [
            { groupId: "g-sopa", dishId: AJIACO },
            { groupId: "g-principio", dishId: BANDEJA_E },
            { groupId: "g-bebida", dishId: MORA },
          ],
        },
      ],
    })
    const printed = env.sendCommand.mock.calls[0][0].items
    expect(printed).toEqual([
      { id: AJIACO, dishId: AJIACO, name: "Ajiaco", quantity: 1 },
      { id: BANDEJA_E, dishId: BANDEJA_E, name: "Bandeja ejecutiva", quantity: 1 },
      { id: MORA, dishId: MORA, name: "Jugo de mora", quantity: 1 },
    ])
  })

  it("a combo can be removed before sending", async () => {
    env.promotionsToday.mockResolvedValue(todayDto({ active: [active(combo, "15:00", 150)] }))
    await openFlow()
    await tap(/^Menú ejecutivo/)
    await tap(/^Ajiaco/)
    await tap(/^Bandeja ejecutiva/)
    await tap(/^Jugo de mora/)
    await tap(/^Agregar menú ·/)
    await tap("Ver y editar pedido")
    expect(screen.queryByRole("group", { name: "Cantidad de Menú ejecutivo" })).not.toBeInTheDocument()
    await tap("Quitar Menú ejecutivo")
    expect(useCartStore.getState().cartItems["t-1"]).toEqual([])
  })
})
