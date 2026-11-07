import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError } from "@/lib/api/errors"

/** T7 (S2): signing out revokes the API session, then reloads the portal. */

const api = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn(), PUT: vi.fn() }))
vi.mock("@/lib/api/client", () => ({ api }))
vi.mock("@/components/theme/theme-toggle", () => ({ ThemeToggle: () => null }))
const toast = vi.hoisted(() => vi.fn())
vi.mock("@/components/ui/use-toast", () => ({ toast, useToast: () => ({ toast }) }))
vi.mock("@/hooks/use-toast", () => ({ toast, useToast: () => ({ toast }) }))

import { Header } from "./Header"
import { TerminalContext } from "@/components/terminal/terminal-context"

const original = window.location

beforeEach(() => {
  api.POST.mockReset()
  api.PUT.mockReset()
  toast.mockReset()
  Object.defineProperty(window, "location", { configurable: true, value: { href: "/portal/x" } })
})

afterEach(() => {
  Object.defineProperty(window, "location", { configurable: true, value: original })
})

const profile = { id: "p-1", name: "Admin Dev", role: "admin" as const }

describe("Header sign-out", () => {
  it("calls POST /api/auth/logout and reloads /portal", async () => {
    api.POST.mockResolvedValue({ data: undefined })
    render(<Header profile={profile} onChangeProfile={vi.fn()} />)

    fireEvent.click(screen.getByRole("button", { name: /salir|cerrar sesión/i }))

    await waitFor(() => expect(window.location.href).toBe("/portal"))
    expect(api.POST).toHaveBeenCalledWith("/api/auth/logout")
  })

  it("stays and shows the API message when the logout request fails", async () => {
    api.POST.mockRejectedValue(new ApiError(503, "Service Unavailable", "API caída"))
    render(<Header profile={profile} onChangeProfile={vi.fn()} />)

    fireEvent.click(screen.getByRole("button", { name: /salir|cerrar sesión/i }))

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith({
        title: "Error al cerrar sesión",
        description: "API caída",
        variant: "destructive",
      }),
    )
    expect(window.location.href).toBe("/portal/x")
  })

  it("F4b: on a terminal, Salir is at least 44 px", () => {
    const terminal = { identity: null, now: 0, ensureIdentity: vi.fn(), endIdentity: vi.fn(), requestLogout: vi.fn() }
    render(<TerminalContext.Provider value={terminal}><Header profile={profile} onChangeProfile={() => {}} /></TerminalContext.Provider>)
    expect(screen.getByRole("button", { name: /Salir|Cerrar Sesión/ }).className).toMatch(/\bmin-h-11\b/)
  })

  it("keeps the Cambiar Perfil button for the real admin", () => {
    render(<Header profile={profile} onChangeProfile={vi.fn()} authRole="admin" />)
    expect(screen.getByRole("button", { name: /cambiar perfil/i })).toBeInTheDocument()
  })
})

/**
 * F4 (L14 (3), L15): every role changes its own PIN from the header of its
 * view (waiter, cashier, kitchen, delivery) after typing the current one. On a
 * shared terminal (F4b) the same header hides it.
 */
describe("Header — Cambiar mi PIN", () => {
  const cashier = { id: "p-2", name: "Laura Gómez", role: "cashier" as const }

  it("has a touch target of at least 44 px", () => {
    render(<Header profile={cashier} onChangeProfile={vi.fn()} />)
    expect(screen.getByRole("button", { name: "Cambiar mi PIN" }).className).toMatch(/\bmin-h-11\b/)
  })

  it("opens the own-PIN dialog with who is changing it and saves with the current PIN", async () => {
    api.PUT.mockResolvedValue({ data: undefined })
    render(<Header profile={cashier} onChangeProfile={vi.fn()} />)
    fireEvent.click(screen.getByRole("button", { name: "Cambiar mi PIN" }))
    const dialog = await screen.findByRole("dialog", { name: "Cambiar mi PIN" })
    expect(within(dialog).getByText(/Laura Gómez · Caja/)).toBeInTheDocument()
    fireEvent.change(within(dialog).getByLabelText("PIN actual"), { target: { value: "2580" } })
    fireEvent.change(within(dialog).getByLabelText("PIN nuevo"), { target: { value: "73914" } })
    fireEvent.change(within(dialog).getByLabelText("Repite el PIN nuevo"), { target: { value: "73914" } })
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Cambiar PIN" }))
    })
    expect(api.PUT).toHaveBeenCalledWith("/api/auth/pin", { body: { currentPin: "2580", pin: "73914" } })
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
  })

  it("shows a wrong current PIN in the dialog", async () => {
    api.PUT.mockRejectedValue(new ApiError(403, "Forbidden", "PIN incorrecto", { code: "pin_invalid" }))
    render(<Header profile={cashier} onChangeProfile={vi.fn()} />)
    fireEvent.click(screen.getByRole("button", { name: "Cambiar mi PIN" }))
    const dialog = await screen.findByRole("dialog", { name: "Cambiar mi PIN" })
    fireEvent.change(within(dialog).getByLabelText("PIN actual"), { target: { value: "1111" } })
    fireEvent.change(within(dialog).getByLabelText("PIN nuevo"), { target: { value: "73914" } })
    fireEvent.change(within(dialog).getByLabelText("Repite el PIN nuevo"), { target: { value: "73914" } })
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Cambiar PIN" }))
    })
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("PIN incorrecto")
  })

  it("F4b: shows a PIN another member has with the server text (pin_taken, never whose)", async () => {
    api.PUT.mockRejectedValue(new ApiError(409, "Conflict", "Ese PIN no está disponible, elige otro", { code: "pin_taken" }))
    render(<Header profile={cashier} onChangeProfile={vi.fn()} />)
    fireEvent.click(screen.getByRole("button", { name: "Cambiar mi PIN" }))
    const dialog = await screen.findByRole("dialog", { name: "Cambiar mi PIN" })
    fireEvent.change(within(dialog).getByLabelText("PIN actual"), { target: { value: "2580" } })
    fireEvent.change(within(dialog).getByLabelText("PIN nuevo"), { target: { value: "73914" } })
    fireEvent.change(within(dialog).getByLabelText("Repite el PIN nuevo"), { target: { value: "73914" } })
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Cambiar PIN" }))
    })
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Ese PIN no está disponible, elige otro")
  })

  it.each(["waiter", "kitchen", "delivery_operator"] as const)("is offered to the %s role", (role) => {
    render(<Header profile={{ ...cashier, role }} onChangeProfile={vi.fn()} />)
    expect(screen.getByRole("button", { name: "Cambiar mi PIN" })).toBeInTheDocument()
  })
})
