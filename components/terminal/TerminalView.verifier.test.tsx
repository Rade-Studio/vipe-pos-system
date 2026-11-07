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
const staff = vi.hoisted(() => ({ listSupervisors: vi.fn() }))
vi.mock("@/lib/api/staff", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/staff")>()),
  ...staff,
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
// Always in the future, whenever the suite runs: a fixed timestamp expires.
const LOCK = new Date(Date.now() + 60 * 60_000).toISOString()

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
  staff.listSupervisors.mockReset().mockResolvedValue([
    { id: "p-carlos", fullName: "Carlos Pérez", role: "admin", hasPin: true, pinLockedUntil: null },
    { id: "p-laura", fullName: "Laura Gómez", role: "cashier", hasPin: true, pinLockedUntil: null },
    { id: "p-sofia", fullName: "Sofía Ruiz", role: "cashier", hasPin: false, pinLockedUntil: null },
  ])
  auth.signOutAndReload.mockReset().mockResolvedValue(undefined)
  useCartStore.setState({ cartItems: {} })
  useProfileStore.setState({ authProfile: null, selectedProfile: null })
  clearActingToken()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe("F4 verifier probes", () => {
  it("W1 unmounting the terminal clears the acting claim (a later personal session never sends it)", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const view = render(
      <QueryClientProvider client={client}>
        <TerminalView session={opener}>{(bar) => <OrderScreen bar={bar} />}</TerminalView>
      </QueryClientProvider>,
    )
    await identifyAs("Andrés")
    expect(actingToken()).toBe("acting-p-andres")
    view.unmount()
    expect(actingToken()).toBeNull()
  })

  it("W2 a locked or failing supervisor PIN never logs out; only a 200 identify does", async () => {
    renderTerminal()
    await screen.findByRole("button", { name: /^Andrés/ })
    fireEvent.click(screen.getByRole("button", { name: "Cerrar terminal" }))
    fireEvent.click(await screen.findByRole("button", { name: /^Laura Gómez/ }))
    auth.identifyStaff.mockRejectedValueOnce(new ApiError(429, "Too Many Requests", "Demasiados intentos", { code: "pin_locked", lockedUntil: LOCK }))
    typePin("1111")
    await enter()
    expect(auth.signOutAndReload).not.toHaveBeenCalled()
    auth.identifyStaff.mockRejectedValueOnce(new ApiError(500, "Error", "boom", {}))
    fireEvent.click(screen.getByRole("button", { name: "No soy Laura Gómez" }))
    fireEvent.click(await screen.findByRole("button", { name: /^Carlos Pérez/ }))
    typePin("1111")
    await enter()
    expect(auth.signOutAndReload).not.toHaveBeenCalled()
    expect(auth.identifyStaff).toHaveBeenLastCalledWith("p-carlos", "1111")
  })

  it("W3 the close tiles come only from GET /staff/supervisors: waiters are never offered", async () => {
    renderTerminal()
    await screen.findByRole("button", { name: /^Andrés/ })
    fireEvent.click(screen.getByRole("button", { name: "Cerrar terminal" }))
    await screen.findByRole("button", { name: /^Carlos Pérez/ })
    expect(screen.queryByRole("button", { name: /^Andrés/ })).toBeNull()
    expect(screen.queryByRole("button", { name: /^Valentina/ })).toBeNull()
  })

  it("W4 no close entry while a waiter is identified on the order screen (Cambiar mesero first)", async () => {
    renderTerminal()
    await identifyAs("Andrés")
    expect(screen.queryByRole("button", { name: "Cerrar terminal" })).toBeNull()
    expect(screen.queryByRole("button", { name: /Cambiar mi PIN/ })).toBeNull()
  })
})
