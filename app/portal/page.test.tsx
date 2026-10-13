import { act, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * T5 (S1/S2) — the shell is the only component every profile mounts, so every
 * request it issues is charged to every profile. Before this task it ran the
 * same ~24 sequential requests for every role behind a fixed 500 ms full-screen
 * loader, re-ran the profile query on every token refresh, and never
 * unsubscribed the auth listener.
 */

const env = vi.hoisted(() => {
  return {
    role: "waiter" as string,
    profileQueries: 0,
    unsubscribeCalls: 0,
    authListener: null as null | ((event: string, session: unknown) => void),
    tableGetAll: vi.fn(),
    getWaiters: vi.fn(),
    getByStatus: vi.fn(),
    getCurrentRegister: vi.fn(),
    getAllRegisters: vi.fn(),
    loadConfig: vi.fn(),
    setTablesSpy: vi.fn(),
    setProfilesSpy: vi.fn(),
    setOrdersSpy: vi.fn(),
    reset() {
      this.profileQueries = 0
      this.unsubscribeCalls = 0
      this.authListener = null
      this.tableGetAll.mockReset()
      this.getWaiters.mockReset()
      this.getByStatus.mockReset()
      this.getCurrentRegister.mockReset()
      this.getAllRegisters.mockReset()
      this.loadConfig.mockReset()
      this.setTablesSpy.mockReset()
      this.setProfilesSpy.mockReset()
      this.setOrdersSpy.mockReset()
      this.tableGetAll.mockResolvedValue([])
      this.getWaiters.mockResolvedValue([])
      this.getByStatus.mockResolvedValue([])
      this.getCurrentRegister.mockResolvedValue(null)
      this.getAllRegisters.mockResolvedValue([])
      this.loadConfig.mockResolvedValue(undefined)
    },
  }
})

vi.mock("@/lib/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { user: { id: "auth-1" } } } }),
      getUser: async () => ({ data: { user: { id: "auth-1" } } }),
      onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
        env.authListener = cb
        return {
          data: {
            subscription: {
              unsubscribe: () => {
                env.unsubscribeCalls += 1
              },
            },
          },
        }
      },
    },
    from: (table: string) => {
      if (table === "profiles") {
        env.profileQueries += 1
      }
      const chain: Record<string, unknown> = {}
      for (const method of ["select", "eq"]) {
        chain[method] = () => chain
      }
      const row =
        table === "profiles"
          ? {
              id: "p-1",
              full_name: "Ana",
              username: "ana",
              role: env.role,
              restaurant_id: "rest-1",
              active: true,
            }
          : null
      // `maybeSingle()` resolves one row (or null), like PostgREST does.
      chain.maybeSingle = () => chain
      chain.single = () => chain
      chain.then = (onfulfilled?: (v: unknown) => unknown, onrejected?: (r: unknown) => unknown) =>
        Promise.resolve({ data: row, error: null }).then(onfulfilled, onrejected)
      return chain
    },
  },
  createSupabaseClient: () => ({}),
}))

vi.mock("@/lib/supabase/service", () => ({
  tableService: {
    getAll: () => env.tableGetAll(),
    getWaiters: () => env.getWaiters(),
  },
  orderService: {
    getByStatus: (statuses: string | string[]) => env.getByStatus(statuses),
  },
  waiterService: { getAll: async () => [] },
}))

vi.mock("@/lib/supabase/business-config-service", () => ({
  default: {
    loadConfig: (options?: unknown) => env.loadConfig(options),
    getAllConfig: vi.fn(),
    saveMultipleConfig: vi.fn(),
  },
  businessConfigService: {
    loadConfig: (options?: unknown) => env.loadConfig(options),
    getAllConfig: vi.fn(),
    saveMultipleConfig: vi.fn(),
  },
}))

vi.mock("@/lib/supabase/cash-register-service", () => ({
  cashRegisterService: {
    getCurrentRegister: () => env.getCurrentRegister(),
    getAllRegisters: () => env.getAllRegisters(),
  },
}))

vi.mock("@/lib/supabase/payments-service", () => ({ closeRegisterRpc: vi.fn() }))

