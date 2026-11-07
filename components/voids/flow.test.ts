import { describe, expect, it } from "vitest"
import {
  SUPERVISOR_ACTION,
  authorizationTarget,
  canContinue,
  lockedUntilLabel,
  reasonTextError,
  supervisorTiles,
  type VoidTarget,
} from "./flow"

const item: VoidTarget = {
  action: "item",
  orderId: "o-1",
  label: "#128 · Mesa 8",
  lines: [{ id: "l-1", name: "Bandeja paisa", price: 32900, quantity: 2 }],
}

describe("void flow rules", () => {
  it("maps every action to the authorize action and its exact target", () => {
    expect(SUPERVISOR_ACTION).toEqual({ item: "void_item", order: "cancel_order", payment: "void_payment" })
    expect(authorizationTarget(item)).toEqual({ targetType: "order", targetId: "o-1" })
    expect(authorizationTarget({ action: "order", orderId: "o-2", label: "#2", lines: [], total: 0 })).toEqual({
      targetType: "order",
      targetId: "o-2",
    })
    expect(
      authorizationTarget(
        { action: "payment", orderId: "o-3", label: "#3", payments: [{ id: "p-9", title: "Tarjeta", amount: 1 }] },
        "p-9",
      ),
    ).toEqual({ targetType: "payment", targetId: "p-9" })
  })

  it("'Otro' needs 3 to 200 characters of text; the fixed reasons need none", () => {
    expect(reasonTextError("dish_returned", "")).toBeNull()
    expect(reasonTextError("other", "")).toBe("Escribe el motivo para continuar.")
    expect(reasonTextError("other", "  ab ")).toBe("Escribe al menos 3 letras.")
    expect(reasonTextError("other", "x".repeat(201))).toBe("Máximo 200 caracteres.")
    expect(reasonTextError("other", "Salió frío")).toBeNull()
  })

  it("continues only with a reason, a valid text for 'Otro' and something to void", () => {
    expect(canContinue({ reason: null, reasonText: "", quantity: 1, hasSubject: true })).toBe(false)
    expect(canContinue({ reason: "other", reasonText: "", quantity: 1, hasSubject: true })).toBe(false)
    expect(canContinue({ reason: "other", reasonText: "Frío", quantity: 1, hasSubject: true })).toBe(true)
    expect(canContinue({ reason: "waiter_error", reasonText: "", quantity: 0, hasSubject: true })).toBe(false)
    expect(canContinue({ reason: "waiter_error", reasonText: "", quantity: 1, hasSubject: false })).toBe(false)
  })

  it("shows hh:mm only for a lock still running", () => {
    const now = new Date(2026, 10, 7, 12, 44)
    expect(lockedUntilLabel(new Date(2026, 10, 7, 12, 49).toISOString(), now)).toBe("12:49")
    expect(lockedUntilLabel(new Date(2026, 10, 7, 12, 40).toISOString(), now)).toBeNull()
    expect(lockedUntilLabel(null, now)).toBeNull()
  })

  it("lists admins and cashiers; one without a PIN is listed but cannot authorize; the actor's own tile is refused unless self-authorization is on", () => {
    const staff = [
      { id: "a", fullName: "Carlos Pérez", role: "admin" as const, hasPin: true, pinLockedUntil: null },
      { id: "c", fullName: "Laura Gómez", role: "cashier" as const, hasPin: true, pinLockedUntil: null },
      { id: "n", fullName: "Sin Pin", role: "cashier" as const, hasPin: false, pinLockedUntil: null },
    ]
    expect(supervisorTiles(staff, "c", false).map((t) => [t.id, t.self, t.refused])).toEqual([
      ["a", false, false],
      ["c", true, true],
      ["n", false, false],
    ])
    expect(supervisorTiles(staff, "c", true).map((t) => [t.id, t.refused, t.hasPin])).toEqual([
      ["a", false, true],
      ["c", false, true],
      ["n", false, false],
    ])
  })
})
