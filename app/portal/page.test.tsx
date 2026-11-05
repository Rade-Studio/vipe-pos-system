import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError } from "@/lib/api/errors"

/**
 * T5 (S1/S2) — the shell is the only component every profile mounts, so every
 * request it issues is charged to every profile. Before this task it ran the
 * same ~24 sequential requests for every role behind a fixed 500 ms full-screen
 * loader, re-ran the profile query on every token refresh, and never
 * unsubscribed the auth listener.
 */

const sessionFor = vi.hoisted(() => (role: string, userId = "u-1") => ({
  user: { id: userId, email: "ana@vipe.local" },
  profile: { id: "p-1", name: "Ana", role, restaurantId: "rest-1" },
}))

const env = vi.hoisted(() => {
  return {
    role: "waiter" as string,
    /** 401 = the API has no session for the browser. */
    meStatus: 200 as 200 | 401,
    apiGet: vi.fn(),
    apiPost: vi.fn(),
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
      this.meStatus = 200
      this.apiGet.mockReset()
      this.apiPost.mockReset()
      // T8b: the startup slices for tables, waiters and orders are API reads too.
      this.apiGet.mockImplementation(async (path: string, init?: any) => {
        if (path === "/api/tables") return { data: await this.tableGetAll() }
        if (path === "/api/staff/waiters") return { data: await this.getWaiters() }
        if (path === "/api/orders") return { data: await this.getByStatus(String(init.params.query.status).split(",")) }
        if (path !== "/api/auth/me") throw new Error(`unexpected GET ${path}`)
        if (this.meStatus === 401) throw new ApiError(401, "Unauthorized", "Missing access token")
        return { data: sessionFor(this.role) }
      })
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

vi.mock("@/lib/api/client", () => ({
  api: { GET: env.apiGet, POST: env.apiPost },
  onSessionRefreshed: () => () => {},
}))

// T7b: every role reads the config with `GET /config`; nobody seeds keys.
vi.mock("@/lib/api/config", () => ({
  fetchConfig: () => env.loadConfig(),
  saveConfig: vi.fn(),
}))

vi.mock("@/lib/api/registers", () => ({
  getCurrentRegister: () => env.getCurrentRegister(),
  getAllRegisters: () => env.getAllRegisters(),
}))

vi.mock("@/lib/api/payments", () => ({ closeRegisterRpc: vi.fn() }))

vi.mock("@/components/auth/LoginView", () => ({
  LoginView: ({ onLoginSuccess }: { onLoginSuccess: (session: unknown) => void }) => (
    <button onClick={() => onLoginSuccess(sessionFor("kitchen", "u-2"))}>login-view</button>
  ),
}))
vi.mock("@/components/profiles/ProfileSelection", () => ({ ProfileSelection: () => <div>profile-picker</div> }))
vi.mock("@/components/views/WaiterView", () => ({ WaiterView: () => <div>waiter-view</div> }))
vi.mock("@/components/views/KitchenView", () => ({ KitchenView: () => <div>kitchen-view</div> }))
vi.mock("@/components/views/CashierView", () => ({ CashierView: () => <div>cashier-view</div> }))
vi.mock("@/components/views/AdminView", () => ({ AdminView: () => <div>admin-view</div> }))
vi.mock("@/components/views/DeliveryView", () => ({ DeliveryView: () => <div>delivery-view</div> }))

import { useProfileStore } from "@/store/useProfileStore"
import { useTableStore } from "@/store/useTableStore"
import { useOrderStore } from "@/store/useOrderStore"
import { emitAuthEvent } from "@/lib/shell/auth-events"
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

  it("admin: every slice, with kitchen+delivered orders in ONE GET /orders", async () => {
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

  it("admin and waiter both read the config once through GET /config", async () => {
    env.role = "admin"
    await renderShell("admin-view")
    expect(env.loadConfig).toHaveBeenCalledTimes(1)

    // Both shells share the profile store: unmount the admin one first.
    cleanup()
    env.reset()
    env.role = "waiter"
    await renderShell("waiter-view")
    expect(env.loadConfig).toHaveBeenCalledTimes(1)
  })

  it("an admin impersonating a role keeps the admin loads", async () => {
    env.role = "admin"
    await renderShell("admin-view")
    act(() => {
      useProfileStore.getState().selectProfile({ id: "waiter-1", name: "Mesero", role: "waiter" })
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

describe("shell session through the API", () => {
  it("resolves the role from GET /api/auth/me, once, without querying profiles", async () => {
    env.role = "cashier"
    expect(await renderShell("cashier-view")).toBe("cashier-view")
    // The startup slices are API reads too (T8b); the session is read once.
    expect(env.apiGet.mock.calls.filter(([path]) => path === "/api/auth/me")).toHaveLength(1)
    expect(useProfileStore.getState().authProfile).toEqual({
      id: "p-1",
      name: "Ana",
      full_name: "Ana",
      role: "cashier",
      restaurantId: "rest-1",
    })
  })

  it("shows the login on 401 and issues no startup load", async () => {
    env.meStatus = 401
    render(<Home />)
    expect(await screen.findByText("login-view")).toBeInTheDocument()
    expect(issued()).toEqual({
      config: 0,
      tables: 0,
      waiters: 0,
      orders: 0,
      currentRegister: 0,
      allRegisters: 0,
    })
    expect(useProfileStore.getState().authProfile).toBeNull()
  })

  it("a login hands the session to the shell, which renders that role", async () => {
    env.meStatus = 401
    render(<Home />)
    fireEvent.click(await screen.findByText("login-view"))
    expect(await screen.findByText("kitchen-view")).toBeInTheDocument()
    expect(useProfileStore.getState().authProfile?.role).toBe("kitchen")
    expect(env.tableGetAll).toHaveBeenCalledTimes(1)
  })

  it("goes back to the login when the client reports signed_out", async () => {
    env.role = "admin"
    await renderShell("admin-view")

    act(() => {
      emitAuthEvent("signed_out")
    })

    expect(await screen.findByText("login-view")).toBeInTheDocument()
    expect(useProfileStore.getState().authProfile).toBeNull()
    expect(useProfileStore.getState().selectedProfile).toBeNull()
  })

  it("stops listening for signed_out after unmount", async () => {
    const { unmount } = render(<Home />)
    await screen.findByText("waiter-view")
    unmount()
    useProfileStore.setState({ authProfile: { id: "x", name: "x", role: "waiter" } })

    emitAuthEvent("signed_out")

    expect(useProfileStore.getState().authProfile).toEqual({ id: "x", name: "x", role: "waiter" })
  })
})
