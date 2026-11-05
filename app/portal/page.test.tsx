import { StrictMode } from "react"
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

const loginViewRenders = vi.hoisted(() => vi.fn())
vi.mock("@/components/auth/LoginView", () => ({
  LoginView: ({ onLoginSuccess }: { onLoginSuccess: (session: unknown) => void }) => {
    loginViewRenders()
    return <button onClick={() => onLoginSuccess(sessionFor("kitchen", "u-2"))}>login-view</button>
  },
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
  loginViewRenders.mockReset()
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

/** Holds `GET /api/auth/me` open until the test settles it. */
function holdInitialCheck() {
  let settle!: (outcome: "session" | "null" | "throw") => void
  const pending = new Promise<"session" | "null" | "throw">((resolve) => {
    settle = resolve
  })
  const base = env.apiGet.getMockImplementation()!
  env.apiGet.mockImplementation(async (path: string, init?: any) => {
    if (path !== "/api/auth/me") return base(path, init)
    const outcome = await pending
    if (outcome === "session") return base(path, init)
    if (outcome === "throw") throw new Error("network down")
    throw new ApiError(401, "Unauthorized", "Missing access token")
  })
  return settle
}

describe("the loader covers the initial session check", () => {
  // F1 / S3: the hung chain's refused refresh still belongs to the pre-login cookies.
  it("a login after the check timed out survives that check's late signed_out", async () => {
    vi.useFakeTimers()
    try {
      holdInitialCheck()
      render(<Home />)
      await act(async () => {})
      await act(async () => {
        vi.advanceTimersByTime(10_000)
      })
      fireEvent.click(screen.getByText("login-view"))
      await act(async () => {})
      await act(async () => {
        emitAuthEvent("signed_out")
      })
      expect(screen.getByText("kitchen-view")).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it("StrictMode restores the session and runs the loads once", async () => {
    env.role = "cashier"
    render(
      <StrictMode>
        <Home />
      </StrictMode>,
    )
    await screen.findByText("cashier-view")
    await act(async () => {})
    expect(issued()).toEqual({ config: 1, tables: 1, waiters: 1, orders: 0, currentRegister: 0, allRegisters: 0 })
  })

  // F2 / S3: as on dev, a restored session shows its view while startup loads run.
  it("a restored session shows the role view while a startup load is pending", async () => {
    env.role = "cashier"
    env.tableGetAll.mockImplementation(() => new Promise(() => {}))
    render(<Home />)
    expect(await screen.findByText("cashier-view")).toBeInTheDocument()
  })

  it("shows the loader, never the form, while the check is pending", async () => {
    holdInitialCheck()
    render(<Home />)
    // Let every mount effect and microtask run: the check is still open.
    await act(async () => {})
    expect(screen.getByText("Cargando Sistema POS")).toBeInTheDocument()
    expect(screen.queryByText("login-view")).not.toBeInTheDocument()
    expect(loginViewRenders).not.toHaveBeenCalled()
  })

  it("shows the form when the check hangs past its time limit", async () => {
    vi.useFakeTimers()
    try {
      holdInitialCheck()
      render(<Home />)
      await act(async () => {})
      expect(screen.getByText("Cargando Sistema POS")).toBeInTheDocument()
      await act(async () => {
        vi.advanceTimersByTime(10_000)
      })
      expect(screen.getByText("login-view")).toBeInTheDocument()
      expect(screen.queryByText("Cargando Sistema POS")).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it("shows the form once the check resolves to no session", async () => {
    const settle = holdInitialCheck()
    render(<Home />)
    await act(async () => {
      settle("null")
    })
    expect(await screen.findByText("login-view")).toBeInTheDocument()
    expect(screen.queryByText("Cargando Sistema POS")).not.toBeInTheDocument()
  })

  it("shows the form when the check fails", async () => {
    const settle = holdInitialCheck()
    render(<Home />)
    await act(async () => {
      settle("throw")
    })
    expect(await screen.findByText("login-view")).toBeInTheDocument()
  })

  it("goes from the loader straight to the role view, never rendering the form", async () => {
    env.role = "cashier"
    const settle = holdInitialCheck()
    render(<Home />)
    await act(async () => {})
    expect(screen.getByText("Cargando Sistema POS")).toBeInTheDocument()
    await act(async () => {
      settle("session")
    })
    expect(await screen.findByText("cashier-view")).toBeInTheDocument()
    expect(loginViewRenders).not.toHaveBeenCalled()
  })

  // Verifier probes of 056c386: the late result of a timed-out check never
  // undoes a later login, and a genuine signed_out still reaches the form.
  async function loginAfterTimeoutThenSettle(outcome: "null" | "throw" | "session", strict: boolean) {
    vi.useFakeTimers()
    try {
      const settle = holdInitialCheck()
      render(strict ? <StrictMode><Home /></StrictMode> : <Home />)
      await act(async () => {})
      await act(async () => {
        vi.advanceTimersByTime(10_000)
      })
      fireEvent.click(screen.getByText("login-view"))
      await act(async () => {})
      await act(async () => {
        settle(outcome)
      })
      await act(async () => {})
      expect(screen.getByText("kitchen-view")).toBeInTheDocument()
      await act(async () => {
        emitAuthEvent("signed_out")
      })
      expect(screen.getByText("login-view")).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  }

  for (const outcome of ["null", "throw", "session"] as const) {
    it(`P1: a login after the timeout survives a late "${outcome}" check, then signs out`, async () => {
      await loginAfterTimeoutThenSettle(outcome, false)
    })

    it(`P2: the same under StrictMode with a late "${outcome}" check`, async () => {
      await loginAfterTimeoutThenSettle(outcome, true)
    })
  }

  it("P3: a StrictMode admin session is restored, then signed_out shows the form", async () => {
    env.role = "admin"
    render(
      <StrictMode>
        <Home />
      </StrictMode>,
    )
    await screen.findByText("admin-view")
    await act(async () => {
      emitAuthEvent("signed_out")
    })
    expect(await screen.findByText("login-view")).toBeInTheDocument()
  })

  it("P4: a cashier session restored with tables pending, then signed_out shows the form", async () => {
    env.role = "cashier"
    env.tableGetAll.mockImplementation(() => new Promise(() => {}))
    render(<Home />)
    await screen.findByText("cashier-view")
    await act(async () => {
      emitAuthEvent("signed_out")
    })
    expect(await screen.findByText("login-view")).toBeInTheDocument()
  })

  it("P6: after a timeout with no login, a late signed_out keeps the form", async () => {
    vi.useFakeTimers()
    try {
      holdInitialCheck()
      render(<Home />)
      await act(async () => {})
      await act(async () => {
        vi.advanceTimersByTime(10_000)
      })
      await act(async () => {
        emitAuthEvent("signed_out")
      })
      expect(screen.getByText("login-view")).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })
})

/**
 * D3 smoke, adapted: the form is gated behind the initial check, so a login
 * can no longer start while that check is pending. These pin that the window
 * stays closed and that the post-check login and sign-out still behave.
 */
describe("a login around the initial session check (D3 smoke)", () => {
  it("no login can start while the check is pending, and its null result never clears a later login", async () => {
    const settle = holdInitialCheck()
    render(<Home />)
    await act(async () => {
      // The refused refresh of the initial chain arrives while it is pending.
      emitAuthEvent("signed_out")
    })
    expect(screen.queryByText("login-view")).not.toBeInTheDocument()

    await act(async () => {
      settle("null")
    })
    fireEvent.click(await screen.findByText("login-view"))
    expect(await screen.findByText("kitchen-view")).toBeInTheDocument()
    expect(useProfileStore.getState().authProfile?.role).toBe("kitchen")
  })

  it("a failed initial check offers the form, and the login that follows sticks", async () => {
    const settle = holdInitialCheck()
    render(<Home />)
    await act(async () => {
      settle("throw")
    })
    fireEvent.click(await screen.findByText("login-view"))
    await screen.findByText("kitchen-view")
    await act(async () => {})

    expect(screen.getByText("kitchen-view")).toBeInTheDocument()
    expect(useProfileStore.getState().authProfile?.role).toBe("kitchen")
  })

  it("a genuine signed_out after the login and the settled check returns to the form", async () => {
    const settle = holdInitialCheck()
    render(<Home />)
    await act(async () => {
      settle("null")
    })
    fireEvent.click(await screen.findByText("login-view"))
    await screen.findByText("kitchen-view")

    act(() => {
      emitAuthEvent("signed_out")
    })

    expect(await screen.findByText("login-view")).toBeInTheDocument()
    expect(useProfileStore.getState().authProfile).toBeNull()
  })
})
