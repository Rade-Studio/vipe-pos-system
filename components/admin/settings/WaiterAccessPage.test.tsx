import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * F4 (S1 b) — Ajustes → Acceso de meseros: the access mode with a confirmation
 * that names who has no PIN, the PIN of every member (assign, reset, remove,
 * early unlock) with the server's Spanish refusals, and "Cambiar mi PIN".
 */

const staffApi = vi.hoisted(() => ({
  listStaff: vi.fn(),
  setStaffPin: vi.fn(),
  removeStaffPin: vi.fn(),
  unlockStaffPin: vi.fn(),
}))
vi.mock("@/lib/api/staff", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/staff")>()),
  ...staffApi,
}))
const configApi = vi.hoisted(() => ({ fetchConfig: vi.fn(), saveConfig: vi.fn() }))
vi.mock("@/lib/api/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/config")>()),
  ...configApi,
}))
const authApi = vi.hoisted(() => ({ changeOwnPin: vi.fn() }))
vi.mock("@/lib/api/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/auth")>()),
  ...authApi,
}))
const toastMock = vi.hoisted(() => vi.fn())
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: toastMock }) }))

import { ApiError } from "@/lib/api/errors"
import { StaffServiceError } from "@/lib/api/staff"
import { clockTime } from "@/lib/terminal/format"
import { useProfileStore } from "@/store/useProfileStore"
import { WaiterAccessPage } from "./WaiterAccessPage"

// A lock still running when the suite runs (a fixed instant expired on 2026-11-07 17:49 UTC).
const LOCK = new Date(Date.now() + 60 * 60_000).toISOString()
const member = (id: string, fullName: string, role: string, extra: Record<string, unknown> = {}) => ({
  id,
  userId: `u-${id}`,
  fullName,
  username: null,
  email: `${id}@a.test`,
  role,
  active: true,
  createdAt: "2026-11-01T00:00:00.000Z",
  hasPin: false,
  pinLockedUntil: null,
  ...extra,
})
const staff = [
  member("p-admin", "Carlos Pérez", "admin", { hasPin: true }),
  member("p-cash", "Laura Gómez", "cashier", { hasPin: true }),
  member("p-andres", "Andrés", "waiter", { hasPin: true }),
  member("p-julian", "Julián", "waiter"),
  member("p-vale", "Valentina", "waiter", { hasPin: true, pinLockedUntil: LOCK }),
  member("p-oscar", "Óscar", "kitchen"),
  member("p-old", "Retirado", "waiter", { active: false }),
]
const config = (waiterAccessMode: "own_accounts" | "shared_terminal") => ({ waiterAccessMode }) as never

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <WaiterAccessPage />
    </QueryClientProvider>,
  )
}

const row = (name: string) => screen.getByRole("row", { name: new RegExp(name) })

beforeEach(() => {
  staffApi.listStaff.mockReset().mockResolvedValue(staff)
  staffApi.setStaffPin.mockReset().mockResolvedValue(undefined)
  staffApi.removeStaffPin.mockReset().mockResolvedValue(undefined)
  staffApi.unlockStaffPin.mockReset().mockResolvedValue(undefined)
  configApi.fetchConfig.mockReset().mockResolvedValue(config("own_accounts"))
  configApi.saveConfig.mockReset().mockImplementation(async (changes: { waiterAccessMode: string }) => changes)
  authApi.changeOwnPin.mockReset().mockResolvedValue(undefined)
  toastMock.mockClear()
  useProfileStore.setState({
    authProfile: { id: "p-admin", name: "Carlos Pérez", full_name: "Carlos Pérez", role: "admin" },
  })
})

