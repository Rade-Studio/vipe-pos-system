import { beforeEach, describe, expect, it, vi } from "vitest"

import { ApiError } from "./errors"

/**
 * T12 (S2, S4) — staff management through `/api/staff` instead of the
 * create-staff-account Edge Function and direct `profiles` writes.
 */

const api = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn(), PUT: vi.fn(), DELETE: vi.fn() }))
vi.mock("@/lib/api/client", () => ({ api }))

import {
  StaffServiceError,
  createStaffAccount,
  deleteStaff,
  listStaff,
  removeStaffPin,
  setStaffPassword,
  setStaffPin,
  updateStaff,
} from "./staff"

const member = {
  id: "p-1",
  userId: "u-1",
  fullName: "Ana",
  username: "ana",
  email: "ana@vipe.local",
  role: "waiter",
  active: true,
  createdAt: "2026-11-04T00:00:00.000Z",
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset().mockResolvedValue({ data: undefined })
})

async function kindOf(promise: Promise<unknown>) {
  const error = await promise.catch((e: unknown) => e)
  expect(error).toBeInstanceOf(StaffServiceError)
  return { kind: (error as StaffServiceError).kind, message: (error as StaffServiceError).message }
}

describe("createStaffAccount", () => {
  it("creates login and profile in ONE call with username and active, returning the unwrapped member", async () => {
    api.POST.mockResolvedValueOnce({ data: member })
    const input = {
      email: "ana@vipe.local",
      password: "secreto123",
      fullName: "Ana",
      role: "waiter" as const,
      username: "ana",
      active: false,
    }

    await expect(createStaffAccount(input)).resolves.toEqual(member)
    expect(api.POST).toHaveBeenCalledTimes(1)
    expect(api.POST).toHaveBeenCalledWith("/api/staff", { body: input })
  })

  it("maps 422 and 409 to their kinds with the server's Spanish text", async () => {
    api.POST.mockRejectedValueOnce(new ApiError(422, "Unprocessable Entity", "La contraseña debe tener al menos 8 caracteres"))
    await expect(kindOf(createStaffAccount({} as never))).resolves.toEqual({
      kind: "invalid",
      message: "La contraseña debe tener al menos 8 caracteres",
    })

    api.POST.mockRejectedValueOnce(new ApiError(409, "Conflict", "Ya existe una cuenta con ese correo electrónico"))
    await expect(kindOf(createStaffAccount({} as never))).resolves.toEqual({
      kind: "duplicate",
      message: "Ya existe una cuenta con ese correo electrónico",
    })

    api.POST.mockRejectedValueOnce(new ApiError(409, "Conflict", "Ya existe un integrante con ese nombre de usuario"))
    await expect(kindOf(createStaffAccount({} as never))).resolves.toEqual({
      kind: "duplicate",
      message: "Ya existe un integrante con ese nombre de usuario",
    })
  })

  it("maps the English 401/403/404 bodies by status to Spanish UI text", async () => {
    for (const status of [401, 403]) {
      api.POST.mockRejectedValueOnce(new ApiError(status, "Forbidden", "Insufficient role"))
      await expect(kindOf(createStaffAccount({} as never))).resolves.toEqual({
        kind: "forbidden",
        message: "No tienes permiso para gestionar el personal",
      })
    }
    api.PATCH.mockRejectedValueOnce(new ApiError(404, "Not Found", "Not found"))
    await expect(kindOf(updateStaff("p-9", { active: false }))).resolves.toEqual({
      kind: "not-found",
      message: "El integrante no existe",
    })
  })

  it("turns anything else into an unknown error with a generic Spanish text", async () => {
    api.POST.mockRejectedValueOnce(new ApiError(500, "Internal Server Error", "boom"))
    await expect(kindOf(createStaffAccount({} as never))).resolves.toEqual({
      kind: "unknown",
      message: "No se pudo completar la operación. Inténtalo de nuevo.",
    })
    api.POST.mockRejectedValueOnce(new TypeError("Failed to fetch"))
    expect((await kindOf(createStaffAccount({} as never))).kind).toBe("unknown")
  })
})

describe("the other staff routes", () => {
  it("lists the tenant's staff", async () => {
    api.GET.mockResolvedValueOnce({ data: [member] })
    await expect(listStaff()).resolves.toEqual([member])
    expect(api.GET).toHaveBeenCalledWith("/api/staff")
  })

  it("updates through PATCH with only the given fields, never the email", async () => {
    api.PATCH.mockResolvedValueOnce({ data: member })
    await updateStaff("p-1", { fullName: "Ana", username: "ana", active: true, role: "kitchen" })
    expect(api.PATCH).toHaveBeenCalledWith("/api/staff/{id}", {
      params: { path: { id: "p-1" } },
      body: { fullName: "Ana", username: "ana", active: true, role: "kitchen" },
    })
  })

  it("deletes and resets the password by id; the 422 for assigned tables keeps its text", async () => {
    await deleteStaff("p-1")
    expect(api.DELETE).toHaveBeenCalledWith("/api/staff/{id}", { params: { path: { id: "p-1" } } })

    await setStaffPassword("p-1", "nueva-clave-1")
    expect(api.POST).toHaveBeenCalledWith("/api/staff/{id}/password", {
      params: { path: { id: "p-1" } },
      body: { password: "nueva-clave-1" },
    })

    api.DELETE.mockRejectedValueOnce(new ApiError(422, "Unprocessable Entity", "El integrante tiene mesas asignadas"))
    await expect(kindOf(deleteStaff("p-1"))).resolves.toEqual({
      kind: "invalid",
      message: "El integrante tiene mesas asignadas",
    })
  })
})

describe("staff PINs (F2)", () => {
  it("sets or resets a PIN with PUT /api/staff/{id}/pin", async () => {
    await expect(setStaffPin("p-1", "4829")).resolves.toBeUndefined()
    expect(api.PUT).toHaveBeenCalledWith("/api/staff/{id}/pin", { params: { path: { id: "p-1" } }, body: { pin: "4829" } })
  })

  it("removes a PIN with DELETE /api/staff/{id}/pin", async () => {
    await expect(removeStaffPin("p-1")).resolves.toBeUndefined()
    expect(api.DELETE).toHaveBeenCalledWith("/api/staff/{id}/pin", { params: { path: { id: "p-1" } } })
  })

  it("keeps the server's Spanish text for a weak PIN", async () => {
    api.PUT.mockRejectedValueOnce(new ApiError(422, "Unprocessable Entity", "El PIN es muy fácil de adivinar"))
    await expect(kindOf(setStaffPin("p-1", "1234"))).resolves.toEqual({ kind: "invalid", message: "El PIN es muy fácil de adivinar" })
  })
})
