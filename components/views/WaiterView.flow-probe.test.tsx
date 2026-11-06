import { act, render, screen, within } from "@testing-library/react"
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
  menuTree: vi.fn(),
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
    this.menuTree.mockReset()
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
    this.menuTree.mockResolvedValue({ categories: [] })
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
import { menuCategory, menuDish } from "@/lib/order-steps/fixtures"

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

/**
 * "Agregar productos" of the table panel opens the full-screen step flow
 * (T10); a table without an open order is first asked its guests (T22),
 * answered "Sin indicar" so the write path stays the T10 one.
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


// ---- T10 order flow: undo, step rules and lifecycle (verifier probes) ----
import { fireEvent } from "@testing-library/react"

describe("T10 order flow: undo, rules and lifecycle", () => {
  const A = "aaaaaaaa-1111-4111-8111-111111111111"
  const B = "bbbbbbbb-2222-4222-8222-222222222222"
  const C = "cccccccc-3333-4333-8333-333333333333"
  const menu = {
    categories: [
      menuCategory({ id: "cat-1", name: "Platos", dishes: [menuDish({ id: A, name: "Bandeja", price: 30000 }), menuDish({ id: B, name: "Sopa", price: 7000, available: false })] }),
      menuCategory({ id: "cat-2", name: "Bebidas", subcategories: [{ id: "s-1", name: "Jugos" }], dishes: [menuDish({ id: C, name: "Lulo", price: 5000, subcategoryId: "s-1", allowComments: false }), menuDish({ id: "dddddddd-4444-4444-8444-444444444444", name: "Agua", price: 2000 })] }),
      menuCategory({ id: "cat-3", name: "Postres", subcategories: [{ id: "s-2", name: "Vacía" }], dishes: [menuDish({ id: "eeeeeeee-5555-4555-8555-555555555555", name: "Flan", price: 6000 })] }),
    ],
  }
  beforeEach(() => {
    useConfigStore.setState({ inventoryControlEnabled: true })
    env.tableGetAll.mockResolvedValue([tableRow("t-1", 1, "occupied", "w-1")])
    env.menuTree.mockResolvedValue(menu)
  })
  afterEach(() => useConfigStore.setState({ inventoryControlEnabled: false }))
  const cart = () => (useCartStore.getState().cartItems["t-1"] ?? []).map((l) => [l.name, l.quantity, l.comments ?? null])
  const open = async () => { renderView(); await flush(); await act(async () => { screen.getByText("Mesa 1").click() }); await flush(); await openOrderFlow() }
  const addA = async (qty: number, note?: string) => {
    await tap(/^Platos/); await tap(/^Bandeja,/)
    for (let i = 1; i < qty; i += 1) await tap("Sumar uno")
    if (note !== undefined) fireEvent.change(screen.getByLabelText(/Nota para cocina/), { target: { value: note } })
    await tap(new RegExp(`^Agregar ${qty} ·`))
  }
  const undoOf = (title: string, nth = 0) => env.toastFn.mock.calls.filter(([a]: any) => a.title === title)[nth][0].action.props.onClick

  it("P1 undo of a merged add removes only its quantity", async () => {
    await open(); await addA(2, "x"); await addA(1, "x")
    expect(cart()).toEqual([["Bandeja", 3, "x"]])
    await act(async () => undoOf("✓ 1× Bandeja agregada")()); await flush()
    expect(cart()).toEqual([["Bandeja", 2, "x"]])
  })
  it("P2 undo picks the line with the same comment", async () => {
    await open(); await addA(1, "x"); await addA(1)
    expect(cart()).toEqual([["Bandeja", 1, "x"], ["Bandeja", 1, null]])
    await act(async () => undoOf("✓ 1× Bandeja agregada", 1)()); await flush()
    expect(cart()).toEqual([["Bandeja", 1, "x"]])
  })
  it("P3 a blank note is no comment and merges with the plain line", async () => {
    await open(); await addA(1); await addA(1, "   ")
    expect(cart()).toEqual([["Bandeja", 2, null]])
  })
  it("P6 a stale Deshacer after a send does not take back a newer add", async () => {
    await open(); await addA(2)
    const stale = undoOf("✓ 2× Bandeja agregada")
    await tap("Enviar a cocina (2)")
    expect(screen.queryByRole("heading", { name: "¿Qué categoría?" })).not.toBeInTheDocument()
    expect(env.menuTree.mock.calls.length).toBeGreaterThanOrEqual(2) // P8 tree re-read after the send
    await act(async () => { screen.getByText("Mesa 1").click() }); await flush()
    await openOrderFlow()
    
    await addA(1)
    await act(async () => stale()); await flush()
    expect(cart()).toEqual([["Bandeja", 1, null]])
  })
  it("P7 a realtime DELETE of the table closes the flow", async () => {
    await open()
    await act(async () => { for (const cb of env.tableCallbacks) await cb({ eventType: "DELETE", new: {}, old: { id: "t-1" } }) }); await flush()
    expect(screen.queryByRole("heading", { name: "¿Qué categoría?" })).not.toBeInTheDocument()
  })
  it("P9 quantity floor 1 and Sumar", async () => {
    await open(); await tap(/^Platos/); await tap(/^Bandeja,/)
    expect(screen.getByRole("button", { name: "Quitar uno" })).toBeDisabled()
    await tap("Sumar uno"); await tap("Sumar uno"); await tap("Sumar uno")
    await tap(/^Agregar 4 ·/)
    expect(cart()).toEqual([["Bandeja", 4, null]])
  })
  it("P10 Agotado stays on Plato, toasts, adds nothing", async () => {
    await open(); await tap(/^Platos/); await tap(/^Sopa,.*agotado/)
    expect(env.toastFn).toHaveBeenCalledWith(expect.objectContaining({ title: "Agotado: Sopa · ofrece otra opción" }))
    expect(screen.queryByRole("button", { name: "Sumar uno" })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: /^Bandeja,/ })).toBeInTheDocument()
    expect(cart()).toEqual([])
  })
  it("P11 Sin subcategoría only when needed; empty subcategory skips step 2; the note is offered on every dish", async () => {
    await open(); await tap(/^Bebidas/)
    expect(screen.getByRole("button", { name: /^Jugos/ })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /^Sin subcategoría/ })).toBeInTheDocument()
    await tap(/^Jugos/); await tap(/^Lulo,/)
    expect(screen.getByLabelText(/Nota para cocina/)).toBeInTheDocument()
    await tap(/^Paso 1, Categoría/)
    expect(screen.getByRole("heading", { name: "¿Qué categoría?" })).toBeInTheDocument()
    await tap(/^Postres/)
    expect(screen.getByRole("button", { name: /^Flan,/ })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /^Paso 2, Subcategoría/ })).toBeDisabled()
  })
  it("P12 Atrás on Categoría returns to the map with the table still selected", async () => {
    await open(); await tap("Mapa")
    expect(screen.queryByRole("heading", { name: "¿Qué categoría?" })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Agregar productos" })).toBeInTheDocument()
  })
  it("P13 undoing a Quitar after the dish was added again merges into one line", async () => {
    await open(); await addA(2)
    const [line] = useCartStore.getState().cartItems["t-1"]
    await tap(/Ver pedido/)
    await tap("Quitar Bandeja")
    act(() => useCartStore.setState((s) => ({ cartItems: { ...s.cartItems, "t-1": [{ ...line, quantity: 1 }] } })))
    await act(async () => undoOf("Quitaste 2× Bandeja")()); await flush()
    expect(cart()).toEqual([["Bandeja", 3, null]])
  })
})
