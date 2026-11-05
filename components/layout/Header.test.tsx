import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError } from "@/lib/api/errors"

/** T7 (S2): signing out revokes the API session, then reloads the portal. */

const api = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn() }))
vi.mock("@/lib/api/client", () => ({ api }))
vi.mock("@/components/theme/theme-toggle", () => ({ ThemeToggle: () => null }))
const toast = vi.hoisted(() => vi.fn())
vi.mock("@/components/ui/use-toast", () => ({ toast, useToast: () => ({ toast }) }))

import { Header } from "./Header"

const original = window.location

beforeEach(() => {
  api.POST.mockReset()
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

  it("keeps the Cambiar Perfil button for the real admin", () => {
    render(<Header profile={profile} onChangeProfile={vi.fn()} authRole="admin" />)
    expect(screen.getByRole("button", { name: /cambiar perfil/i })).toBeInTheDocument()
  })
})
