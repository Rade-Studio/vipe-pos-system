"use client"

/**
 * The order panel's pricing (S11): the cart (and the open order) priced by
 * `POST /orders/pricing-preview` as if sent now, debounced while the waiter
 * taps. The delivery form (S7 of promociones-mejoras) passes its own `draft`
 * lines instead of a waiter cart. It never blocks sending: a failed preview keeps the last good result
 * (or none), and the order is still sent at list price for the server to fix.
 */

import { useEffect, useMemo, useRef, useState } from "react"
import { keepPreviousData, useQuery } from "@tanstack/react-query"

import { getPricingPreview, type PricingPreviewDto, type PromotionChannel } from "@/lib/api/promotions"
import { previewDraft, type PreviewDraft } from "@/lib/promotions/waiter"
import type { CartItem } from "@/types"

export const PRICING_PREVIEW_KEY = ["pricing-preview"] as const
export const PREVIEW_DEBOUNCE_MS = 250
const PREVIEW_REFRESH_MS = 60_000

export interface PricingPreviewResult {
  preview: PricingPreviewDto
  /** The cart line behind each draft index of the request that produced `preview`. */
  lineIds: string[]
  orderId: string | null
}

interface Options {
  channel: PromotionChannel
  /** The open order: its sent lines are priced with the draft. */
  orderId?: string
  /** Changes when the open order's lines change, so the preview is asked again. */
  orderVersion?: string
  /** The waiter's cart; ignored when `draft` is given. */
  cart?: readonly CartItem[]
  /** Draft lines already built by the caller (the delivery form). */
  draft?: PreviewDraft
  enabled?: boolean
}

const NO_CART: readonly CartItem[] = []

export function usePricingPreview({ channel, orderId, orderVersion = "", cart = NO_CART, draft: given, enabled = true }: Options) {
  const draft = useMemo(() => given ?? previewDraft(cart), [given, cart])
  const draftKey = JSON.stringify(draft.lines)
  const [debounced, setDebounced] = useState<PreviewDraft>(draft)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(draft), PREVIEW_DEBOUNCE_MS)
    return () => clearTimeout(timer)
    // The key, not the object: an equal cart does not restart the wait.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey])

  const active = enabled && (debounced.lines.length > 0 || Boolean(orderId))
  const query = useQuery<PricingPreviewResult>({
    queryKey: [...PRICING_PREVIEW_KEY, channel, orderId ?? null, orderVersion, JSON.stringify(debounced.lines)],
    queryFn: async () => ({
      preview: await getPricingPreview({ channel, ...(orderId ? { orderId } : {}), lines: debounced.lines }),
      lineIds: debounced.lineIds,
      orderId: orderId ?? null,
    }),
    enabled: active,
    placeholderData: keepPreviousData,
    refetchInterval: active ? PREVIEW_REFRESH_MS : false,
    retry: false,
  })

  // A network error never wipes what the waiter already saw.
  const lastGood = useRef<PricingPreviewResult | undefined>(undefined)
  if (query.data && !query.isError) lastGood.current = query.data
  const latest = query.data ?? lastGood.current
  // Another table's answer (kept while the new one loads) is not this order's.
  const result = active && latest && latest.orderId === (orderId ?? null) ? latest : undefined
  return { result, isError: query.isError, pending: draftKey !== JSON.stringify(debounced.lines) }
}
