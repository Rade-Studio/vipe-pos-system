"use client"

/**
 * Inventory writes as React Query mutations. Each one invalidates exactly the
 * keys `invalidationsFor` lists for it and rejects with an `InventoryError`.
 * No toasts here.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query"

import { InventoryError, toInventoryError } from "@/lib/inventory/errors"
import * as inventory from "@/lib/supabase/inventory"
import type {
  AdjustStockInput,
  CreatePreparationInput,
  CreatePurchaseOrderInput,
  InventoryItemInput,
  InventoryLocationInput,
  OpenCountInput,
  PaymentStatus,
  PurchaseOrderLineInput,
  ProducePreparationInput,
  ReceiveLineInput,
  SaveFormulaInput,
  SupplierInput,
  TransferStockInput,
} from "@/lib/supabase/inventory"
import { type InventoryMutation, invalidationsFor } from "./invalidations"

function useInventoryMutation<TVars, TResult>(
  fn: (vars: TVars) => Promise<TResult>,
  mutation: (vars: TVars) => InventoryMutation,
) {
  const queryClient = useQueryClient()
  return useMutation<TResult, InventoryError, TVars>({
    mutationFn: async (vars) => {
      try {
        return await fn(vars)
      } catch (error) {
        throw toInventoryError(error)
      }
    },
    onSuccess: (_result, vars) =>
      Promise.all(invalidationsFor(mutation(vars)).map((queryKey) => queryClient.invalidateQueries({ queryKey }))),
  })
}

// ---------------- stock ----------------

export const useAdjustStock = () =>
  useInventoryMutation((v: AdjustStockInput) => inventory.adjustStock(v), (v) => ({ type: "adjust", itemId: v.itemId }))

export const useTransferStock = () =>
  useInventoryMutation((v: TransferStockInput) => inventory.transferStock(v), (v) => ({ type: "transfer", itemId: v.itemId }))

export const useProducePreparation = () =>
  useInventoryMutation((v: ProducePreparationInput) => inventory.producePreparation(v), () => ({ type: "produce" }))

export const useConsumeOrderStock = () =>
  useInventoryMutation((orderId: string) => inventory.consumeOrderStock(orderId), () => ({ type: "consumeOrder" }))

/** A read with arbitrary input, exposed as a mutation (no cache, no invalidation). */
export const useCheckDishesStock = () =>
  useMutation({
    mutationFn: async (items: inventory.DishStockCheckItem[]) => {
      try {
        return await inventory.checkDishesStock(items)
      } catch (error) {
        throw toInventoryError(error)
      }
    },
  })

// ---------------- formulas ----------------

export const useSaveFormula = () =>
  useInventoryMutation((v: SaveFormulaInput) => inventory.saveFormula(v), () => ({ type: "saveFormula" }))

// ---------------- catalog ----------------

export const useCreateItem = () =>
  useInventoryMutation((v: InventoryItemInput) => inventory.createItem(v), () => ({ type: "saveItem" }))

export const useUpdateItem = () =>
  useInventoryMutation(
    (v: { id: string; input: Partial<InventoryItemInput> }) => inventory.updateItem(v.id, v.input),
    () => ({ type: "saveItem" }),
  )

export const useCreatePreparation = () =>
  useInventoryMutation((v: CreatePreparationInput) => inventory.createPreparation(v), () => ({ type: "saveItem" }))

export const useCreateCategory = () =>
  useInventoryMutation(
    (v: { name: string; description?: string | null }) => inventory.createCategory(v),
    () => ({ type: "saveCategory" }),
  )

export const useUpdateCategory = () =>
  useInventoryMutation(
    (v: { id: string; name?: string; description?: string | null }) =>
      inventory.updateCategory(v.id, { name: v.name, description: v.description }),
    () => ({ type: "saveCategory" }),
  )

export const useDeleteCategory = () =>
  useInventoryMutation((id: string) => inventory.deleteCategory(id), () => ({ type: "saveCategory" }))

