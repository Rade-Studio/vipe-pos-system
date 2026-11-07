import { api } from "./client"
import { ApiError } from "./errors"
import type { components } from "./schema"

/**
 * Staff accounts through the API (T12), replacing the create-staff-account
 * Edge Function and the direct `profiles` writes. The API gates every route to
 * an active admin of the same restaurant; the browser never holds a privileged
 * key. 422/409 bodies carry the Spanish text the form shows; 401/403/404 are
 * English and mapped here by status.
 */

type Schemas = components["schemas"]
export type StaffMember = Schemas["StaffMember"]
export type CreateStaffAccountInput = Schemas["CreateStaffRequest"]
export type UpdateStaffInput = Schemas["UpdateStaffRequest"]
export type StaffRole = CreateStaffAccountInput["role"]

export type StaffServiceErrorKind = "invalid" | "forbidden" | "duplicate" | "not-found" | "unknown"

export class StaffServiceError extends Error {
  readonly kind: StaffServiceErrorKind
  constructor(kind: StaffServiceErrorKind, message: string) {
    super(message)
    this.name = "StaffServiceError"
    this.kind = kind
  }
}

const MESSAGES = {
  forbidden: "No tienes permiso para gestionar el personal",
  "not-found": "El integrante no existe",
  unknown: "No se pudo completar la operación. Inténtalo de nuevo.",
} as const

function toStaffError(error: unknown): StaffServiceError {
  if (error instanceof ApiError) {
    if (error.status === 422) return new StaffServiceError("invalid", error.message)
    if (error.status === 409) return new StaffServiceError("duplicate", error.message)
    if (error.status === 401 || error.status === 403) return new StaffServiceError("forbidden", MESSAGES.forbidden)
    if (error.status === 404) return new StaffServiceError("not-found", MESSAGES["not-found"])
  }
  return new StaffServiceError("unknown", MESSAGES.unknown)
}

async function staffCall<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call()
  } catch (error) {
    throw toStaffError(error)
  }
}

function required<T>(data: T | undefined): T {
  if (data === undefined) throw new StaffServiceError("unknown", MESSAGES.unknown)
  return data
}

const byId = (id: string) => ({ params: { path: { id } } })

/** Every profile of the caller's restaurant (admins included), by name. */
export function listStaff(): Promise<StaffMember[]> {
  return staffCall(async () => required((await api.GET("/api/staff")).data))
}

/** Login and profile in one transaction, `username` and `active` included. */
export function createStaffAccount(input: CreateStaffAccountInput): Promise<StaffMember> {
  return staffCall(async () => required((await api.POST("/api/staff", { body: input })).data))
}

/** Only `fullName, username, active, role`; the email cannot change. */
export function updateStaff(id: string, input: UpdateStaffInput): Promise<StaffMember> {
  return staffCall(async () => required((await api.PATCH("/api/staff/{id}", { ...byId(id), body: input })).data))
}

/** Deletes the login; the profile cascades. 422 when the member still has tables. */
export function deleteStaff(id: string): Promise<void> {
  return staffCall(async () => {
    await api.DELETE("/api/staff/{id}", byId(id))
  })
}

/** Replaces the member's password; the API revokes the member's open sessions. */
export function setStaffPassword(id: string, password: string): Promise<void> {
  return staffCall(async () => {
    await api.POST("/api/staff/{id}/password", { ...byId(id), body: { password } })
  })
}

/** Sets or resets the member's PIN (4-6 digits, not weak); clears its lockout. */
export function setStaffPin(id: string, pin: string): Promise<void> {
  return staffCall(async () => {
    await api.PUT("/api/staff/{id}/pin", { ...byId(id), body: { pin } })
  })
}

/** Removes the member's PIN (no-op when none). */
export function removeStaffPin(id: string): Promise<void> {
  return staffCall(async () => {
    await api.DELETE("/api/staff/{id}/pin", byId(id))
  })
}

/** Ends the member's PIN lockout early and clears its failed attempts; the PIN stays. */
export function unlockStaffPin(id: string): Promise<void> {
  return staffCall(async () => {
    await api.DELETE("/api/staff/{id}/pin/lock", byId(id))
  })
}
