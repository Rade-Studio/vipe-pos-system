import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * F3 + F4 (S1 a) — the step-2 tiles come from GET /staff/supervisors for every
 * role (admin, cashier, waiter, shared terminal), never from the admin-only GET /staff.
 */

const staff = vi.hoisted(() => ({ listSupervisors: vi.fn(), listStaff: vi.fn() }))
vi.mock("@/lib/api/staff", () => staff)

import { loadSupervisors } from "./supervisors"

beforeEach(() => {
  staff.listSupervisors.mockReset()
  staff.listStaff.mockReset().mockRejectedValue(new Error("GET /staff is admin-only"))
})

describe("loadSupervisors", () => {
  it("reads GET /staff/supervisors, keeps those without a PIN and never calls GET /staff", async () => {
    staff.listSupervisors.mockResolvedValue([
      { id: "c", fullName: "Laura Gómez", role: "cashier", hasPin: true, pinLockedUntil: null },
      { id: "a", fullName: "Carlos Pérez", role: "admin", hasPin: false, pinLockedUntil: "2026-11-07T17:49:00.000Z" },
    ])
    await expect(loadSupervisors()).resolves.toEqual([
      { id: "a", fullName: "Carlos Pérez", role: "admin", hasPin: false, pinLockedUntil: "2026-11-07T17:49:00.000Z" },
      { id: "c", fullName: "Laura Gómez", role: "cashier", hasPin: true, pinLockedUntil: null },
    ])
    expect(staff.listSupervisors).toHaveBeenCalledTimes(1)
    expect(staff.listStaff).not.toHaveBeenCalled()
  })

  it("lets a failed read reach the sheet ('No se pudo cargar quién autoriza')", async () => {
    staff.listSupervisors.mockRejectedValue(new Error("network"))
    await expect(loadSupervisors()).rejects.toThrow("network")
  })
})
