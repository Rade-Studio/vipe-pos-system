import { beforeEach, describe, expect, it, vi } from "vitest"

import { ApiError } from "./errors"

/** F1 (S1 a) — the admin audit log of cancellations and voids, the fixed reasons and the refusal codes. */

const api = vi.hoisted(() => ({ GET: vi.fn() }))
vi.mock("@/lib/api/client", () => ({ api }))

import { VOID_REASONS, getAuditEvents, voidRefusalOf } from "./audit"

beforeEach(() => {
  api.GET.mockReset()
})

describe("void reasons", () => {
  it("is the fixed Spanish list the API accepts, in order", () => {
    expect(VOID_REASONS).toEqual([
      { code: "waiter_error", label: "Error del mesero" },
      { code: "customer_left", label: "El cliente se fue" },
      { code: "dish_returned", label: "Plato devuelto" },
      { code: "duplicate_charge", label: "Cobro duplicado" },
      { code: "wrong_payment_method", label: "Método de pago equivocado" },
      { code: "other", label: "Otro" },
    ])
  })
})

describe("getAuditEvents", () => {
  it("reads GET /audit with only the given filters", async () => {
    api.GET.mockResolvedValueOnce({ data: [] })
    await expect(getAuditEvents()).resolves.toEqual([])
    expect(api.GET).toHaveBeenLastCalledWith("/api/audit", { params: { query: {} } })

    const event = { id: "e-1", eventType: "payment_voided" }
    api.GET.mockResolvedValueOnce({ data: [event] })
    await expect(
      getAuditEvents({
        from: "2026-11-01",
        to: "2026-11-07",
        types: ["order_cancelled", "payment_voided"],
        actorId: "p-1",
        authorizerId: "p-2",
        selfAuthorized: false,
      }),
    ).resolves.toEqual([event])
    expect(api.GET).toHaveBeenLastCalledWith("/api/audit", {
      params: {
        query: {
          from: "2026-11-01",
          to: "2026-11-07",
          type: "order_cancelled,payment_voided",
          actorId: "p-1",
          authorizerId: "p-2",
          selfAuthorized: "false",
        },
      },
    })
  })

  it("throws on an empty 2xx", async () => {
    api.GET.mockResolvedValueOnce({ data: undefined })
    await expect(getAuditEvents()).rejects.toBeInstanceOf(ApiError)
  })
})

describe("voidRefusalOf", () => {
  const refusal = (status: number, code: string, message: string) =>
    new ApiError(status, "Forbidden", message, { statusCode: status, error: "Forbidden", message, code })

  it("reads the stable code and the Spanish message of a refused cancellation or void", () => {
    expect(voidRefusalOf(refusal(403, "authorization_required", "Esta acción necesita la autorización de un supervisor"))).toEqual({
      code: "authorization_required",
      message: "Esta acción necesita la autorización de un supervisor",
    })
    expect(voidRefusalOf(refusal(409, "register_closed", "La caja de este pago ya está cerrada; no se puede anular"))).toEqual({
      code: "register_closed",
      message: "La caja de este pago ya está cerrada; no se puede anular",
    })
  })

  it("is null for anything else", () => {
    expect(voidRefusalOf(refusal(403, "terminal_route", "x"))).toBeNull()
    expect(voidRefusalOf(new ApiError(500, "Internal Server Error", "boom"))).toBeNull()
    expect(voidRefusalOf(new Error("network"))).toBeNull()
  })
})
