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

const env = vi.hoisted(() => ({
  tableGetAll: vi.fn(),
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
  checkOrderStock: vi.fn(),
  reduceStock: vi.fn(),
  checkStockForDishes: vi.fn(),
  /** true while the dish can be sold, false once the send has reduced stock. */
  stockSoldOut: false,
  tableCallbacks: [] as ((payload: unknown) => void)[],
  orderCallbacks: [] as ((payload: unknown) => void)[],
  reset() {
    this.tableGetAll.mockReset()
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
    this.checkOrderStock.mockReset()
    this.reduceStock.mockReset()
    this.checkStockForDishes.mockReset()
    this.stockSoldOut = false
    this.tableCallbacks = []
    this.orderCallbacks = []
    this.tableGetAll.mockResolvedValue([])
    this.orderGetByStatus.mockResolvedValue([])
    this.waiterGetAll.mockResolvedValue([])
    this.categories.mockResolvedValue([])
    this.dishesByCategory.mockResolvedValue([])
    this.assignWaiter.mockResolvedValue(undefined)
    this.updateTableStatus.mockResolvedValue(undefined)
    this.releaseTable.mockResolvedValue(undefined)
    this.orderCreate.mockResolvedValue({ id: "o-new" })
    this.checkOrderStock.mockResolvedValue({ hasStock: true, dishesWithoutStock: [], missingIngredients: [] })
    this.reduceStock.mockResolvedValue(undefined)
    this.checkStockForDishes.mockImplementation(async () =>
      new Map(env.stockSoldOut ? [["d-1", false]] : [["d-1", true]]),
    )
  },
  /** Unsubscribes handed back by the realtime service, in order. */
  unsubscribes: 0,
}))

vi.mock("@/lib/supabase/client", () => ({
  supabase: {
    auth: { signOut: vi.fn(), getSession: vi.fn(), getUser: vi.fn(), onAuthStateChange: vi.fn() },
    from: () => {
      throw new Error("the view must not read the database directly")
    },
  },
}))

vi.mock("@/lib/supabase/service", () => ({
  tableService: {
    getAll: env.tableGetAll,
    assignWaiter: env.assignWaiter,
    updateTableStatus: env.updateTableStatus,
    releaseTable: env.releaseTable,
  },
  orderService: {
    getByStatus: env.orderGetByStatus,
    create: env.orderCreate,
    addItemsToOrder: vi.fn(),
    recalculateOrderTotals: vi.fn(),
    updateStatus: vi.fn(),
  },
  waiterService: { getAll: env.waiterGetAll },
  categoryService: { getAllActive: env.categories },
}))

vi.mock("@/lib/supabase/inventory-control-service", () => ({
  default: {
    checkOrderStock: env.checkOrderStock,
    reduceStock: env.reduceStock,
    checkStockForDishes: env.checkStockForDishes,
  },
}))

vi.mock("@/lib/supabase/dish-service-with-promotions", () => ({
  dishServiceWithPromotions: { getByCategoryWithPromotions: env.dishesByCategory },
}))

vi.mock("@/lib/supabase/realtime-service", () => ({
  realtimeService: {
    subscribeToTables: (cb: (payload: unknown) => void) => {
      env.tableCallbacks.push(cb)
      env.subscribeToTables(cb)
      return () => {
        env.unsubscribes += 1
      }
    },
    subscribeToOrders: (cb: (payload: unknown) => void) => {
      env.orderCallbacks.push(cb)
      env.subscribeToOrders(cb)
      return () => {
        env.unsubscribes += 1
      }
    },
    sendCommand: env.sendCommand,
  },
}))

vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }))

import { WaiterView } from "./WaiterView"

const waiterProfile: Profile = { id: "w-1", name: "Ana", full_name: "Ana Gómez", role: "waiter", hasPassword: false }
const adminProfile: Profile = { id: "admin-1", name: "Jefe", full_name: "Jefe", role: "admin", hasPassword: true }

const waiterRows = [{ id: "w-1", full_name: "Ana Gómez", username: "ana", role: "waiter" }]

const tableRow = (id: string, number: number, status = "available", waiterId: string | null = null) => ({
  id,
  number,
  status,
  waiter_id: waiterId,
  waiter_name: null,
  updated_at: "2026-10-07T00:00:00.000Z",
})

const orderRow = (id: string, tableId: string | null, orderType: "dine_in" | "delivery" | null = "dine_in") => ({
  id,
  table_id: tableId,
  order_type: orderType,
  status: "kitchen",
  subtotal: 100,
  tax: 0,
  tax_percentage: 0,
  tip: 0,
  tip_percentage: 0,
  total: 100,
  total_discounts: 0,
  waiter_id: "w-1",
  is_partial_order: false,
  parent_order_id: null,
  created_at: "2026-10-07T00:00:00.000Z",
  order_items: [],
})

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
        category_id: "cat-1",
        image_url: "/dish.png",
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
    expect(env.assignWaiter).toHaveBeenCalledWith("t-1", "w-1", "occupied")
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
  const dishRow = {
    id: "d-1",
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
    // Sending the order is what makes the dish sell out.
    env.reduceStock.mockImplementation(async () => {
      env.stockSoldOut = true
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