import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

/** T12 (S2, S4) — the staff form writes through `/api/staff` only. */

const staff = vi.hoisted(() => ({
  createStaffAccount: vi.fn(),
  updateStaff: vi.fn(),
  setStaffPassword: vi.fn(),
}))
vi.mock("@/lib/api/staff", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/staff")>()),
  ...staff,
}))
const toastMock = vi.hoisted(() => vi.fn())
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: toastMock }) }))

import { StaffServiceError, type StaffMember } from "@/lib/api/staff"
import { WaiterForm } from "./WaiterForm"

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver

const member: StaffMember = {
  id: "p-1",
  userId: "u-1",
  fullName: "Ana",
  username: "ana",
  email: "ana@vipe.local",
  role: "waiter",
  active: true,
  createdAt: "2026-11-04T00:00:00.000Z",
  hasPin: false,
  pinLockedUntil: null,
}

beforeEach(() => {
  for (const fn of Object.values(staff)) fn.mockReset().mockResolvedValue(member)
  toastMock.mockClear()
})

const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } })

describe("WaiterForm", () => {
  it("creates in ONE call with username and active", async () => {
    const onSuccess = vi.fn()
    render(<WaiterForm onSuccess={onSuccess} onCancel={vi.fn()} />)
    type("Nombre completo", "Ana")
    type("Nombre de usuario", "ana")
    type("Email", "ana@vipe.local")
    type("Contraseña", "secreto123")
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Crear" }))
    })

    await waitFor(() => expect(onSuccess).toHaveBeenCalled())
    expect(staff.createStaffAccount).toHaveBeenCalledTimes(1)
    expect(staff.createStaffAccount).toHaveBeenCalledWith({
      email: "ana@vipe.local",
      password: "secreto123",
      fullName: "Ana",
      role: "waiter",
      username: "ana",
      active: true,
    })
    expect(staff.updateStaff).not.toHaveBeenCalled()
  })

  it("shows the server's Spanish text when the create is refused", async () => {
    staff.createStaffAccount.mockRejectedValueOnce(
      new StaffServiceError("duplicate", "Ya existe una cuenta con ese correo electrónico"),
    )
    const onSuccess = vi.fn()
    render(<WaiterForm onSuccess={onSuccess} onCancel={vi.fn()} />)
    type("Nombre completo", "Ana")
    type("Nombre de usuario", "ana")
    type("Email", "ana@vipe.local")
    type("Contraseña", "secreto123")
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Crear" }))
    })

    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ description: "Ya existe una cuenta con ese correo electrónico", variant: "destructive" }),
    )
    expect(onSuccess).not.toHaveBeenCalled()
  })

  it("edits through PATCH without the email while it is unchanged", async () => {
    const onSuccess = vi.fn()
    render(<WaiterForm waiter={member} onSuccess={onSuccess} onCancel={vi.fn()} />)
    type("Nombre completo", "Ana María")
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Actualizar" }))
    })

    await waitFor(() => expect(onSuccess).toHaveBeenCalled())
    expect(staff.updateStaff).toHaveBeenCalledWith("p-1", {
      fullName: "Ana María",
      username: "ana",
      active: true,
      role: "waiter",
    })
    expect(staff.createStaffAccount).not.toHaveBeenCalled()
  })

  it("resets the password of an existing member", async () => {
    render(<WaiterForm waiter={member} onSuccess={vi.fn()} onCancel={vi.fn()} />)
    type("Nueva contraseña", "corta")
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Restablecer contraseña" }))
    })
    expect(screen.getByText("La contraseña debe tener al menos 8 caracteres")).toBeInTheDocument()
    expect(staff.setStaffPassword).not.toHaveBeenCalled()

    type("Nueva contraseña", "nueva-clave-1")
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Restablecer contraseña" }))
    })
    expect(staff.setStaffPassword).toHaveBeenCalledWith("p-1", "nueva-clave-1")
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ title: "Contraseña actualizada" }))
    expect(staff.updateStaff).not.toHaveBeenCalled()
  })

  it("changes the login email of a member (H-029)", async () => {
    const onSuccess = vi.fn()
    render(<WaiterForm waiter={member} onSuccess={onSuccess} onCancel={vi.fn()} />)
    expect(screen.getByLabelText("Email")).not.toHaveAttribute("readonly")
    type("Email", "ana.maria@vipe.local")
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Actualizar" }))
    })
    await waitFor(() => expect(onSuccess).toHaveBeenCalled())
    expect(staff.updateStaff).toHaveBeenCalledWith("p-1", {
      email: "ana.maria@vipe.local",
      fullName: "Ana",
      username: "ana",
      active: true,
      role: "waiter",
    })
  })

  it("refuses an invalid new email before calling the API", async () => {
    render(<WaiterForm waiter={member} onSuccess={vi.fn()} onCancel={vi.fn()} />)
    type("Email", "no-es@correo")
    // The browser's own type=email check would block the click; submit the form to reach the form's rule.
    await act(async () => {
      fireEvent.submit(screen.getByRole("button", { name: "Actualizar" }).closest("form")!)
    })
    expect(screen.getByText("Ingresa un correo electrónico válido")).toBeInTheDocument()
    expect(staff.updateStaff).not.toHaveBeenCalled()
  })

  it("keeps the email read-only for a legacy member without login", () => {
    render(<WaiterForm waiter={{ ...member, userId: null }} onSuccess={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByLabelText("Email")).toHaveAttribute("readonly")
  })

  it("asks for letters plus a number, symbol or space and refuses common passwords (H-029)", async () => {
    render(<WaiterForm onSuccess={vi.fn()} onCancel={vi.fn()} />)
    type("Nombre completo", "Ana")
    type("Nombre de usuario", "ana")
    type("Email", "ana@vipe.local")
    const create = async () => {
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Crear" }))
      })
    }
    type("Contraseña", "sololetras")
    await create()
    expect(screen.getByText("La contraseña debe combinar letras con números, símbolos o espacios")).toBeInTheDocument()
    type("Contraseña", "Password123")
    await create()
    expect(screen.getByText("La contraseña es demasiado común; elige otra")).toBeInTheDocument()
    expect(staff.createStaffAccount).not.toHaveBeenCalled()

    render(<WaiterForm waiter={member} onSuccess={vi.fn()} onCancel={vi.fn()} />)
    type("Nueva contraseña", "12345678")
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Restablecer contraseña" }))
    })
    expect(screen.getAllByText("La contraseña debe combinar letras con números, símbolos o espacios").length).toBeGreaterThan(0)
    expect(staff.setStaffPassword).not.toHaveBeenCalled()
  })

  it("hides the password reset for a legacy member without login (item 5)", () => {
    render(<WaiterForm waiter={{ ...member, userId: null }} onSuccess={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.queryByLabelText("Nueva contraseña")).toBeNull()
    expect(screen.queryByRole("button", { name: "Restablecer contraseña" })).toBeNull()
  })
})
