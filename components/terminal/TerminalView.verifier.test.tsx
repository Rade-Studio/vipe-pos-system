import { act, fireEvent, render, screen, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Security probes of the shared terminal, kept from F4 for the F4b design
 * (the normal waiter app plus a PIN sheet): the acting claim only on writes
 * and cleared on unmount, "Salir" only through an admin or cashier PIN and
 * never offered to the waiters.
 */

const staff = vi.hoisted(() => ({ listSupervisors: vi.fn() }))
vi.mock("@/lib/api/staff", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/staff")>()), ...staff }))
const auth = vi.hoisted(() => ({ identifyByPin: vi.fn(), identifyStaff: vi.fn(), signOutAndReload: vi.fn() }))
vi.mock("@/lib/api/auth", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/auth")>()), ...auth }))
vi.mock("@/components/theme/theme-toggle", () => ({ ThemeToggle: () => null }))

import { Header } from "@/components/layout/Header"
import { createApiClient } from "@/lib/api/client"
import { ApiError } from "@/lib/api/errors"
import { actingToken, clearActingToken } from "@/lib/terminal/acting"
import { useProfileStore } from "@/store/useProfileStore"
import { TerminalView } from "./TerminalView"
import { useTerminal } from "./terminal-context"

const opener = {
  user: { id: "u-laura", email: "laura@a.test" },
  profile: { id: "p-laura", name: "Laura Gómez", role: "cashier", restaurantId: "r-1" },
  sessionKind: "terminal" as const,
}
const andres = { token: "acting-p-andres", expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(), profile: { id: "p-andres", name: "Andrés", role: "waiter" } }

/** An API client with an absolute origin (Node's Request needs one). */
const ordersApi = createApiClient({ baseUrl: "http://localhost:3000", fetch: (request) => globalThis.fetch(request) })
function Screen() {
  const terminal = useTerminal()
  return (
    <div>
      <Header profile={{ id: "p-laura", name: "Laura Gómez", role: "cashier" }} onChangeProfile={() => {}} />
      <button type="button" onClick={() => void terminal?.ensureIdentity({ tableId: "t-7", label: "Mesa 7" })}>
        Mesa 7
      </button>
      <button type="button" onClick={() => void ordersApi.POST("/api/orders", { body: {} as never })}>
        Enviar a cocina
      </button>
      <button type="button" onClick={() => void ordersApi.GET("/api/tables")}>
        Leer mesas
      </button>
    </div>
  )
}

function renderTerminal() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <TerminalView session={opener}>
        <Screen />
      </TerminalView>
    </QueryClientProvider>,
  )
}

const typePin = async (pin: string, submit: string) => {
  const pad = within(screen.getByRole("group", { name: "Teclado del PIN" }))
  for (const digit of pin) fireEvent.click(pad.getByRole("button", { name: digit }))
  await act(async () => {
    fireEvent.click(pad.getByRole("button", { name: submit }))
  })
}
const identifyAndres = async () => {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Mesa 7" }))
  })
  await typePin("4829", "Entrar")
}
const openSalir = async () => {
  fireEvent.click(screen.getByRole("button", { name: /Salir|Cerrar Sesión/ }))
  return screen.findByRole("radio", { name: /Carlos Pérez/ })
}

beforeEach(() => {
  auth.identifyByPin.mockReset().mockResolvedValue(andres)
  auth.identifyStaff.mockReset().mockResolvedValue({ ...andres, profile: { id: "p-carlos", name: "Carlos Pérez", role: "admin" } })
  auth.signOutAndReload.mockReset().mockResolvedValue(undefined)
  staff.listSupervisors.mockReset().mockResolvedValue([
    { id: "p-carlos", fullName: "Carlos Pérez", role: "admin", hasPin: true, pinLockedUntil: null },
    { id: "p-laura", fullName: "Laura Gómez", role: "cashier", hasPin: true, pinLockedUntil: null },
  ])
  useProfileStore.setState({ authProfile: null, selectedProfile: null })
  clearActingToken()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("shared terminal security probes", () => {
  it("W1 unmounting the terminal clears the acting claim", async () => {
    const view = renderTerminal()
    await identifyAndres()
    expect(actingToken()).toBe("acting-p-andres")
    view.unmount()
    expect(actingToken()).toBeNull()
  })

  it("W2 a locked or failing supervisor PIN never logs out; only a valid one does", async () => {
    renderTerminal()
    fireEvent.click(await openSalir())
    auth.identifyStaff.mockRejectedValueOnce(
      new ApiError(429, "Too Many Requests", "Demasiados intentos", { code: "pin_locked", lockedUntil: new Date(Date.now() + 60_000).toISOString() }),
    )
    await typePin("1111", "Salir")
    expect(auth.signOutAndReload).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Atrás" }))
    fireEvent.click(await screen.findByRole("radio", { name: /Laura Gómez/ }))
    auth.identifyStaff.mockRejectedValueOnce(new ApiError(500, "Error", "boom", {}))
    await typePin("5820", "Salir")
    expect(auth.signOutAndReload).not.toHaveBeenCalled()
    await typePin("5821", "Salir")
    expect(auth.identifyStaff).toHaveBeenLastCalledWith("p-laura", "5821")
    expect(auth.signOutAndReload).toHaveBeenCalledTimes(1)
  })

  it("W3 Salir offers only GET /staff/supervisors (never the waiters), also while a waiter is identified", async () => {
    renderTerminal()
    await identifyAndres()
    await openSalir()
    expect(screen.getAllByRole("radio").map((tile) => tile.textContent)).toEqual([
      expect.stringContaining("Carlos Pérez"),
      expect.stringContaining("Laura Gómez"),
    ])
    expect(screen.queryByRole("radio", { name: /Andrés/ })).toBeNull()
  })

  it("W4 the acting claim goes only on writes, and not after Terminar", async () => {
    const seen: [string, string | null][] = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (request: Request) => {
        seen.push([request.method, request.headers.get("X-Vipe-Acting")])
        return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } })
      }),
    )
    renderTerminal()
    await identifyAndres()
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Leer mesas" }))
      fireEvent.click(screen.getByRole("button", { name: "Enviar a cocina" }))
    })
    fireEvent.click(screen.getByRole("button", { name: "Terminar" }))
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Enviar a cocina" }))
    })
    expect(seen).toEqual([
      ["GET", null],
      ["POST", "acting-p-andres"],
      ["POST", null],
    ])
  })

  it("W5 nobody changes a PIN on the terminal, identified or not", async () => {
    renderTerminal()
    expect(screen.queryByRole("button", { name: /Cambiar mi PIN/ })).toBeNull()
    await identifyAndres()
    expect(screen.queryByRole("button", { name: /Cambiar mi PIN/ })).toBeNull()
  })
})
