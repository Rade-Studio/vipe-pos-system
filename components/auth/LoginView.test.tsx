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
})