describe("WaiterAccessPage — mode", () => {
  it("shows both modes with the saved one checked", async () => {
    renderPage()
    const own = await screen.findByRole("radio", { name: /Cuenta propia/ })
    await waitFor(() => expect(own).toHaveAttribute("aria-checked", "true"))
    expect(screen.getByRole("radio", { name: /Terminal compartida/ })).toHaveAttribute("aria-checked", "false")
  })

  it("asks before switching to the shared terminal and names the active waiters without PIN", async () => {
    renderPage()
    await screen.findByRole("row", { name: /Julián/ })
    fireEvent.click(screen.getByRole("radio", { name: /Terminal compartida/ }))
    const dialog = await screen.findByRole("alertdialog")
    expect(within(dialog).getByText(/Julián no tiene PIN/)).toBeInTheDocument()
    // Inactive members and kitchen staff are not listed.
    expect(within(dialog).queryByText(/Retirado|Óscar/)).toBeNull()
    expect(configApi.saveConfig).not.toHaveBeenCalled()

    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Usar terminal compartida" }))
    })
    expect(configApi.saveConfig).toHaveBeenCalledWith({ waiterAccessMode: "shared_terminal" })
    await waitFor(() =>
      expect(screen.getByRole("radio", { name: /Terminal compartida/ })).toHaveAttribute("aria-checked", "true"),
    )
  })

  it("keeps the mode when the switch is cancelled", async () => {
    renderPage()
    await screen.findByRole("row", { name: /Julián/ })
    fireEvent.click(screen.getByRole("radio", { name: /Terminal compartida/ }))
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Cancelar" }))
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    expect(configApi.saveConfig).not.toHaveBeenCalled()
    expect(screen.getByRole("radio", { name: /Cuenta propia/ })).toHaveAttribute("aria-checked", "true")
  })

  it("says every waiter has a PIN when nobody is missing one, and switches back to own accounts", async () => {
    staffApi.listStaff.mockResolvedValue(staff.filter((m) => m.id !== "p-julian"))
    configApi.fetchConfig.mockResolvedValue(config("shared_terminal"))
    renderPage()
    await screen.findByRole("row", { name: /Andrés/ })
    await waitFor(() =>
      expect(screen.getByRole("radio", { name: /Terminal compartida/ })).toHaveAttribute("aria-checked", "true"),
    )
    fireEvent.click(screen.getByRole("radio", { name: /Terminal compartida/ }))
    expect(screen.queryByRole("alertdialog")).toBeNull()
    fireEvent.click(screen.getByRole("radio", { name: /Cuenta propia/ }))
    const dialog = await screen.findByRole("alertdialog")
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Usar cuenta propia" }))
    })
    expect(configApi.saveConfig).toHaveBeenCalledWith({ waiterAccessMode: "own_accounts" })
  })
})

