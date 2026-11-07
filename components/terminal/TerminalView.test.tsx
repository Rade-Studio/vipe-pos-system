import { act, fireEvent, render, screen, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * F4 (S1 b) — shared order-taking terminal on a tablet
 * (design/acceso-meseros/02-terminal-compartida.html): tap your name, type your
 * PIN, take the order as yourself for 5 minutes; expiry keeps the unsent cart;
 * closing the terminal needs the PIN of the admin or cashier who opened it.
 */

const tables = vi.hoisted(() => ({ getWaiters: vi.fn() }))
vi.mock("@/lib/api/tables", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/tables")>()),
  ...tables,
}))
const auth = vi.hoisted(() => ({ identifyStaff: vi.fn(), signOutAndReload: vi.fn() }))
vi.mock("@/lib/api/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/auth")>()),
  ...auth,
}))
vi.mock("@/components/theme/theme-toggle", () => ({ ThemeToggle: () => null }))

import { createApiClient } from "@/lib/api/client"
import { ApiError } from "@/lib/api/errors"
import { clockTime } from "@/lib/terminal/format"
import { actingToken, clearActingToken } from "@/lib/terminal/acting"
import { useCartStore } from "@/store/useCartStore"
import { useProfileStore } from "@/store/useProfileStore"
import { TerminalView } from "./TerminalView"

const opener = {
  user: { id: "u-laura", email: "laura@a.test" },
  profile: { id: "p-laura", name: "Laura Gómez", role: "cashier", restaurantId: "r-1" },
  sessionKind: "terminal" as const,
}
const identity = (id: string, name: string, role = "waiter") => ({
  token: `acting-${id}`,
  expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
  profile: { id, name, role },
})
const LOCK = "2026-11-07T17:49:00.000Z"

/**
 * The order screen the terminal wraps (WaiterView in the app): it writes an
 * order through an API client (absolute origin: Node's Request needs one).
 */
const ordersApi = createApiClient({ baseUrl: "http://localhost:3000", fetch: (request) => globalThis.fetch(request) })
function OrderScreen({ bar }: { bar: React.ReactNode }) {
  const api = ordersApi
  const who = useProfileStore((s) => s.selectedProfile)
  return (
    <div>
      {bar}
      <p>pedido de {who?.name}</p>
      <button type="button" onClick={() => void api.POST("/api/orders", { body: {} as never })}>
        Enviar a cocina
      </button>
    </div>
  )
}

function renderTerminal() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <TerminalView session={opener}>{(bar) => <OrderScreen bar={bar} />}</TerminalView>
    </QueryClientProvider>,
  )
}

const typePin = (pin: string) => {
  const pad = screen.getByRole("group", { name: "Teclado del PIN" })
  for (const digit of pin) fireEvent.click(within(pad).getByRole("button", { name: digit }))
  return pad
}
const enter = async () => {
  await act(async () => {
    fireEvent.click(within(screen.getByRole("group", { name: "Teclado del PIN" })).getByRole("button", { name: "Entrar" }))
  })
}
const identifyAs = async (name: string, pin = "4829") => {
  fireEvent.click(await screen.findByRole("button", { name: new RegExp(`^${name}`) }))
  typePin(pin)
  await enter()
}