vi.mock("@/components/auth/LoginView", () => ({ LoginView: () => <div>login-view</div> }))
vi.mock("@/components/profiles/ProfileSelection", () => ({ ProfileSelection: () => <div>profile-picker</div> }))
vi.mock("@/components/views/WaiterView", () => ({ WaiterView: () => <div>waiter-view</div> }))
vi.mock("@/components/views/KitchenView", () => ({ KitchenView: () => <div>kitchen-view</div> }))
vi.mock("@/components/views/CashierView", () => ({ CashierView: () => <div>cashier-view</div> }))
vi.mock("@/components/views/AdminView", () => ({ AdminView: () => <div>admin-view</div> }))
vi.mock("@/components/views/DeliveryView", () => ({ DeliveryView: () => <div>delivery-view</div> }))

import { useProfileStore } from "@/store/useProfileStore"
import { useTableStore } from "@/store/useTableStore"
import { useOrderStore } from "@/store/useOrderStore"
import Home from "./page"

beforeEach(() => {
  env.reset()
  env.role = "waiter"
  useProfileStore.setState({ profiles: [], selectedProfile: null, authProfile: null, showProfileSelection: false })
  useTableStore.setState({ tables: [] })
  useOrderStore.setState({ orders: [] })
  vi.spyOn(useTableStore.getState(), "setTables").mockImplementation(env.setTablesSpy)
  vi.spyOn(useProfileStore.getState(), "setProfiles").mockImplementation(env.setProfilesSpy)
  vi.spyOn(useOrderStore.getState(), "setOrders").mockImplementation(env.setOrdersSpy)
})

afterEach(() => {
  vi.restoreAllMocks()
})

/** Requests the shell issued, in the order it issued them. */
function issued() {
  return {
    config: env.loadConfig.mock.calls.length,
    tables: env.tableGetAll.mock.calls.length,
    waiters: env.getWaiters.mock.calls.length,
    orders: env.getByStatus.mock.calls.length,
    currentRegister: env.getCurrentRegister.mock.calls.length,
    allRegisters: env.getAllRegisters.mock.calls.length,
  }
}

async function renderShell(view = "waiter-view") {
  render(<Home />)
  return (await screen.findByText(view)).textContent
}

