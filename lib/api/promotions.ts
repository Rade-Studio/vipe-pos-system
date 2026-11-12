import { api } from "./client"
import { ApiError } from "./errors"
import type { components } from "./schema"

/**
 * The terminals' promotion reads (S8, S11): what applies now on a channel,
 * later today and the rest (`GET /catalog/promotions/today`), and the pricing
 * of a draft order as if it were sent now (`POST /orders/pricing-preview`).
 * The preview writes nothing; the server fixes the promotions when the items
 * are inserted.
 */

type Schemas = components["schemas"]
export type PromotionDto = Schemas["Promotion"]
export type PromotionsTodayDto = Schemas["PromotionsToday"]
export type TodayActivePromotionDto = Schemas["TodayActivePromotion"]
export type TodayLaterPromotionDto = Schemas["TodayLaterPromotion"]
export type TodayOtherPromotionDto = Schemas["TodayOtherPromotion"]
export type PricingPreviewDto = Schemas["PricingPreview"]
export type PreviewLineDto = Schemas["PreviewLine"]
export type PricingHintDto = Schemas["PricingHintDto"]
export type PricingPreviewRequest = Schemas["PricingPreviewRequest"]
export type PromotionChannel = PromotionsTodayDto["channel"]

function required<T>(data: T | undefined): T {
  if (data === undefined) throw new ApiError(500, "Internal Server Error", "Empty API response")
  return data
}

/** Active now (with the end of the window), later today (with the start) and the others with why not. */
export async function getPromotionsToday(channel: PromotionChannel): Promise<PromotionsTodayDto> {
  const { data } = await api.GET("/api/catalog/promotions/today", { params: { query: { channel } } })
  return required(data)
}

/** The draft lines (and the open order's sent lines) priced as if sent now. */
export async function getPricingPreview(body: PricingPreviewRequest): Promise<PricingPreviewDto> {
  const { data } = await api.POST("/api/orders/pricing-preview", { body })
  return required(data)
}
