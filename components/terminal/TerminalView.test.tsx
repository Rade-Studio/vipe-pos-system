import { act, fireEvent, render, screen, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * F4b (S1 b, L20-L22) — the shared terminal is the normal waiter app: the
 * same Header, and a PIN sheet when an order-writing entry (a table tap) has
 * no valid identity. Expiry keeps the cart; a different person on a table
 * with someone else's unsent products chooses Continuar or Descartar.
 */

const staff = vi.hoisted(() => ({ listSupervisors: vi.fn() }))
vi.mock("@/lib/api/staff", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/staff")>()), ...staff }))
const auth = vi.hoisted(() => ({ identifyByPin: vi.fn(), identifyStaff: vi.fn(), unlockTerminal: vi.fn(), signOutAndReload: vi.fn() }))
vi.mock("@/lib/api/auth", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/auth")>()), ...auth }))
vi.mock("@/components/theme/theme-toggle", () => ({ ThemeToggle: () => null }))

import { Header } from "@/components/layout/Header"
import { ApiError } from "@/lib/api/errors"
import { clockTime } from "@/lib/terminal/format"
import { actingToken, clearActingToken } from "@/lib/terminal/acting"
import { useCartStore } from "@/store/useCartStore"
import { useProfileStore } from "@/store/useProfileStore"
import type { CartItem } from "@/types"
import { TerminalView } from "./TerminalView"
import { useTerminal } from "./terminal-context"

const opener = {
  user: { id: "u-laura", email: "laura@a.test" },
  profile: { id: "p-laura", name: "Laura Gómez", role: "cashier", restaurantId: "r-1" },
  sessionKind: "terminal" as const,
}
const PEOPLE: Record<string, { id: string; name: string; role: string }> = {
  "4829": { id: "p-andres", name: "Andrés Mora", role: "waiter" },
  "73914": { id: "p-vale", name: "Valentina Ríos", role: "waiter" },
}
const entered: string[] = []

/** Stands for WaiterView: the real Header and one table whose tap is an order-writing entry. */
function Screen() {
  const terminal = useTerminal()
  const who = useProfileStore((s) => s.selectedProfile)
  return (
    <div>
      <Header profile={who ?? { id: "p-laura", name: "Laura Gómez", role: "cashier" }} onChangeProfile={() => {}} />
      <button
        type="button"
        onClick={() => void terminal?.ensureIdentity({ tableId: "t-7", label: "Mesa 7" }).then((ok) => ok && entered.push(useProfileStore.getState().selectedProfile!.id))}
      >
        Mesa 7
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

const pad = () => within(screen.getByRole("group", { name: "Teclado del PIN" }))
const typePin = async (pin: string, submit = "Entrar") => {
  for (const digit of pin) fireEvent.click(pad().getByRole("button", { name: digit }))
  await act(async () => {
    fireEvent.click(pad().getByRole("button", { name: submit }))
  })
}
const tapTable = async () => {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Mesa 7" }))
  })
}
const item = (id: string, quantity: number): CartItem => ({ id, name: id, price: 1000, quantity } as CartItem)

beforeEach(() => {
  entered.length = 0
  auth.identifyByPin.mockReset().mockImplementation(async (pin: string) => {
    const profile = PEOPLE[pin]
    if (!profile) throw new ApiError(403, "Forbidden", "PIN incorrecto", { code: "pin_invalid" })
    return { token: `acting-${profile.id}`, expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(), profile }
  })
  auth.identifyStaff.mockReset().mockResolvedValue({ token: "acting-sup", expiresAt: new Date().toISOString(), profile: { id: "p-carlos", name: "Carlos Pérez", role: "admin" } })
  auth.unlockTerminal.mockReset().mockResolvedValue(undefined)
  auth.signOutAndReload.mockReset().mockResolvedValue(undefined)
  staff.listSupervisors.mockReset().mockResolvedValue([
    { id: "p-carlos", fullName: "Carlos Pérez", role: "admin", hasPin: true, pinLockedUntil: null },
    { id: "p-sofia", fullName: "Sofía Ruiz", role: "cashier", hasPin: false, pinLockedUntil: null },
  ])
  useCartStore.setState({ cartItems: {} })
  useProfileStore.setState({ authProfile: null, selectedProfile: null })
  clearActingToken()
})

afterEach(() => {
  vi.useRealTimers()
})

describe("shared terminal inside the normal waiter screen (F4b)", () => {
  it("has no waiter grid or terminal screens: the same header, without Cambiar mi PIN", () => {
    renderTerminal()
    expect(screen.queryByText("¿Quién toma el pedido?")).toBeNull()
    expect(screen.queryByText("Terminal de pedidos")).toBeNull()
    expect(screen.getByRole("button", { name: /Salir|Cerrar Sesión/ })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Cambiar mi PIN/ })).toBeNull()
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("a table tap asks the PIN; a valid PIN says who it is and the entry continues as them", async () => {
    renderTerminal()
    await tapTable()
    const sheet = screen.getByRole("dialog")
    expect(within(sheet).getByRole("heading", { name: "Mesa 7 · Escribe tu PIN" })).toBeInTheDocument()
    expect(entered).toEqual([])
    await typePin("4829")
    expect(auth.identifyByPin).toHaveBeenCalledWith("4829")
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(entered).toEqual(["p-andres"])
    expect(actingToken()).toBe("acting-p-andres")
    expect(screen.getByRole("status")).toHaveTextContent("Andrés · 5:00")
    // While valid, the next tap goes straight in.
    await tapTable()
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(entered).toEqual(["p-andres", "p-andres"])
  })

  it("a wrong PIN shows PIN no válido and identifies nobody; closing the sheet cancels the entry", async () => {
    renderTerminal()
    await tapTable()
    await typePin("5820")
    expect(screen.getByRole("alert")).toHaveTextContent("PIN no válido")
    expect(actingToken()).toBeNull()
    auth.identifyByPin.mockRejectedValueOnce(
      new ApiError(409, "Conflict", "Ese PIN lo tiene más de una persona; pide al administrador que lo cambie", { code: "pin_ambiguous" }),
    )
    await typePin("6408")
    expect(screen.getByRole("alert")).toHaveTextContent("Ese PIN lo tiene más de una persona")
    fireEvent.click(screen.getByRole("button", { name: "Cerrar" }))
    await act(async () => {})
    expect(entered).toEqual([])
  })

  it("the header counts down, Terminar ends the identity, and expiry asks the PIN again keeping the cart", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false, toFake: ["setInterval", "clearInterval", "Date"] })
    renderTerminal()
    await tapTable()
    await typePin("4829")
    act(() => {
      useCartStore.getState().addToCart("t-7", item("arepa", 2))
    })
    await act(async () => {
      vi.advanceTimersByTime(48_000)
    })
    expect(screen.getByRole("status")).toHaveTextContent("Andrés · 4:12")
    await act(async () => {
      vi.advanceTimersByTime(4 * 60_000 + 12_000)
    })
    expect(screen.queryByRole("status")).toBeNull()
    expect(actingToken()).toBeNull()
    expect(useCartStore.getState().cartItems["t-7"]).toHaveLength(1)
    await tapTable()
    expect(screen.getByRole("heading", { name: "Mesa 7 · Escribe tu PIN" })).toBeInTheDocument()
    await typePin("4829")
    // Same person: no warning, straight back to the table.
    expect(entered).toEqual(["p-andres", "p-andres"])
    fireEvent.click(screen.getByRole("button", { name: "Terminar" }))
    expect(screen.queryByRole("status")).toBeNull()
    expect(actingToken()).toBeNull()
  })

  it("a different person on a table with someone else's unsent products: Continuar keeps them", async () => {
    renderTerminal()
    await tapTable()
    await typePin("4829")
    act(() => {
      useCartStore.getState().addToCart("t-7", item("arepa", 2))
      useCartStore.getState().addToCart("t-7", item("jugo", 1))
    })
    fireEvent.click(screen.getByRole("button", { name: "Terminar" }))
    await tapTable()
    await typePin("73914")
    expect(screen.getByRole("heading", { name: "Andrés dejó 3 productos sin enviar" })).toBeInTheDocument()
    expect(entered).toEqual(["p-andres"])
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Continuar" }))
    })
    expect(entered).toEqual(["p-andres", "p-vale"])
    expect(useCartStore.getState().cartItems["t-7"]).toHaveLength(2)
    // Now they are Valentina's: Andrés is the one warned.
    fireEvent.click(screen.getByRole("button", { name: "Terminar" }))
    await tapTable()
    await typePin("4829")
    expect(screen.getByRole("heading", { name: "Valentina dejó 3 productos sin enviar" })).toBeInTheDocument()
  })

  it("Descartar clears the other person's unsent products and continues", async () => {
    renderTerminal()
    await tapTable()
    await typePin("4829")
    act(() => {
      useCartStore.getState().addToCart("t-7", item("arepa", 1))
    })
    fireEvent.click(screen.getByRole("button", { name: "Terminar" }))
    await tapTable()
    await typePin("73914")
    expect(screen.getByRole("heading", { name: "Andrés dejó 1 producto sin enviar" })).toBeInTheDocument()
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Descartar" }))
    })
    expect(useCartStore.getState().cartItems["t-7"]).toEqual([])
    expect(entered).toEqual(["p-andres", "p-vale"])
  })

  it("5 wrong PINs lock the tablet; a supervisor PIN unlocks it early", async () => {
    const until = new Date(Date.now() + 5 * 60_000).toISOString()
    renderTerminal()
    await tapTable()
    auth.identifyByPin.mockRejectedValueOnce(
      new ApiError(429, "Too Many Requests", "Demasiados intentos fallidos. Espera 5 minutos e inténtalo de nuevo", { code: "pin_locked", lockedUntil: until }),
    )
    await typePin("1111")
    expect(screen.getByRole("heading", { name: `Tablet bloqueada hasta ${clockTime(until)}` })).toBeInTheDocument()
    expect(pad().getByRole("button", { name: "1" })).toBeDisabled()
    // Closing and tapping again keeps the lock.
    fireEvent.click(screen.getByRole("button", { name: "Cerrar" }))
    await tapTable()
    expect(screen.getByRole("heading", { name: /Tablet bloqueada/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Desbloquear con PIN de supervisor" }))
    const carlos = await screen.findByRole("radio", { name: /Carlos Pérez/ })
    expect(screen.getByRole("radio", { name: /Sofía Ruiz/ })).toHaveTextContent("Sin PIN")
    expect(screen.queryByRole("radio", { name: /Andrés|Valentina/ })).toBeNull()
    fireEvent.click(carlos)
    await typePin("9157", "Desbloquear")
    expect(auth.unlockTerminal).toHaveBeenCalledWith("p-carlos", "9157")
    expect(screen.getByRole("heading", { name: "Mesa 7 · Escribe tu PIN" })).toBeInTheDocument()
    await typePin("4829")
    expect(entered).toEqual(["p-andres"])
  })

  it("a wrong supervisor PIN does not unlock the tablet", async () => {
    const until = new Date(Date.now() + 5 * 60_000).toISOString()
    renderTerminal()
    await tapTable()
    auth.identifyByPin.mockRejectedValueOnce(new ApiError(429, "Too Many Requests", "Demasiados", { code: "pin_locked", lockedUntil: until }))
    await typePin("1111")
    fireEvent.click(screen.getByRole("button", { name: "Desbloquear con PIN de supervisor" }))
    fireEvent.click(await screen.findByRole("radio", { name: /Carlos Pérez/ }))
    auth.unlockTerminal.mockRejectedValueOnce(new ApiError(403, "Forbidden", "PIN incorrecto", { code: "pin_invalid" }))
    await typePin("5820", "Desbloquear")
    expect(screen.getByRole("alert")).toHaveTextContent("PIN no válido")
    fireEvent.click(screen.getByRole("button", { name: "Atrás" }))
    fireEvent.click(screen.getByRole("button", { name: "Atrás" }))
    expect(screen.getByRole("heading", { name: /Tablet bloqueada/ })).toBeInTheDocument()
  })
})
