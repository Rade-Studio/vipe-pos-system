'use client'

/**
 * `useActiveDeliveries()` — TanStack-Query binding for the delivery
 * operator board.
 *
 * Wraps `listActiveDeliveries` so the board can render with a stable
 * loading / error / data triangle, and so `invalidateQueries({
 * queryKey: activeDeliveriesQueryKey })` from anywhere in the app
 * refreshes the board in one place (the new-order dialog uses it
 * after a successful `createDeliveryOrder`).
 *
 * The realtime subscription lives in THIS file on purpose:
 * `lib/supabase/realtime-service.ts` is out of surface for this task
 * and the delivery-service adds its own table later, so we subscribe
 * locally to `order_deliveries` (delivery lifecycle moves) and
 * `orders` (food totals / status moves that re-shape the bill card).
 * Each subscription is a per-hook channel created with
 * `supabase.channel(...)` and torn down on unmount via the cleanup
 * returned from `useEffect`.
 *
 * Realtime pushes invalidate the query so React Query refetches in
 * the background; the board never renders a partial / inconsistent
 * state from the push payload itself.
 */

import { useEffect } from 'react'
import {
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase/client'
import { listActiveDeliveries } from '@/lib/supabase/delivery-service'
import type { DeliveryOrderWithBill } from '@/lib/supabase/delivery-service'

export const activeDeliveriesQueryKey: readonly (string | number)[] = ['active-deliveries']

export function useActiveDeliveries(): UseQueryResult<DeliveryOrderWithBill[], Error> {
  const queryClient = useQueryClient()

  const query = useQuery<DeliveryOrderWithBill[], Error>({
    queryKey: activeDeliveriesQueryKey,
    queryFn: () => listActiveDeliveries(),
    staleTime: 30_000,
  })

  // Realtime: any change to `order_deliveries` (status moves, courier
  // assignment, fee edits) or to `orders` (bill subtotal/tax/total
  // computed server-side after items are added) invalidates the
  // board's query so the next render fetches a coherent snapshot.
  //
  // We use a fresh per-hook channel so the cleanup is unconditional
  // (no shared channel registry to leak). Each channel is removed
  // when the operator navigates away from the view.
  useEffect(() => {
    const channel: RealtimeChannel = supabase
      .channel(`delivery-board-${Math.random().toString(36).slice(2)}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'order_deliveries' },
        () => {
          queryClient.invalidateQueries({ queryKey: activeDeliveriesQueryKey })
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders' },
        () => {
          queryClient.invalidateQueries({ queryKey: activeDeliveriesQueryKey })
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [queryClient])

  return query
}