import { beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError } from "./errors"

/** T7 (S15) — the delivery console's carta requests through the typed API client. */

const api = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn() }))
vi.mock("@/lib/api/client", () => ({ api }))

import { confirmDeliveryRequest, deliveryRequestErrorMessage, getDeliveryRequests, rejectDeliveryRequest } from "./carta-delivery"

const byId = { params: { path: { id: "r-1" } } }

beforeEach(() => {
  api.GET.mockReset()
  api.POST.mockReset()
})

describe("carta delivery requests", () => {
  it("lists the pending requests", async () => {
    api.GET.mockResolvedValue({ data: [{ id: "r-1" }] })
    await expect(getDeliveryRequests()).resolves.toEqual([{ id: "r-1" }])
    expect(api.GET).toHaveBeenCalledWith("/api/carta-delivery")
  })

  it("confirms by id and returns the created order", async () => {
    api.POST.mockResolvedValue({ data: { requestId: "r-1", status: "confirmed", order: { orderId: "o-1" } } })
    await expect(confirmDeliveryRequest("r-1")).resolves.toMatchObject({ order: { orderId: "o-1" } })
    expect(api.POST).toHaveBeenCalledWith("/api/carta-delivery/{id}/confirm", byId)
  })

  it("an empty 2xx confirm is an error", async () => {
    api.POST.mockResolvedValue({ data: undefined })
    await expect(confirmDeliveryRequest("r-1")).rejects.toBeInstanceOf(ApiError)
  })

  it("rejects with a trimmed reason, blank = null", async () => {
    api.POST.mockResolvedValue({ data: undefined })
    await rejectDeliveryRequest("r-1", "  No llegamos ")
    expect(api.POST).toHaveBeenLastCalledWith("/api/carta-delivery/{id}/reject", { ...byId, body: { reason: "No llegamos" } })
    await rejectDeliveryRequest("r-1", "   ")
    expect(api.POST).toHaveBeenLastCalledWith("/api/carta-delivery/{id}/reject", { ...byId, body: { reason: null } })
  })

  it("maps refusals to Spanish", () => {
    expect(deliveryRequestErrorMessage(new ApiError(409, "Conflict", "Este pedido ya fue atendido."), "x")).toBe("Este pedido ya fue atendido.")
    expect(deliveryRequestErrorMessage(new ApiError(422, "Unprocessable", "Un plato ya no está disponible."), "x")).toBe("Un plato ya no está disponible.")
    expect(deliveryRequestErrorMessage(new ApiError(500, "Internal", "boom"), "No se pudo.")).toBe("No se pudo.")
    expect(deliveryRequestErrorMessage(new Error("net"), "No se pudo.")).toBe("No se pudo.")
  })
})
