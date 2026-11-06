"use client"

/**
 * The floor plan zones as ONE shared React Query (T6, S4), keyed `['zones']`.
 * A realtime `zones` event (an admin renamed, reordered or resized a zone)
 * refetches them, so every open map follows the floor plan live; a lost event
 * is covered by the realtime resync, which also invalidates `['zones']`.
 */

import { useEffect } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"

import { realtimeService } from "@/lib/api/realtime"
import { getAll, type ZoneDto } from "@/lib/api/zones"

export const ZONES_QUERY_KEY = ["zones"] as const

export function useZones() {
  const queryClient = useQueryClient()

  useEffect(
    () =>
      realtimeService.subscribeToZones(() => {
        void queryClient.invalidateQueries({ queryKey: [...ZONES_QUERY_KEY] }).catch(() => undefined)
      }),
    [queryClient],
  )

  return useQuery<ZoneDto[]>({
    queryKey: ZONES_QUERY_KEY,
    queryFn: () => getAll(),
  })
}