describe("shell startup loads per role", () => {
  it("waiter: only the config, and the view renders without the 500 ms loader", async () => {
    env.role = "waiter"
    const started = Date.now()
    expect(await renderShell("waiter-view")).toBe("waiter-view")
    expect(Date.now() - started).toBeLessThan(400)
    expect(issued()).toEqual({
      config: 1,
      tables: 0,
      waiters: 0,
      orders: 0,
      currentRegister: 0,
      allRegisters: 0,
    })
  })

  it("kitchen: tables + waiter directory only (the view owns its own orders query)", async () => {
    env.role = "kitchen"
    expect(await renderShell("kitchen-view")).toBe("kitchen-view")
    expect(issued()).toEqual({
      config: 0,
      tables: 1,
      waiters: 1,
      orders: 0,
      currentRegister: 0,
      allRegisters: 0,
    })
  })

  it("cashier: config + tables + waiter directory, no orders and no registers", async () => {
    env.role = "cashier"
    expect(await renderShell("cashier-view")).toBe("cashier-view")
    expect(issued()).toEqual({
      config: 1,
      tables: 1,
      waiters: 1,
      orders: 0,
      currentRegister: 0,
      allRegisters: 0,
    })
  })

  it("delivery_operator: only the config", async () => {
    env.role = "delivery_operator"
    expect(await renderShell("delivery-view")).toBe("delivery-view")
    expect(issued()).toEqual({
      config: 1,
      tables: 0,
      waiters: 0,
      orders: 0,
      currentRegister: 0,
      allRegisters: 0,
    })
  })

  it("admin: every slice, with kitchen+delivered orders in ONE getByStatus call", async () => {
    env.role = "admin"
    expect(await renderShell("admin-view")).toBe("admin-view")
    expect(issued()).toEqual({
      config: 1,
      tables: 1,
      waiters: 1,
      orders: 1,
      currentRegister: 0,
      allRegisters: 1,
    })
    expect(env.getByStatus).toHaveBeenCalledWith(["kitchen", "delivered"])
  })

  it("admin may seed the missing config keys; other roles only read", async () => {
    env.role = "admin"
    await renderShell("admin-view")
    expect(env.loadConfig).toHaveBeenCalledWith({ canWrite: true })

    env.reset()
    env.role = "waiter"
    await renderShell("waiter-view")
    expect(env.loadConfig).toHaveBeenCalledWith({ canWrite: false })
  })

  it("an admin impersonating a role keeps the admin loads", async () => {
    env.role = "admin"
    await renderShell("admin-view")
    act(() => {
      useProfileStore.getState().selectProfile({ id: "waiter-1", name: "Mesero", role: "waiter", hasPassword: false })
    })
    expect(screen.getByText("waiter-view")).toBeInTheDocument()
    expect(env.getAllRegisters).toHaveBeenCalledTimes(1)
    expect(env.tableGetAll).toHaveBeenCalledTimes(1)
  })

  it("unknown role: the app renders the fallback without fanning out any request", async () => {
    env.role = "supervisor"
    render(<Home />)
    await waitFor(() => expect(screen.getByText("Error: Perfil no válido")).toBeInTheDocument())
    expect(issued()).toEqual({
      config: 0,
      tables: 0,
      waiters: 0,
      orders: 0,
      currentRegister: 0,
      allRegisters: 0,
    })
  })

  it("runs the selected loads in parallel instead of one after the other", async () => {
    env.role = "admin"
    let releaseTables = () => {}
    env.tableGetAll.mockImplementation(() => new Promise((resolve) => {
      releaseTables = () => resolve([])
    }))

    render(<Home />)

    // Every other admin load has already started while `tables` is still pending:
    // a sequential shell would have made none of them yet.
    await waitFor(() => expect(env.getAllRegisters).toHaveBeenCalledTimes(1))
    expect(env.getByStatus).toHaveBeenCalledTimes(1)
    expect(env.getWaiters).toHaveBeenCalledTimes(1)
    expect(env.loadConfig).toHaveBeenCalledTimes(1)

    await act(async () => {
      releaseTables()
    })
    expect(await screen.findByText("admin-view")).toBeInTheDocument()
  })

  it("a failing load does not stop the others", async () => {
    env.role = "admin"
    env.getWaiters.mockRejectedValue(new Error("waiters down"))

    render(<Home />)
    expect(await screen.findByText("admin-view")).toBeInTheDocument()
    expect(env.getAllRegisters).toHaveBeenCalledTimes(1)
  })
})

describe("shell auth listener", () => {
  it("unsubscribes on unmount (today the cleanup was returned from inside the async function)", async () => {
    const { unmount } = render(<Home />)
    await screen.findByText("waiter-view")
    expect(env.unsubscribeCalls).toBe(0)
    unmount()
    expect(env.unsubscribeCalls).toBe(1)
  })

  it("does not re-query the profile on TOKEN_REFRESHED or on an INITIAL_SESSION duplicate", async () => {
    await renderShell()
    expect(env.profileQueries).toBe(1)

    await act(async () => {
      env.authListener?.("TOKEN_REFRESHED", { user: { id: "auth-1" } })
      env.authListener?.("INITIAL_SESSION", { user: { id: "auth-1" } })
      env.authListener?.("SIGNED_IN", { user: { id: "auth-1" } })
    })

    expect(env.profileQueries).toBe(1)
  })

  it("does not drop the admin's impersonated profile on a token refresh", async () => {
    env.role = "admin"
    await renderShell("admin-view")
    act(() => {
      useProfileStore.getState().selectProfile({ id: "waiter-1", name: "Mesero", role: "waiter", hasPassword: false })
    })
    expect(screen.getByText("waiter-view")).toBeInTheDocument()

    await act(async () => {
      env.authListener?.("TOKEN_REFRESHED", { user: { id: "auth-1" } })
    })

    expect(screen.getByText("waiter-view")).toBeInTheDocument()
    expect(useProfileStore.getState().selectedProfile?.role).toBe("waiter")
  })

  it("re-queries the profile when a different user signs in", async () => {
    await renderShell()
    await act(async () => {
      env.authListener?.("SIGNED_IN", { user: { id: "auth-2" } })
    })
    expect(env.profileQueries).toBe(2)
  })
})