"use client"

/**
 * The waiters directory as ONE shared React Query (T6/S1).
 *
 * Before this task two owners fetched the same rows: `WaiterView.loadWaiters`
 * (re-run by the effect that also set up realtime, so every table selection
 * re-read it) and `WaiterSelectionModal.loadWaiters` (re-run on every open, from
 * both the waiter and the kitchen screen). Both now read this query, keyed
 * `['waiters']`, so the list is fetched once per session of the app and is
 * shared by every consumer — including KitchenView's waiter picker, which needs
 * no change of its own.
 */

import { useQuery } from "@tanstack/react-query"

import { mapWaiterRowsToProfiles } from "@/lib/menu/waiters"
import { waiterService } from "@/lib/supabase/service"
import type { Profile } from "@/types"

export const WAITERS_QUERY_KEY = ["waiters"] as const

export const fetchWaiters = async (): Promise<Profile[]> => mapWaiterRowsToProfiles(await waiterService.getAll())

export function useWaiters() {
  return useQuery<Profile[]>({
    queryKey: WAITERS_QUERY_KEY,
    queryFn: fetchWaiters,
  })
}