"use client"

/**
 * The promotions of today for a terminal channel (S11, S12), keyed
 * `['promotions', 'today', channel]`. Refreshed every minute, so the strip's
 * "quedan N min", the tile tags and the combo tile follow the clock without a
 * reload. A failed read leaves the order screen as it was: no strip data, no tags.
 */

import { useQuery } from "@tanstack/react-query"

import { getPromotionsToday, type PromotionChannel, type PromotionsTodayDto } from "@/lib/api/promotions"

export const PROMOTIONS_TODAY_KEY = ["promotions", "today"] as const
export const PROMOTIONS_REFRESH_MS = 60_000

export function usePromotionsToday(channel: PromotionChannel, { enabled = true }: { enabled?: boolean } = {}) {
  return useQuery<PromotionsTodayDto>({
    queryKey: [...PROMOTIONS_TODAY_KEY, channel],
    queryFn: () => getPromotionsToday(channel),
    enabled,
    refetchInterval: enabled ? PROMOTIONS_REFRESH_MS : false,
    retry: false,
  })
}