describe("WaiterAccessPage — PIN del personal", () => {
  it("lists every active member with the state of their PIN", async () => {
    renderPage()
    expect(within(await screen.findByRole("row", { name: /Andrés/ })).getByText("Tiene PIN")).toBeInTheDocument()
    expect(within(row("Julián")).getByText("Sin PIN")).toBeInTheDocument()
    expect(within(row("Valentina")).getByText(`Bloqueado hasta ${clockTime(LOCK)}`)).toBeInTheDocument()
    expect(within(row("Óscar")).getByText("Sin PIN · no lo necesita")).toBeInTheDocument()
    expect(screen.queryByRole("row", { name: /Retirado/ })).toBeNull()
    // Own row: change it with the current PIN, never reset it here.
    expect(within(row("Carlos Pérez")).getByRole("button", { name: "Cambiar mi PIN" })).toBeInTheDocument()
    expect(within(row("Carlos Pérez")).queryByRole("button", { name: /Restablecer/ })).toBeNull()
  })

  it("assigns a PIN after typing it twice", async () => {
    renderPage()
    fireEvent.click(within(await screen.findByRole("row", { name: /Julián/ })).getByRole("button", { name: "Asignar PIN" }))
    const dialog = await screen.findByRole("dialog", { name: "Asignar PIN a Julián" })
    fireEvent.change(within(dialog).getByLabelText("PIN nuevo"), { target: { value: "4829" } })
    fireEvent.change(within(dialog).getByLabelText("Repite el PIN"), { target: { value: "4829" } })
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Guardar PIN" }))
    })
    expect(staffApi.setStaffPin).toHaveBeenCalledWith("p-julian", "4829")
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(staffApi.listStaff).toHaveBeenCalledTimes(2)
  })

  it("refuses two different PINs or a malformed one without calling the API", async () => {
    renderPage()
    fireEvent.click(within(await screen.findByRole("row", { name: /Andrés/ })).getByRole("button", { name: "Restablecer" }))
    const dialog = await screen.findByRole("dialog", { name: "Restablecer el PIN de Andrés" })
    fireEvent.change(within(dialog).getByLabelText("PIN nuevo"), { target: { value: "4829" } })
    fireEvent.change(within(dialog).getByLabelText("Repite el PIN"), { target: { value: "4828" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Guardar PIN" }))
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Los dos PIN no coinciden")
    fireEvent.change(within(dialog).getByLabelText("PIN nuevo"), { target: { value: "48" } })
    fireEvent.change(within(dialog).getByLabelText("Repite el PIN"), { target: { value: "48" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Guardar PIN" }))
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("El PIN debe tener entre 4 y 6 dígitos")
    expect(staffApi.setStaffPin).not.toHaveBeenCalled()
  })

  it("shows the server's weak-PIN refusal and keeps the dialog open", async () => {
    const weak = "El PIN es muy fácil de adivinar: no uses el mismo dígito, números consecutivos ni patrones repetidos"
    staffApi.setStaffPin.mockRejectedValueOnce(new StaffServiceError("invalid", weak))
    renderPage()
    fireEvent.click(within(await screen.findByRole("row", { name: /Julián/ })).getByRole("button", { name: "Asignar PIN" }))
    const dialog = await screen.findByRole("dialog", { name: "Asignar PIN a Julián" })
    fireEvent.change(within(dialog).getByLabelText("PIN nuevo"), { target: { value: "1234" } })
    fireEvent.change(within(dialog).getByLabelText("Repite el PIN"), { target: { value: "1234" } })
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Guardar PIN" }))
    })
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(weak)
    expect(screen.getByRole("dialog", { name: "Asignar PIN a Julián" })).toBeInTheDocument()
  })

  it("removes a PIN after confirming", async () => {
    renderPage()
    fireEvent.click(within(await screen.findByRole("row", { name: /Andrés/ })).getByRole("button", { name: "Quitar" }))
    const dialog = await screen.findByRole("alertdialog")
    expect(within(dialog).getByText("¿Quitar el PIN de Andrés?")).toBeInTheDocument()
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Quitar PIN" }))
    })
    expect(staffApi.removeStaffPin).toHaveBeenCalledWith("p-andres")
  })

  it("unlocks a locked PIN early, only for a locked member", async () => {
    renderPage()
    expect(within(await screen.findByRole("row", { name: /Andrés/ })).queryByRole("button", { name: "Desbloquear" })).toBeNull()
    await act(async () => {
      fireEvent.click(within(row("Valentina")).getByRole("button", { name: "Desbloquear" }))
    })
    expect(staffApi.unlockStaffPin).toHaveBeenCalledWith("p-vale")
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ title: "PIN desbloqueado" }))
  })
})

describe("WaiterAccessPage — Cambiar mi PIN", () => {
  const openOwn = async () => {
    renderPage()
    await screen.findByRole("row", { name: /Andrés/ })
    fireEvent.click(screen.getAllByRole("button", { name: "Cambiar mi PIN" })[0])
    return screen.findByRole("dialog", { name: "Cambiar mi PIN" })
  }
  const fill = (dialog: HTMLElement, current: string, next: string, again = next) => {
    fireEvent.change(within(dialog).getByLabelText("PIN actual"), { target: { value: current } })
    fireEvent.change(within(dialog).getByLabelText("PIN nuevo"), { target: { value: next } })
    fireEvent.change(within(dialog).getByLabelText("Repite el PIN nuevo"), { target: { value: again } })
  }

  it("changes the own PIN with the current one", async () => {
    const dialog = await openOwn()
    fill(dialog, "2580", "73914")
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Cambiar PIN" }))
    })
    expect(authApi.changeOwnPin).toHaveBeenCalledWith("2580", "73914")
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ title: "PIN cambiado" }))
  })

  it("shows a wrong current PIN and keeps the dialog", async () => {
    authApi.changeOwnPin.mockRejectedValueOnce(new ApiError(403, "Forbidden", "PIN incorrecto", { code: "pin_invalid" }))
    const dialog = await openOwn()
    fill(dialog, "1111", "73914")
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Cambiar PIN" }))
    })
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("PIN incorrecto")
  })

  it("refuses two different new PINs without calling the API", async () => {
    const dialog = await openOwn()
    fill(dialog, "2580", "73914", "73915")
    fireEvent.click(within(dialog).getByRole("button", { name: "Cambiar PIN" }))
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Los dos PIN no coinciden")
    expect(authApi.changeOwnPin).not.toHaveBeenCalled()
  })
})
