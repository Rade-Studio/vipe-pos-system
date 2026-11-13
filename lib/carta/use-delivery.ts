"use client"

import { useCallback, useEffect, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { DELIVERY_STEP, fetchDeliveryStatus, loadTrackingToken, saveTrackingToken } from "./delivery"

/** Guests have no socket (L10): the delivery status is polled while the page is visible. */
export const DELIVERY_POLL_MS = 15_000

function browserStorage(): Storage | undefined {
  return typeof window === "undefined" ? undefined : window.localStorage
}

/**
 * The guest's delivery order (S15): every 15 s while the tab is visible
 * (TanStack pauses intervals in the background) and on focus, until it ends
 * (delivered, rejected, failed, cancelled).
 */
export function useDeliveryStatus(slug: string, trackingToken: string | null, poll = true) {
  const query = useQuery({
    queryKey: ["carta-delivery-status", slug, trackingToken],
    queryFn: () => fetchDeliveryStatus(slug, trackingToken!),
    enabled: !!trackingToken,
    refetchInterval: (q) => {
      const stage = q.state.data?.stage
      const over = stage !== undefined && (stage === "delivered" || DELIVERY_STEP[stage] < 0)
      return poll && !over ? DELIVERY_POLL_MS : false
    },
    refetchIntervalInBackground: false,
    retry: false,
  })
  const { refetch } = query
  const active = poll && !!trackingToken
  useEffect(() => {
    if (!active) return
    const onFocus = () => void refetch()
    window.addEventListener("focus", onFocus)
    return () => window.removeEventListener("focus", onFocus)
  }, [active, refetch])
  return query
}

/** The last tracking token remembered for the slug; null until mounted (server render). */
export function useTrackingToken(slug: string) {
  const [token, setToken] = useState<string | null>(null)
  useEffect(() => {
    setToken(loadTrackingToken(browserStorage(), slug))
  }, [slug])
  const remember = useCallback(
    (next: string | null) => {
      saveTrackingToken(browserStorage(), slug, next)
      setToken(next)
    },
    [slug],
  )
  return [token, remember] as const
}
