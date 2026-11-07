import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError } from "@/lib/api/errors"

/**
 * T7 (S2): the login form posts the credentials to the API (`POST
 * /api/auth/login`), which sets the session cookies. No Supabase client.
 */

const api = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn() }))
vi.mock("@/lib/api/client", () => ({ api }))

const toast = vi.hoisted(() => vi.fn())
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }))
vi.mock("@/components/theme/theme-toggle", () => ({ ThemeToggle: () => null }))

import { LoginView } from "./LoginView"

const session = {
  user: { id: "u-1", email: "admin@vipe.local" },
  profile: { id: "p-1", name: "Admin Dev", role: "admin", restaurantId: "r-1" },
}

function submit(email: string, password: string) {
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: email } })
  fireEvent.change(screen.getByLabelText("Contraseña"), { target: { value: password } })
  fireEvent.click(screen.getByRole("button", { name: "Iniciar sesión" }))
}

beforeEach(() => {
  api.GET.mockReset()
  api.POST.mockReset()
  toast.mockReset()
})

describe("LoginView — card overlay", () => {
  // The decorative card border is positioned over the whole card; it must not
  // take clicks, or it covers the unpositioned "Abrir esta tablet como terminal" toggle.
  it("lets clicks through the decorative card border to the terminal toggle", () => {
    const { container } = render(<LoginView onLoginSuccess={vi.fn()} />)
    const overlays = Array.from(container.querySelectorAll<HTMLElement>("div.absolute.inset-0.border"))
    expect(overlays.length).toBeGreaterThan(0)
    for (const overlay of overlays) expect(overlay.className).toMatch(/\bpointer-events-none\b/)
    fireEvent.click(screen.getByRole("button", { name: "Abrir esta tablet como terminal" }))
    expect(screen.getByRole("button", { name: "Volver a iniciar sesión" })).toBeInTheDocument()
  })
})

describe("LoginView", () => {
  it("posts the credentials to /api/auth/login and hands the session to the shell", async () => {
    api.POST.mockResolvedValue({ data: session })
    const onLoginSuccess = vi.fn()
    render(<LoginView onLoginSuccess={onLoginSuccess} />)

    submit("admin@vipe.local", "vipe-dev-2026")

    await waitFor(() => expect(onLoginSuccess).toHaveBeenCalledWith(session))
    expect(api.POST).toHaveBeenCalledTimes(1)
    expect(api.POST).toHaveBeenCalledWith("/api/auth/login", {
      body: { email: "admin@vipe.local", password: "vipe-dev-2026" },
    })
  })

  it("shows the API message on 401 and stays on the login", async () => {
    api.POST.mockRejectedValue(new ApiError(401, "Unauthorized", "Invalid credentials"))
    const onLoginSuccess = vi.fn()
    render(<LoginView onLoginSuccess={onLoginSuccess} />)

    submit("admin@vipe.local", "wrong")

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith({
        title: "Error al iniciar sesión",
        description: "Invalid credentials",
        variant: "destructive",
      }),
    )
    expect(onLoginSuccess).not.toHaveBeenCalled()
    expect(screen.getByRole("button", { name: "Iniciar sesión" })).toBeEnabled()
  })

  it("still asks for both fields before calling the API", () => {
    render(<LoginView onLoginSuccess={vi.fn()} />)

    fireEvent.click(screen.getByRole("button", { name: "Iniciar sesión" }))

    expect(api.POST).not.toHaveBeenCalled()
    expect(toast).toHaveBeenCalledWith({
      title: "Campos requeridos",
      description: "Por favor ingresa tu email y contraseña",
      variant: "destructive",
    })
  })

  it("opens this tablet as a shared terminal with POST /api/auth/terminal/login (F4)", async () => {
    const terminal = { ...session, profile: { ...session.profile, role: "cashier" }, sessionKind: "terminal" }
    api.POST.mockResolvedValue({ data: terminal })
    const onLoginSuccess = vi.fn()
    render(<LoginView onLoginSuccess={onLoginSuccess} />)

    fireEvent.click(screen.getByRole("button", { name: "Abrir esta tablet como terminal" }))
    expect(screen.getByText("Solo el admin o la caja pueden abrirla. Después, cada mesero se identifica con su PIN.")).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "laura@a.test" } })
    fireEvent.change(screen.getByLabelText("Contraseña"), { target: { value: "secreto123" } })
    fireEvent.click(screen.getByRole("button", { name: "Abrir terminal" }))

    await waitFor(() => expect(onLoginSuccess).toHaveBeenCalledWith(terminal))
    expect(api.POST).toHaveBeenCalledWith("/api/auth/terminal/login", { body: { email: "laura@a.test", password: "secreto123" } })
  })

  it("shows why a waiter cannot open a terminal, and goes back to the normal login", async () => {
    api.POST.mockRejectedValue(
      new ApiError(403, "Forbidden", "Solo un administrador o cajero puede abrir una terminal compartida"),
    )
    const onLoginSuccess = vi.fn()
    render(<LoginView onLoginSuccess={onLoginSuccess} />)
    fireEvent.click(screen.getByRole("button", { name: "Abrir esta tablet como terminal" }))
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "ana@a.test" } })
    fireEvent.change(screen.getByLabelText("Contraseña"), { target: { value: "secreto123" } })
    fireEvent.click(screen.getByRole("button", { name: "Abrir terminal" }))

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ description: "Solo un administrador o cajero puede abrir una terminal compartida" }),
      ),
    )
    expect(onLoginSuccess).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Volver a iniciar sesión" }))
    expect(screen.getByRole("button", { name: "Iniciar sesión" })).toBeInTheDocument()
  })
})
