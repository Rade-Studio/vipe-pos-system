"use client"

/**
 * S1: the void sheet's preview of the order as if the selected quantity of a
 * line were voided now (`getVoidPreview`), asked again a moment after the
 * cashier stops changing the quantity. Only orders with discounts ask it;
 * while it loads or when it fails the sheet keeps the generic note.
 */

import { useEffect, useState } from "react"
import { useQuery } from "@tanstack/react-query"

import { getVoidPreview, type VoidPreview } from "@/lib/api/orders"

export const VOID_PREVIEW_KEY = ["void-preview"] as const
export const VOID_PREVIEW_DEBOUNCE_MS = 300

interface Options {
  orderId: string
  orderItemId: string | undefined
  quantity: number
  enabled: boolean
}

export function useVoidPreview({ orderId, orderItemId, quantity, enabled }: Options) {
  const [debounced, setDebounced] = useState<number | null>(null)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(quantity), VOID_PREVIEW_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [quantity, orderItemId])

  const settled = debounced === quantity
  const query = useQuery<VoidPreview>({
    queryKey: [...VOID_PREVIEW_KEY, orderId, orderItemId ?? null, debounced],
    queryFn: () => getVoidPreview({ orderId, voids: [{ orderItemId: orderItemId!, quantity: debounced! }] }),
    enabled: enabled && Boolean(orderItemId) && debounced !== null,
    retry: false,
    staleTime: 15_000,
  })
  // A preview for another quantity (or an error) is never shown as this one's.
  return { preview: settled && !query.isError ? query.data : undefined }
}
