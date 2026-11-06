'use client'

import { useEffect, useRef, useState } from 'react'
import { realtimeService } from '@/lib/api/realtime'

/**
 * Time of the last live signal of the dispatch console (T25): the last
 * delivery-stream event, or the moment the socket (re)connected. The realtime
 * client keeps no such time, so the console records it with its own listener
 * on the same refcounted socket (no extra connection).
 */
export function useLastLiveSignal(connected: boolean): number | null {
  const [lastAt, setLastAt] = useState<number | null>(null)
  const wasConnected = useRef(false)

  useEffect(() => realtimeService.subscribeToDeliveries(() => setLastAt(Date.now())), [])

  useEffect(() => {
    if (connected && !wasConnected.current) setLastAt(Date.now())
    wasConnected.current = connected
  }, [connected])

  return lastAt
}

/** `Date.now()` refreshed every `intervalMs` (for "hace 2 s" and late tones). */
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return now
}
