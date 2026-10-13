import { describe, expect, it } from "vitest"
import {
  MINIMAL_SHELL_LOADS,
  SHELL_LOADS,
  startupLoadsForRole,
  startupRole,
} from "./startup-loads"

/**
 * T5 (S1): the shell must fan out only the slices the signed-in role's view
 * actually reads. These expectations are pinned to the grep evidence cited in
 * `startup-loads.ts`; changing a slice's owner means changing that file's
 * comment AND this test.
 */
describe("startupLoadsForRole", () => {
  it("waiter: only the config (tables come from WaiterView's own query)", () => {
    expect(startupLoadsForRole("waiter")).toEqual(["config"])
  })

  it("kitchen: tables + waiter directory, no config and no orders", () => {
    expect(startupLoadsForRole("kitchen")).toEqual(["tables", "waiters"])
  })

  it("cashier: config + tables + waiter directory, no orders and no registers", () => {
    expect(startupLoadsForRole("cashier")).toEqual(["config", "tables", "waiters"])
  })

  it("delivery_operator: only the config", () => {
    expect(startupLoadsForRole("delivery_operator")).toEqual(["config"])
  })

  it("admin: every shell slice (it reads orders, registers and the whole picker)", () => {
    expect(startupLoadsForRole("admin")).toEqual([
      "config",
      "tables",
      "waiters",
      "kitchenOrders",
      "allRegisters",
    ])
  })

  it("unknown role gets the minimal set (no fan-out at all)", () => {
    expect(startupLoadsForRole("supervisor")).toEqual([])
    expect(startupLoadsForRole("")).toEqual([])
    expect(startupLoadsForRole(null)).toEqual([])
    expect(startupLoadsForRole(undefined)).toEqual([])
    expect(MINIMAL_SHELL_LOADS).toEqual([])
  })

  it("never returns a load outside the canonical list, and never repeats one", () => {
    for (const role of ["waiter", "kitchen", "cashier", "admin", "delivery_operator", "nope"]) {
      const loads = startupLoadsForRole(role)
      expect(new Set(loads).size).toBe(loads.length)
      expect(loads.every((l) => (SHELL_LOADS as readonly string[]).includes(l))).toBe(true)
    }
  })
})

/**
 * An admin impersonating through "Cambiar Perfil" keeps the admin's loads:
 * the startup key is the REAL role (`authProfile`), so switching the visible
 * role neither re-runs nor drops the loads.
 */
describe("startupRole", () => {
  it("prefers the authenticated role over the impersonated one", () => {
    expect(startupRole({ authRole: "admin", selectedRole: "waiter" })).toBe("admin")
    expect(startupRole({ authRole: "admin", selectedRole: "kitchen" })).toBe("admin")
  })

  it("falls back to the selected role before the auth profile is known", () => {
    expect(startupRole({ authRole: null, selectedRole: "cashier" })).toBe("cashier")
  })

  it("is null when neither role is known yet", () => {
    expect(startupRole({ authRole: null, selectedRole: null })).toBeNull()
    expect(startupRole({ authRole: undefined, selectedRole: undefined })).toBeNull()
  })

  it("keeps the impersonated view on the admin's loads (end-to-end through the helper)", () => {
    const startupLoads = startupLoadsForRole(startupRole({ authRole: "admin", selectedRole: "waiter" }))
    expect(startupLoads).toEqual(startupLoadsForRole("admin"))
  })
})