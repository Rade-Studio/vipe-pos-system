"use client"

/**
 * Transfer documents as React Query (odd/tasks/inventario-rediseno.md, S2/S3).
 * Every write refreshes the list and the stock reads: sending, receiving and
 * cancelling move stock in or out of the in-transit place.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import * as inventory from "@/lib/api/inventory"
import type { InventoryTransfer, ReceiveTransferLineInput, TransferInput } from "@/lib/api/inventory"
import { InventoryError, toInventoryError } from "@/lib/inventory/errors"
import { inventoryKeys, menuStockKey } from "@/lib/inventory/query-keys"

export function useTransfers() {
  return useQuery({
    queryKey: inventoryKeys.transfers(),
    queryFn: async () => {
      try {
        return await inventory.listTransfers()
      } catch (error) {
        throw toInventoryError(error)
      }
    },
  })
}

function useTransferMutation<TVars>(fn: (vars: TVars) => Promise<InventoryTransfer>) {
  const queryClient = useQueryClient()
  return useMutation<InventoryTransfer, InventoryError, TVars>({
    mutationFn: async (vars) => {
      try {
        return await fn(vars)
      } catch (error) {
        throw toInventoryError(error)
      }
    },
    onSuccess: () =>
      Promise.all(
        [
          inventoryKeys.transfers(),
          inventoryKeys.items(),
          inventoryKeys.lots(),
          inventoryKeys.movements(),
          inventoryKeys.overview(),
          menuStockKey,
        ].map((queryKey) => queryClient.invalidateQueries({ queryKey })),
      ),
  })
}

export const useCreateTransfer = () => useTransferMutation((v: TransferInput) => inventory.createTransfer(v))

export const useUpdateTransfer = () =>
  useTransferMutation((v: { id: string; input: TransferInput }) => inventory.updateTransfer(v.id, v.input))

export const useSendTransfer = () => useTransferMutation((id: string) => inventory.sendTransfer(id))

export const useReceiveTransfer = () =>
  useTransferMutation((v: { id: string; lines: ReceiveTransferLineInput[] }) => inventory.receiveTransfer(v.id, v.lines))

export const useCancelTransfer = () => useTransferMutation((id: string) => inventory.cancelTransfer(id))
