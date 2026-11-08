import { act, fireEvent, render, screen, within } from "@testing-library/react"
import { QueryClientProvider } from "@tanstack/react-query"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { queryClient } from "@/lib/queryClient"
import { useCartStore } from "@/store/useCartStore"
import { useOrderStore } from "@/store/useOrderStore"
import { useProfileStore } from "@/store/useProfileStore"
import { useTableStore } from "@/store/useTableStore"

/**
 * F4b (L20-L22) — on a shared terminal the tablet shows the normal waiter
 * screen (same header, same zone floor map): tapping a table opens the PIN
 * sheet over the map, and a valid PIN continues the normal table flow as the
 * identified waiter.
 */

const env = vi.hoisted(() => ({
  tables: [] as unknown[],
  zones: [] as unknown[],
  assignWaiter: vi.fn(),
  identifyByPin: vi.fn(),
}))

vi.mock("@/lib/api/client", () => {
  const route = async (method: string, path: string, init: any = {}) => {
    switch (`${method} ${path}`) {
      case "GET /api/tables":
        return { data: env.tables }
      case "GET /api/zones":
        return { data: env.zones }
      case "GET /api/orders":
      case "GET /api/staff/waiters":
        return { data: [] }
      case "POST /api/tables/{id}/assign":
        return { data: await env.assignWaiter(init.params.path.id, init.body.waiterId) }
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
vi.mock("@/lib/api/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/auth")>()),
  identifyByPin: env.identifyByPin,
}))
vi.mock("@/lib/api/catalog", () => ({ fetchCategories: async () => [], fetchDishes: async () => [], getMenuTree: async () => ({ categories: [] }) }))
vi.mock("@/lib/api/inventory", () => ({ checkStockForDishes: async () => new Map(), checkDishesStock: vi.fn(), consumeOrderStock: vi.fn() }))
vi.mock("@/lib/api/print", () => ({ sendCommand: vi.fn() }))
vi.mock("@/lib/api/realtime", () => ({
  realtimeService: { subscribeToTables: () => () => {}, subscribeToZones: () => () => {}, subscribeToOrders: () => () => {} },
}))
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }))
vi.mock("@/components/theme/theme-toggle", () => ({ ThemeToggle: () => null }))

import { TerminalView } from "@/components/terminal/TerminalView"
import { WaiterView } from "./WaiterView"

Element.prototype.scrollIntoView = vi.fn()

const opener = {
  user: { id: "u-laura", email: "laura@a.test" },
  profile: { id: "p-laura", name: "Laura Gómez", role: "cashier", restaurantId: "r-1" },
  sessionKind: "terminal" as const,
}
const placed = (id: string, number: number) => ({
  id,
  number,
  status: "available",
  waiterId: null,
  waiterName: null,
  createdAt: null,
  updatedAt: "2026-10-07T00:00:00.000Z",
  zoneId: "z-1",
  x: 0.3,
  y: 0.4,
  w: 0.1,
  h: 0.1,
  shape: "round",
  rotation: 0,
  seats: 4,
})

/** What app/portal renders for a terminal session. */
function Portal() {
  const selected = useProfileStore((s) => s.selectedProfile)
  return (
    <QueryClientProvider client={queryClient}>
      <TerminalView session={opener}>{selected && <WaiterView profile={selected} onChangeProfile={() => {}} />}</TerminalView>
    </QueryClientProvider>
  )
}

const flush = async () => {
  for (let tick = 0; tick < 200 && (tick < 3 || queryClient.isFetching() > 0); tick += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
}

beforeEach(() => {
  queryClient.clear()
  env.tables = [placed("t-7", 7)]
  env.zones = [{ id: "z-1", name: "Salón principal", aspect: 1.6, sortOrder: 0, labels: [], active: true, createdAt: null, updatedAt: null }]
  env.assignWaiter.mockReset().mockImplementation(async (id: string, waiterId: string) => ({ ...placed(id, 7), status: "occupied", waiterId }))
  env.identifyByPin.mockReset().mockResolvedValue({
    token: "acting-p-andres",
    expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    profile: { id: "p-andres", name: "Andrés Mora", role: "waiter" },
  })
  useTableStore.setState({ tables: [] })
  useOrderStore.setState({ orders: [] })
  useCartStore.setState({ cartItems: {} })
  const laura = { id: "p-laura", name: "Laura Gómez", full_name: "Laura Gómez", role: "cashier" as const }
  useProfileStore.setState({ authProfile: laura, selectedProfile: laura })
})

describe("WaiterView on a shared terminal (F4b)", () => {
  it("is the normal waiter screen: header and zone floor map, no waiter grid or terminal screens", async () => {
    render(<Portal />)
    await flush()
    expect(screen.getByRole("tab", { name: /Salón principal/ })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Mesa 7, Libre, 4 sillas" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Salir|Cerrar Sesión/ })).toBeInTheDocument()
    expect(screen.queryByText("¿Quién toma el pedido?")).toBeNull()
    expect(screen.queryByText("Terminal de pedidos")).toBeNull()
    expect(screen.queryByRole("button", { name: /Cambiar mi PIN/ })).toBeNull()
  })

  it("a table tap opens the PIN sheet over the map; a valid PIN continues the table as that waiter", async () => {
    render(<Portal />)
    await flush()
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Mesa 7, Libre, 4 sillas" }))
    })
    const sheet = screen.getByRole("dialog")
    expect(within(sheet).getByRole("heading", { name: "Mesa 7 · Escribe tu PIN" })).toBeInTheDocument()
    // The floor map stays under the sheet.
    expect(screen.getByRole("tab", { name: /Salón principal/, hidden: true })).toBeInTheDocument()
    expect(env.assignWaiter).not.toHaveBeenCalled()
    const pad = within(sheet).getByRole("group", { name: "Teclado del PIN" })
    for (const digit of "4829") fireEvent.click(within(pad).getByRole("button", { name: digit }))
    await act(async () => {
      fireEvent.click(within(pad).getByRole("button", { name: "Entrar" }))
    })
    await flush()
    expect(env.identifyByPin).toHaveBeenCalledWith("4829")
    expect(screen.getByRole("status")).toHaveTextContent("Andrés ·")
    expect(screen.getByRole("region", { name: "Mesa 7" })).toBeInTheDocument()
    // The normal waiter flow: a free table is assigned to the identified waiter
    // on its first products (reservas-mesas T2: the tap only selects it).
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Agregar productos" }))
    })
    await flush()
    expect(env.assignWaiter).toHaveBeenCalledWith("t-7", "p-andres")
  })
})
