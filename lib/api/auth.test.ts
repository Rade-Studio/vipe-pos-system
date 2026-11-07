import { beforeEach, describe, expect, it, vi } from "vitest"

import { ApiError } from "./errors"

/**
 * F2 (S1 b) — shared order-taking terminal: terminal login, PIN
 * identification (acting claim sent as X-Vipe-Acting), own PIN change and
 * supervisor authorization.
 */

const api = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn(), PUT: vi.fn() }))
vi.mock("@/lib/api/client", () => ({ api }))
vi.mock("@/components/ui/use-toast", () => ({ toast: vi.fn() }))

import {
  ACTING_HEADER,
  actingHeaders,
  authorizeSupervisor,
  changeOwnPin,
  identifyStaff,
  pinFailureOf,
  terminalLogin,
} from "./auth"

const session = {
  user: { id: "u-1", email: "caja@vipe.local" },
  profile: { id: "p-1", name: "Caja", role: "cashier", restaurantId: "r-1" },
  sessionKind: "terminal",
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset().mockResolvedValue({ data: undefined })
})

describe("terminal session", () => {
  it("opens with POST /api/auth/terminal/login and returns the session", async () => {
    api.POST.mockResolvedValueOnce({ data: session })
    await expect(terminalLogin("caja@vipe.local", "secreto123")).resolves.toEqual(session)
    expect(api.POST).toHaveBeenCalledWith("/api/auth/terminal/login", {
      body: { email: "caja@vipe.local", password: "secreto123" },
    })
  })

  it("identifies a waiter by PIN and builds the acting header", async () => {
    const identity = { token: "t.k.n", expiresAt: "2026-11-07T12:05:00.000Z", profile: { id: "p-2", name: "Ana", role: "waiter" } }
    api.POST.mockResolvedValueOnce({ data: identity })
    await expect(identifyStaff("p-2", "4829")).resolves.toEqual(identity)
    expect(api.POST).toHaveBeenCalledWith("/api/auth/identify", { body: { profileId: "p-2", pin: "4829" } })
    expect(ACTING_HEADER).toBe("X-Vipe-Acting")
    expect(actingHeaders(identity.token)).toEqual({ "X-Vipe-Acting": "t.k.n" })
  })
})

describe("PINs", () => {
  it("changes the own PIN with PUT /api/auth/pin", async () => {
    await expect(changeOwnPin("4829", "73914")).resolves.toBeUndefined()
    expect(api.PUT).toHaveBeenCalledWith("/api/auth/pin", { body: { currentPin: "4829", pin: "73914" } })
  })

  it("asks a supervisor authorization for one action on one target, optionally for one supervisor", async () => {
    const answer = {
      authorizationId: "a-1",
      action: "void_item",
      targetType: "order",
      targetId: "o-1",
      supervisor: { id: "p-1", name: "Caja" },
      expiresAt: "2026-11-07T12:02:00.000Z",
    }
    api.POST.mockResolvedValueOnce({ data: answer })
    await expect(
      authorizeSupervisor({ pin: "582046", action: "void_item", targetType: "order", targetId: "o-1" }),
    ).resolves.toEqual(answer)
    expect(api.POST).toHaveBeenCalledWith("/api/auth/authorize", {
      body: { pin: "582046", action: "void_item", targetType: "order", targetId: "o-1" },
    })
  })

  it("maps the PIN answers to kinds with the server's Spanish text", () => {
    const wrong = new ApiError(403, "Forbidden", "PIN incorrecto", { code: "pin_invalid" })
    const locked = new ApiError(429, "Too Many Requests", "Demasiados intentos fallidos. Espera 5 minutos e inténtalo de nuevo", {
      code: "pin_locked",
    })
    const weak = new ApiError(422, "Unprocessable Entity", "El PIN debe tener entre 4 y 6 dígitos")
    const acting = new ApiError(403, "Forbidden", "Identifícate con tu PIN para registrar el pedido", { code: "acting_required" })
    expect(pinFailureOf(wrong)).toEqual({ kind: "wrong", message: "PIN incorrecto" })
    expect(pinFailureOf(locked)).toEqual({ kind: "locked", message: locked.message })
    expect(pinFailureOf(weak)).toEqual({ kind: "invalid", message: weak.message })
    expect(pinFailureOf(acting)).toEqual({ kind: "acting-required", message: acting.message })
    expect(pinFailureOf(new Error("boom"))).toEqual({ kind: "unknown", message: "No se pudo verificar el PIN. Inténtalo de nuevo." })
  })
})
