"use client"

import { useCallback, useEffect, useMemo } from "react"
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query"
import type { Table } from "@/types"
import { getInbox } from "@/lib/api/carta-inbox"
import { realtimeService } from "@/lib/api/realtime"
import type { FloorZone } from "@/lib/floor/layout"
import { matchTableAlerts, type TableAlert } from "@/lib/floor/alerts"

export const CARTA_INBOX_KEY = ["carta-inbox"] as const

/**
 * One realtime listener per query client however many components read the
 * inbox (the Carta button and the floor's table alerts): the last reader to
 * unmount closes it.
 */
const subscriptions = new WeakMap<QueryClient, { readers: number; stop?: () => void }>()

function useInboxStream(queryClient: QueryClient) {
  useEffect(() => {
    let entry = subscriptions.get(queryClient)
    if (!entry) {
      // The shared client may predate the carta stream (screens that mock it).
      const stop = realtimeService.subscribeToCartaInbox?.(() => {
        void queryClient.invalidateQueries({ queryKey: CARTA_INBOX_KEY })
      })
      entry = { readers: 0, stop: stop ?? undefined }
      subscriptions.set(queryClient, entry)
    }
    entry.readers += 1
    const current = entry
    return () => {
      current.readers -= 1
      if (current.readers === 0) {
        current.stop?.()
        subscriptions.delete(queryClient)
      }
    }
  }, [queryClient])
}

/** The waiter's carta inbox (T5), live through the staff realtime socket. */
export function useCartaInbox() {
  const queryClient = useQueryClient()
  useInboxStream(queryClient)
  return useQuery({ queryKey: CARTA_INBOX_KEY, queryFn: getInbox, retry: false })
}

/**
 * ux-carta-mesero S4: the inbox's pending items per table, matched by zone
 * name + number (the inbox carries no table id).
 */
export function useCartaTableAlerts(tables: readonly Table[], zones: readonly FloorZone[] | undefined) {
  const { data } = useCartaInbox()
  const alerts = useMemo(() => {
    const names = new Map((zones ?? []).map((zone) => [zone.id, zone.name]))
    return matchTableAlerts(data, tables, (zoneId) => (zoneId ? names.get(zoneId) : undefined))
  }, [data, tables, zones])
  return useCallback((table: Table): TableAlert | undefined => alerts.get(table.id), [alerts])
}