beforeEach(() => {
  tables.getWaiters.mockReset().mockResolvedValue([
    { id: "p-andres", name: "Andrés", username: null },
    { id: "p-vale", name: "Valentina Ríos", username: null },
  ])
  auth.identifyStaff.mockReset().mockImplementation(async (id: string) => identity(id, id === "p-andres" ? "Andrés" : "Laura Gómez"))
  auth.signOutAndReload.mockReset().mockResolvedValue(undefined)
  useCartStore.setState({ cartItems: {} })
  useProfileStore.setState({ authProfile: null, selectedProfile: null })
  clearActingToken()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe("TerminalView", () => {
  it("shows every waiter by name and initials, and who opened the terminal", async () => {
    renderTerminal()
    expect(await screen.findByRole("heading", { name: "¿Quién toma el pedido?" })).toBeInTheDocument()
    const andres = await screen.findByRole("button", { name: /^Andrés/ })
    expect(within(andres).getByText("A")).toBeInTheDocument()
    expect(within(screen.getByRole("button", { name: /^Valentina Ríos/ })).getByText("VR")).toBeInTheDocument()
    expect(screen.getByText("Abierta por Laura Gómez (Caja)")).toBeInTheDocument()
    expect(screen.queryByText(/pedido de/)).toBeNull()
  })

  it("has PIN keys of at least 56 px", async () => {
    renderTerminal()
    fireEvent.click(await screen.findByRole("button", { name: /^Andrés/ }))
    const pad = screen.getByRole("group", { name: "Teclado del PIN" })
    for (const key of within(pad).getAllByRole("button")) expect(key.className).toMatch(/\bmin-h-16\b/)
  })

  it("identifies the waiter by PIN, counts the 5 minutes down and keeps the unsent cart on expiry", async () => {
    renderTerminal()
    fireEvent.click(await screen.findByRole("button", { name: /^Andrés/ }))
    expect(screen.getByRole("heading", { name: "Hola, Andrés" })).toBeInTheDocument()
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"], now: new Date("2026-11-07T17:00:00.000Z") })
    typePin("4829")
    await enter()

    expect(auth.identifyStaff).toHaveBeenCalledWith("p-andres", "4829")
    expect(screen.getByText("pedido de Andrés")).toBeInTheDocument()
    expect(useProfileStore.getState().authProfile).toMatchObject({ id: "p-andres", role: "waiter" })
    expect(actingToken()).toBe("acting-p-andres")
    expect(screen.getByRole("status")).toHaveTextContent("Andrés · 5:00")
    act(() => vi.advanceTimersByTime(48_000))
    expect(screen.getByRole("status")).toHaveTextContent("Andrés · 4:12")

    useCartStore.setState({ cartItems: { "t-7": [{ id: "d-1", name: "Bandeja paisa", price: 32000, quantity: 2 } as never] } })
    act(() => vi.advanceTimersByTime(4 * 60_000 + 12_000))
    const expired = screen.getByRole("dialog", { name: "Pasaron 5 minutos sin identificarte" })
    expect(within(expired).getByText(/El pedido sigue aquí, sin enviar/)).toBeInTheDocument()
    expect(actingToken()).toBeNull()
    expect(useCartStore.getState().cartItems["t-7"]).toHaveLength(1)

    fireEvent.click(within(expired).getByRole("button", { name: "Soy otro mesero" }))
    expect(screen.getByRole("heading", { name: "¿Quién toma el pedido?" })).toBeInTheDocument()
    expect(useCartStore.getState().cartItems["t-7"]).toHaveLength(1)
  })

  it("lets the same waiter continue after the expiry with their PIN", async () => {
    renderTerminal()
    fireEvent.click(await screen.findByRole("button", { name: /^Andrés/ }))
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"], now: new Date("2026-11-07T17:00:00.000Z") })
    typePin("4829")
    await enter()
    act(() => vi.advanceTimersByTime(5 * 60_000))
    fireEvent.click(screen.getByRole("button", { name: "Seguir como Andrés" }))
    typePin("4829")
    await enter()
    expect(auth.identifyStaff).toHaveBeenCalledTimes(2)
    expect(screen.getByText("pedido de Andrés")).toBeInTheDocument()
    expect(screen.getByRole("status")).toHaveTextContent("Andrés · 5:00")
  })

  it("sends the acting claim on the order writes, and stops when the waiter changes", async () => {
    const seen: Array<string | null> = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (request: Request) => {
        seen.push(request.headers.get("X-Vipe-Acting"))
        return new Response("{}", { status: 201, headers: { "Content-Type": "application/json" } })
      }),
    )
    renderTerminal()
    await identifyAs("Andrés")
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Enviar a cocina" }))
    })
    expect(seen).toEqual(["acting-p-andres"])

    fireEvent.click(screen.getByRole("button", { name: "Cambiar mesero" }))
    expect(screen.getByRole("heading", { name: "¿Quién toma el pedido?" })).toBeInTheDocument()
    expect(actingToken()).toBeNull()
  })

  it("says a wrong PIN, keeps the waiter and clears the dots", async () => {
    auth.identifyStaff.mockRejectedValueOnce(new ApiError(403, "Forbidden", "PIN incorrecto", { code: "pin_invalid" }))
    renderTerminal()
    await identifyAs("Andrés", "1111")
    expect(screen.getByRole("alert")).toHaveTextContent("PIN incorrecto.")
    expect(screen.getByRole("alert")).toHaveTextContent("5 intentos fallidos lo bloquean 5 minutos")
    expect(screen.getByRole("heading", { name: "Hola, Andrés" })).toBeInTheDocument()
    expect(screen.getByLabelText("0 dígitos escritos")).toBeInTheDocument()
    expect(actingToken()).toBeNull()
  })

  it("shows until when a locked PIN is blocked, disables the pad and marks the waiter in the grid", async () => {
    auth.identifyStaff.mockRejectedValueOnce(
      new ApiError(429, "Too Many Requests", "Demasiados intentos fallidos. Espera 5 minutos e inténtalo de nuevo", {
        code: "pin_locked",
        lockedUntil: LOCK,
      }),
    )
    renderTerminal()
    await identifyAs("Valentina Ríos")
    expect(screen.getByRole("alert")).toHaveTextContent(`Bloqueado hasta ${clockTime(LOCK)}.`)
    const pad = screen.getByRole("group", { name: "Teclado del PIN" })
    for (const key of within(pad).getAllByRole("button")) expect(key).toBeDisabled()
    fireEvent.click(screen.getByRole("button", { name: "No soy Valentina Ríos" }))
    expect(within(screen.getByRole("button", { name: /^Valentina Ríos/ })).getByText(`Bloqueado hasta ${clockTime(LOCK)}`)).toBeInTheDocument()
  })

  it("closes the terminal only with the PIN of the admin or cashier who opened it", async () => {
    renderTerminal()
    await screen.findByRole("button", { name: /^Andrés/ })
    fireEvent.click(screen.getByRole("button", { name: "Cerrar terminal" }))
    expect(screen.getByRole("heading", { name: "Cerrar terminal" })).toBeInTheDocument()
    expect(screen.getByText(/Laura Gómez \(Caja\) escribe su PIN/)).toBeInTheDocument()

    auth.identifyStaff.mockRejectedValueOnce(new ApiError(403, "Forbidden", "PIN incorrecto", { code: "pin_invalid" }))
    typePin("1111")
    await enter()
    expect(auth.identifyStaff).toHaveBeenLastCalledWith("p-laura", "1111")
    expect(auth.signOutAndReload).not.toHaveBeenCalled()
    expect(screen.getByRole("alert")).toHaveTextContent("PIN incorrecto.")

    typePin("582046")
    await enter()
    expect(auth.identifyStaff).toHaveBeenLastCalledWith("p-laura", "582046")
    expect(auth.signOutAndReload).toHaveBeenCalledTimes(1)
    expect(actingToken()).toBeNull()
  })

  it("goes back from closing without logging out", async () => {
    renderTerminal()
    await screen.findByRole("button", { name: /^Andrés/ })
    fireEvent.click(screen.getByRole("button", { name: "Cerrar terminal" }))
    fireEvent.click(screen.getByRole("button", { name: "Volver" }))
    expect(screen.getByRole("heading", { name: "¿Quién toma el pedido?" })).toBeInTheDocument()
    expect(auth.signOutAndReload).not.toHaveBeenCalled()
  })
})
