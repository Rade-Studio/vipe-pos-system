"use client"

/**
 * Counts with a counter and an approver (odd/tasks/inventario-rediseno.md, S5).
 * The admin side refreshes `counts()`; the counter side reads `myCounts()`,
 * which never carries the expected stock.
 */

import { useMutation, useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query"

import * as inventory from "@/lib/api/inventory"
import { toInventoryError, type InventoryError } from "@/lib/inventory/errors"
import { inventoryKeys } from "@/lib/inventory/query-keys"

function useCountMutation<TVars, TResult>(fn: (vars: TVars) => Promise<TResult>, keys: (vars: TVars) => QueryKey[]) {
  const queryClient = useQueryClient()
  return useMutation<TResult, InventoryError, TVars>({
    mutationFn: async (vars) => {
      try {
        return await fn(vars)
      } catch (error) {
        throw toInventoryError(error)
      }
    },
    onSuccess: (_result, vars) => Promise.all(keys(vars).map((queryKey) => queryClient.invalidateQueries({ queryKey }))),
  })
}

/** Counts assigned to the caller; empty (not an error) for a terminal without access. */
export function useMyCounts() {
  return useQuery({ queryKey: inventoryKeys.myCounts(), queryFn: () => inventory.listMyCounts(), retry: false })
}

export function useMyCount(id: string | null) {
  return useQuery({
    queryKey: inventoryKeys.myCount(id ?? ""),
    queryFn: () => inventory.getMyCount(id as string),
    enabled: !!id,
  })
}

export const useSetMyCountedQuantity = () =>
  useCountMutation(
    (v: { countId: string; lineId: string; countedQuantity: number | null }) =>
      inventory.setMyCountedQuantity(v.countId, v.lineId, v.countedQuantity),
    (v) => [inventoryKeys.myCount(v.countId)],
  )

export const useSubmitMyCount = () =>
  useCountMutation((countId: string) => inventory.submitMyCount(countId), () => [inventoryKeys.myCounts()])

export const useStartCount = () =>
  useCountMutation((countId: string) => inventory.startCount(countId), () => [inventoryKeys.counts()])

export const useRequestRecount = () =>
  useCountMutation(
    (v: { countId: string; lineIds: string[] }) => inventory.requestRecount(v.countId, v.lineIds),
    () => [inventoryKeys.counts()],
  )

export const useSetCountReason = () =>
  useCountMutation(
    (v: { countId: string; lineId: string; reason: string | null }) => inventory.setCountReason(v.countId, v.lineId, v.reason),
    (v) => [inventoryKeys.count(v.countId)],
  )