export const useCreateLocation = () =>
  useInventoryMutation((v: InventoryLocationInput) => inventory.createLocation(v), () => ({ type: "saveLocation" }))

export const useUpdateLocation = () =>
  useInventoryMutation(
    (v: { id: string; input: Partial<InventoryLocationInput> }) => inventory.updateLocation(v.id, v.input),
    () => ({ type: "saveLocation" }),
  )

export const useCreateSupplier = () =>
  useInventoryMutation((v: SupplierInput) => inventory.createSupplier(v), () => ({ type: "saveSupplier" }))

export const useUpdateSupplier = () =>
  useInventoryMutation(
    (v: { id: string; input: Partial<SupplierInput> }) => inventory.updateSupplier(v.id, v.input),
    () => ({ type: "saveSupplier" }),
  )

// ---------------- purchases ----------------

export const useCreatePurchaseOrder = () =>
  useInventoryMutation((v: CreatePurchaseOrderInput) => inventory.createPurchaseOrder(v), () => ({ type: "savePurchase" }))

export const useUpdatePurchaseOrder = () =>
  useInventoryMutation(
    (v: { id: string; patch: Parameters<typeof inventory.updatePurchaseOrder>[1] }) =>
      inventory.updatePurchaseOrder(v.id, v.patch),
    () => ({ type: "savePurchase" }),
  )

export const useSetPurchaseOrderStatus = () =>
  useInventoryMutation(
    (v: { id: string; status: "ordered" | "cancelled" }) => inventory.setPurchaseOrderStatus(v.id, v.status),
    () => ({ type: "savePurchase" }),
  )

export const useSetPurchaseOrderPaymentStatus = () =>
  useInventoryMutation(
    (v: { id: string; paymentStatus: PaymentStatus }) => inventory.setPurchaseOrderPaymentStatus(v.id, v.paymentStatus),
    () => ({ type: "savePurchase" }),
  )

export const useDeletePurchaseOrder = () =>
  useInventoryMutation((id: string) => inventory.deletePurchaseOrder(id), () => ({ type: "savePurchase" }))

export const useAddPurchaseOrderLine = () =>
  useInventoryMutation(
    (v: { purchaseOrderId: string; line: PurchaseOrderLineInput }) => inventory.addPurchaseOrderLine(v.purchaseOrderId, v.line),
    () => ({ type: "savePurchase" }),
  )

export const useUpdatePurchaseOrderLine = () =>
  useInventoryMutation(
    (v: { lineId: string; quantity?: number; unitCost?: number }) =>
      inventory.updatePurchaseOrderLine(v.lineId, { quantity: v.quantity, unitCost: v.unitCost }),
    () => ({ type: "savePurchase" }),
  )

export const useRemovePurchaseOrderLine = () =>
  useInventoryMutation((lineId: string) => inventory.removePurchaseOrderLine(lineId), () => ({ type: "savePurchase" }))

export const useReceivePurchaseOrder = () =>
  useInventoryMutation(
    (v: { purchaseOrderId: string; lines: ReceiveLineInput[] }) => inventory.receivePurchaseOrder(v.purchaseOrderId, v.lines),
    () => ({ type: "receivePurchase" }),
  )

// ---------------- counts ----------------

export const useOpenCount = () =>
  useInventoryMutation((v: OpenCountInput) => inventory.openCount(v), () => ({ type: "openCount" }))

export const useSetCountedQuantity = () =>
  useInventoryMutation(
    (v: { countId: string; lineId: string; countedQuantity: number | null }) =>
      inventory.setCountedQuantity(v.lineId, v.countedQuantity),
    (v) => ({ type: "countLine", countId: v.countId }),
  )

export const useApplyCount = () =>
  useInventoryMutation((countId: string) => inventory.applyCount(countId), () => ({ type: "applyCount" }))

export const useCancelCount = () =>
  useInventoryMutation((countId: string) => inventory.cancelCount(countId), () => ({ type: "cancelCount" }))
