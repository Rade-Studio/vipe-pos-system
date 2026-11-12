import { beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError } from "./errors"

/** S13: the cashier's manual discounts through the typed API client. */

const api = vi.hoisted(() => ({ POST: vi.fn(), DELETE: vi.fn() }))
vi.mock("@/lib/api/client", () => ({ api }))

import { addOrderDiscount, discountRefusalOf, removeOrderDiscount } from "./discounts"

beforeEach(() => {
  api.POST.mockReset()
  api.DELETE.mockReset()
})

const refusal = (status: number, code: string, message = "server text") =>
  new ApiError(status, "Error", message, { code, message })

describe("discounts api", () => {
  it("adds a discount to the order and answers the recomputed order", async () => {
    api.POST.mockResolvedValueOnce({ data: { id: "o-1", total: 79000 } })
    const body = { orderItemId: "i-1", promotionId: "p-1", reason: "Cumpleaños", authorizationId: "a-1" }
    await expect(addOrderDiscount("o-1", body)).resolves.toEqual({ id: "o-1", total: 79000 })
    expect(api.POST).toHaveBeenCalledWith("/api/orders/{id}/discounts", { params: { path: { id: "o-1" } }, body })
  })

  it("removes a manual discount with its authorization, or none", async () => {
    api.DELETE.mockResolvedValue({ data: { id: "o-1" } })
    await removeOrderDiscount("o-1", "d-1", "a-1")
    expect(api.DELETE).toHaveBeenCalledWith("/api/orders/{id}/discounts/{discountId}", {
      params: { path: { id: "o-1", discountId: "d-1" } },
      body: { authorizationId: "a-1" },
    })
    await removeOrderDiscount("o-1", "d-1")
    expect(api.DELETE).toHaveBeenLastCalledWith("/api/orders/{id}/discounts/{discountId}", {
      params: { path: { id: "o-1", discountId: "d-1" } },
      body: {},
    })
  })

  it("an empty 2xx is an error", async () => {
    api.POST.mockResolvedValueOnce({ data: undefined })
    await expect(addOrderDiscount("o-1", { reason: "abc" })).rejects.toThrow("Empty API response")
  })

  it("422, 403 and 409 codes become Spanish messages", () => {
    expect(discountRefusalOf(refusal(422, "promotion_max_uses"))).toEqual({
      code: "promotion_max_uses",
      message: "Esta promoción ya se usó el máximo de veces en la cuenta",
      reauthorize: false,
    })
    expect(discountRefusalOf(refusal(403, "authorization_invalid"))).toEqual({
      code: "authorization_invalid",
      message: "La autorización venció o ya se usó. Escribe el PIN otra vez.",
      reauthorize: true,
    })
    expect(discountRefusalOf(refusal(403, "self_authorization_not_allowed")).message).toBe(
      "Otra persona con rol de supervisor debe autorizar esta acción",
    )
    expect(discountRefusalOf(refusal(409, "order_closed")).message).toBe("La orden está cerrada (pagada o cancelada)")
  })

  it("an unknown code keeps the server text; anything else is generic", () => {
    expect(discountRefusalOf(refusal(422, "new_code", "Texto del servidor")).message).toBe("Texto del servidor")
    expect(discountRefusalOf(new Error("network"))).toEqual({
      code: null,
      message: "No se pudo aplicar. Revisa la conexión e inténtalo de nuevo.",
      reauthorize: false,
    })
  })
})
