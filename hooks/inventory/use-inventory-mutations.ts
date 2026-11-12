"use client"

/**
 * Inventory writes as React Query mutations. Each one invalidates exactly the
 * keys `invalidationsFor` lists for it and rejects with an `InventoryError`.
 * No toasts here.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query"

import { ApiError } from "@/lib/api/errors"
import { InventoryError, toInventoryError } from "@/lib/inventory/errors"
import { parseBulkShortages, type BulkShortage } from "@/lib/inventory/production-sheet"
import * as inventory from "@/lib/api/inventory"
import type {
  AdjustStockInput,
  BulkProduceInput,
  CreateItemInput,
  CreatePreparationInput,
  CreatePurchaseOrderInput,
  InventoryItemInput,
  InventoryLocationInput,
  OpenCountInput,
  PaymentStatus,
  ProductionTemplateInput,
  ProducePreparationInput,
  ReceiveLineInput,
  SaveFormulaInput,
  SupplierInput,
  TransferStockInput,
  UpdatePurchaseOrderInput,
} from "@/lib/api/inventory"
import { type InventoryMutation, failureInvalidationsFor, invalidationsFor } from "./invalidations"
import { productionTemplatesKey } from "./use-inventory-queries"

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
    onError: (_error, vars) =>
      Promise.all(failureInvalidationsFor(mutation(vars)).map((queryKey) => queryClient.invalidateQueries({ queryKey }))),
  })
}

// ---------------- stock ----------------

export const useAdjustStock = () =>
  useInventoryMutation((v: AdjustStockInput) => inventory.adjustStock(v), (v) => ({ type: "adjust", itemId: v.itemId }))

export const useTransferStock = () =>
  useInventoryMutation((v: TransferStockInput) => inventory.transferStock(v), (v) => ({ type: "transfer", itemId: v.itemId }))

export const useProducePreparation = () =>
  useInventoryMutation((v: ProducePreparationInput) => inventory.producePreparation(v), () => ({ type: "produce" }))

/** A refused daily report: the preparations that cannot be produced with their short inputs. */
export class ProductionShortageError extends InventoryError {
  readonly prepShortages: BulkShortage[]

  constructor(prepShortages: BulkShortage[]) {
    super("P0001", "Stock insuficiente: no se registró ningún lote.")
    this.name = "ProductionShortageError"
    this.prepShortages = prepShortages
  }
}

/** All lines or none; a shortage rejects with `ProductionShortageError`. */
export const useProducePreparations = () =>
  useInventoryMutation(
    async (v: BulkProduceInput) => {
      try {
        return await inventory.producePreparations(v)
      } catch (error) {
        const shortages = error instanceof ApiError ? parseBulkShortages(error.body.details) : []
        throw shortages.length > 0 ? new ProductionShortageError(shortages) : error
      }
    },
    () => ({ type: "produce" }),
  )

export const DUPLICATE_TEMPLATE_MESSAGE = "Ya existe una plantilla con ese nombre"

function useTemplateMutation<TVars, TResult>(fn: (vars: TVars) => Promise<TResult>) {
  const queryClient = useQueryClient()
  return useMutation<TResult, InventoryError, TVars>({
    mutationFn: async (vars) => {
      try {
        return await fn(vars)
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) throw new InventoryError("23505", DUPLICATE_TEMPLATE_MESSAGE)
        throw toInventoryError(error)
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: productionTemplatesKey }),
  })
}

export const useCreateProductionTemplate = () =>
  useTemplateMutation((v: ProductionTemplateInput) => inventory.createProductionTemplate(v))

export const useUpdateProductionTemplate = () =>
  useTemplateMutation((v: { id: string; input: Partial<ProductionTemplateInput> }) =>
    inventory.updateProductionTemplate(v.id, v.input),
  )

export const useDeleteProductionTemplate = () => useTemplateMutation((id: string) => inventory.deleteProductionTemplate(id))

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
  useInventoryMutation((v: CreateItemInput) => inventory.createItem(v), () => ({ type: "saveItem" }))

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
    (v: { id: string; input: UpdatePurchaseOrderInput }) => inventory.updatePurchaseOrder(v.id, v.input),
    (v) => ({ type: "updatePurchase", purchaseId: v.id }),
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

export const useReceivePurchaseOrder = () =>
  useInventoryMutation(
    (v: { purchaseOrderId: string; lines: ReceiveLineInput[]; paymentStatus?: PaymentStatus }) =>
      inventory.receivePurchaseOrder(v.purchaseOrderId, v.lines, v.paymentStatus),
    () => ({ type: "receivePurchase" }),
  )

// ---------------- counts ----------------

export const useOpenCount = () =>
  useInventoryMutation((v: OpenCountInput) => inventory.openCount(v), () => ({ type: "openCount" }))

export const useSetCountedQuantity = () =>
  useInventoryMutation(
    (v: { countId: string; lineId: string; countedQuantity: number | null }) =>
      inventory.setCountedQuantity(v.countId, v.lineId, v.countedQuantity),
    (v) => ({ type: "countLine", countId: v.countId }),
  )

export const useApplyCount = () =>
  useInventoryMutation((countId: string) => inventory.applyCount(countId), () => ({ type: "applyCount" }))

export const useCancelCount = () =>
  useInventoryMutation((countId: string) => inventory.cancelCount(countId), () => ({ type: "cancelCount" }))
