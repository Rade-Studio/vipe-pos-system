'use client'

/**
 * `useActiveDeliveries()` — TanStack-Query binding for the delivery
 * operator board.
 *
 * Wraps `listActiveDeliveries` so every consumer can render with a stable
 * loading / error / data triangle, and so `refreshActiveDeliveries(client)`
 * from anywhere in the app re-reads the board in one place (the new-order
 * dialog uses it after a successful `createDeliveryOrder`).
 *
 * Realtime (T11): the API socket client (`lib/api/realtime.ts`) hands this
 * hook `order_deliveries` events (delivery lifecycle moves) and `orders`
 * events of delivery orders (the bill half of the join: totals / status).
 * `resync` and every reconnect already invalidate `['active-deliveries']`.
 *
 * T10 (S1/S2) changed three things here:
 *
 *  - ONE subscription for the whole app. The board, the cashier panel and the
 *    kitchen all read this hook; the previous per-hook channel created one
 *    duplicate fan-out per consumer. The
 *    subscription is refcounted per QueryClient and torn down when the last
 *    consumer unmounts.
 *  - `orders` pushes are filtered to deliveries. The bare `event: '*'`
 *    subscription refetched the whole board for EVERY table order in the
 *    restaurant — the "the screen loads again when I touch a table" report.
 *  - `order_deliveries` pushes are MERGED into the cached rows instead of
 *    refetching (the table has REPLICA IDENTITY FULL, so the push carries the
 *    whole row), and whatever refetch remains is debounced. This is what makes
 *    a card action cost ONE read (the RPC), not three (RPC + explicit refetch
 *    + realtime refetch).
 *
 * Consumers must import the query key / refresh helper from here so the board,
 * the cashier panel and the kitchen share one cache slot.
 */

import { useEffect, useState } from 'react'
import {
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseQueryResult,
} from '@tanstack/react-query'
import { listActiveDeliveries } from '@/lib/api/delivery'
import type { DeliveryOrderWithBill } from '@/lib/api/delivery'
import { realtimeService, type ChangeEvent } from '@/lib/api/realtime'
import {
  DELIVERY_REALTIME_DEBOUNCE_MS,
  applyDeliveryRowPatch,
  createDebouncedRefresher,
  isDeliveryOrderChange,
  type DebouncedRefresher,
} from '@/lib/delivery/realtime'

export const activeDeliveriesQueryKey: readonly (string | number)[] = ['active-deliveries']

interface DeliverySubscription {
  /** Ends the socket subscription. */
  stop: () => void
  /** Mounted consumers; the subscription ends when the last one leaves. */
  consumers: number
  /** Debounced `invalidateQueries` shared by every consumer of this client. */
  refresh: DebouncedRefresher
}

/**
 * Keyed by QueryClient so there is exactly one subscription per app (one
 * client) and tests can use their own client without leaking subscriptions.
 */
const subscriptions = new WeakMap<QueryClient, DeliverySubscription>()

function subscribe(queryClient: QueryClient): DeliverySubscription {
  const existing = subscriptions.get(queryClient)
  if (existing) {
    existing.consumers += 1
    return existing
  }

  const refresh = createDebouncedRefresher(() => {
    void queryClient.invalidateQueries({ queryKey: activeDeliveriesQueryKey })
  }, DELIVERY_REALTIME_DEBOUNCE_MS)

  const onChange = (payload: ChangeEvent) => {
    if (payload.table === 'order_deliveries') {
      const cached = queryClient.getQueryData<DeliveryOrderWithBill[]>(activeDeliveriesQueryKey) ?? []
      const outcome = applyDeliveryRowPatch(cached, payload.new)
      if (outcome.kind === 'patched') {
        queryClient.setQueryData(activeDeliveriesQueryKey, outcome.rows)
        return
      }
      // `unchanged`: the echo of a write this client already applied.
      if (outcome.kind === 'needs-refresh') refresh()
      return
    }
    // The push carries no bill numbers we can trust for a join this board
    // owns, but it does say whether the row is a delivery at all. Table
    // orders must not re-read the delivery board.
    if (payload.table === 'orders' && isDeliveryOrderChange(payload)) refresh()
  }

  const subscription: DeliverySubscription = {
    stop: realtimeService.subscribeToDeliveries(onChange),
    consumers: 1,
    refresh,
  }
  subscriptions.set(queryClient, subscription)
  return subscription
}

function unsubscribe(queryClient: QueryClient, subscription: DeliverySubscription): void {
  subscription.consumers -= 1
  if (subscription.consumers > 0) return
  subscriptions.delete(queryClient)
  // A push that arrived inside the last window still has to land.
  subscription.refresh.cancel()
  subscription.stop()
}

/**
 * Re-read the board (debounced, so a payment that produces several pushes —
 * our explicit call plus the realtime one — costs one request).
 *
 * Prefer this over a bare `invalidateQueries({ queryKey:
 * activeDeliveriesQueryKey })`: the bare call and the realtime push would race
 * and refetch twice.
 */
export function refreshActiveDeliveries(queryClient: QueryClient): void {
  const subscription = subscriptions.get(queryClient)
  if (subscription) {
    subscription.refresh()
    return
  }
  void queryClient.invalidateQueries({ queryKey: activeDeliveriesQueryKey })
}

export function useActiveDeliveries(): UseQueryResult<DeliveryOrderWithBill[], Error> {
  const queryClient = useQueryClient()

  const query = useQuery<DeliveryOrderWithBill[], Error>({
    queryKey: activeDeliveriesQueryKey,
    queryFn: () => listActiveDeliveries(),
    staleTime: 30_000,
  })

  useEffect(() => {
    const subscription = subscribe(queryClient)
    return () => unsubscribe(queryClient, subscription)
  }, [queryClient])

  return query
}

/** How often the console re-reads the socket state for its live indicator. */
export const REALTIME_STATUS_POLL_MS = 1_000

/**
 * T12: the dispatch console's "En vivo" indicator. Reads the socket state the
 * realtime client already keeps (`realtimeService.isConnected`); the client
 * exposes no status subscription for the delivery stream, so it is polled.
 */
export function useRealtimeConnected(): boolean {
  const [connected, setConnected] = useState(() => realtimeService.isConnected === true)
  useEffect(() => {
    const read = () => setConnected(realtimeService.isConnected === true)
    read()
    const timer = setInterval(read, REALTIME_STATUS_POLL_MS)
    return () => clearInterval(timer)
  }, [])
  return connected
}
