import { beforeEach, describe, expect, it, vi } from "vitest"

/** S8: the terminals' promotion reads through the typed API client. */

const api = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn() }))
vi.mock("@/lib/api/client", () => ({ api }))

import { getPricingPreview, getPromotionsToday } from "./promotions"

beforeEach(() => {
  api.GET.mockReset()
  api.POST.mockReset()
})

describe("promotions api", () => {
  it("reads today's promotions of a channel", async () => {
    api.GET.mockResolvedValueOnce({ data: { active: [] } })
    await expect(getPromotionsToday("dine_in")).resolves.toEqual({ active: [] })
    expect(api.GET).toHaveBeenCalledWith("/api/catalog/promotions/today", { params: { query: { channel: "dine_in" } } })
  })

  it("asks the pricing preview with the channel, the order and the draft lines", async () => {
    api.POST.mockResolvedValueOnce({ data: { lines: [] } })
    const body = { channel: "dine_in" as const, orderId: "o-1", lines: [{ dishId: "d-1", quantity: 2 }] }
    await expect(getPricingPreview(body)).resolves.toEqual({ lines: [] })
    expect(api.POST).toHaveBeenCalledWith("/api/orders/pricing-preview", { body })
  })

  it("an empty 2xx is an error", async () => {
    api.GET.mockResolvedValueOnce({ data: undefined })
    await expect(getPromotionsToday("dine_in")).rejects.toThrow("Empty API response")
  })
})
