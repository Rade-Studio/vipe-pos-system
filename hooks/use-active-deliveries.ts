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
 * Realtime lives in THIS file on purpose: `lib/supabase/realtime-service.ts`
 * is out of surface for this task and the delivery-service adds its own table
 * later, so we subscribe locally to `order_deliveries` (delivery lifecycle
 * moves) and `orders` (the bill half of the join: totals / status).
 *
 * T10 (S1/S2) changed three things here:
 *
 *  - ONE channel for the whole app. The board, the cashier panel and the
 *    kitchen all read this hook; the previous per-hook `supabase.channel(...)`
 *    created one channel (and one duplicate fan-out) per consumer. The
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

import { useEffect } from 'react'
import {
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseQueryResult,
} from '@tanstack/react-query'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase/client'
import { listActiveDeliveries } from '@/lib/supabase/delivery-service'
import type { DeliveryOrderWithBill } from '@/lib/supabase/delivery-service'
import {
  DELIVERY_REALTIME_DEBOUNCE_MS,
  applyDeliveryRowPatch,
  createDebouncedRefresher,
  isDeliveryOrderChange,
  type DebouncedRefresher,
} from '@/lib/delivery/realtime'

export const activeDeliveriesQueryKey: readonly (string | number)[] = ['active-deliveries']

interface DeliverySubscription {
  channel: RealtimeChannel
  /** Mounted consumers; the channel is removed when the last one leaves. */
  consumers: number
  /** Debounced `invalidateQueries` shared by every consumer of this client. */
  refresh: DebouncedRefresher
}

/**
 * Keyed by QueryClient so there is exactly one channel per app (one client)
 * and tests can use their own client without leaking subscriptions.
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

  const subscription: DeliverySubscription = {
    channel: undefined as unknown as RealtimeChannel,
    consumers: 1,
    refresh,
  }

  subscription.channel = supabase
    .channel('active-deliveries')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'order_deliveries' },
      (payload) => {
        const cached = queryClient.getQueryData<DeliveryOrderWithBill[]>(activeDeliveriesQueryKey) ?? []
        const outcome = applyDeliveryRowPatch(cached, (payload as { new?: unknown }).new)
        if (outcome.kind === 'patched') {
          queryClient.setQueryData(activeDeliveriesQueryKey, outcome.rows)
          return
        }
        // `unchanged`: the echo of a write this client already applied.
        if (outcome.kind === 'needs-refresh') refresh()
      },
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'orders' },
      (payload) => {
        // The push carries no bill numbers we can trust for a join this board
        // owns, but it does say whether the row is a delivery at all. Table
        // orders must not re-read the delivery board.
        if (!isDeliveryOrderChange(payload as { eventType?: string; new?: unknown; old?: unknown })) return
        refresh()
      },
    )
    .subscribe()

  subscriptions.set(queryClient, subscription)
  return subscription
}

function unsubscribe(queryClient: QueryClient, subscription: DeliverySubscription): void {
  subscription.consumers -= 1
  if (subscription.consumers > 0) return
  subscriptions.delete(queryClient)
  // A push that arrived inside the last window still has to land.
  subscription.refresh.cancel()
  void supabase.removeChannel(subscription.channel)
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