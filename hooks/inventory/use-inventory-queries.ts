"use client"

/**
 * Inventory reads as React Query (odd/tasks/admin-dashboard-inventario.md, T5).
 * Keys come from `inventoryKeys`; errors are `InventoryError` (Spanish message,
 * optional shortages). No toasts here: the screens decide how to show errors.
 */

import { keepPreviousData, useQuery } from "@tanstack/react-query"

import { toInventoryError } from "@/lib/inventory/errors"
import { inventoryKeys } from "@/lib/inventory/query-keys"
import * as inventory from "@/lib/supabase/inventory"
import type { ListItemsOptions } from "@/lib/supabase/inventory/items-service"
import type { MovementFilters, PurchaseOrderFilters } from "@/lib/supabase/inventory"

/** Wraps a service read so the query error is always an InventoryError. */
export const mapped =
  <T>(fn: () => Promise<T>) =>
  async (): Promise<T> => {
    try {
      return await fn()
    } catch (error) {
      throw toInventoryError(error)
    }
  }

/** Every item (raw and prep, active and inactive); filter on the client. */
export function useInventoryItems() {
  return useQuery({ queryKey: inventoryKeys.items(), queryFn: mapped(() => inventory.listItems()) })
}

/** A filtered list cached under the items prefix so item writes refresh it. */
export function useInventoryItemsBy(options: ListItemsOptions) {
  return useQuery({
    queryKey: [...inventoryKeys.items(), "by", options],
    queryFn: mapped(() => inventory.listItems(options)),
  })
}

export function useInventoryItem(id: string | null | undefined) {
  return useQuery({
    queryKey: inventoryKeys.item(id ?? ""),
    queryFn: mapped(() => inventory.getItem(id as string)),
    enabled: Boolean(id),
  })
}

export function useInventoryCategories() {
  return useQuery({ queryKey: inventoryKeys.categories(), queryFn: mapped(() => inventory.listCategories()) })
}

export function useInventoryLocations() {
  return useQuery({ queryKey: inventoryKeys.locations(), queryFn: mapped(() => inventory.listLocations()) })
}

export function useSuppliers() {
  return useQuery({ queryKey: inventoryKeys.suppliers(), queryFn: mapped(() => inventory.listSuppliers()) })
}

export function useItemLots(itemId: string | null | undefined) {
  return useQuery({
    queryKey: inventoryKeys.lots(itemId ?? ""),
    queryFn: mapped(() => inventory.listLots(itemId as string)),
    enabled: Boolean(itemId),
  })
}

/** Keeps the previous page on screen while the next one loads. */
export function useInventoryMovements(filters: MovementFilters) {
  return useQuery({
    queryKey: inventoryKeys.movements(filters),
    queryFn: mapped(() => inventory.listMovements(filters)),
    placeholderData: keepPreviousData,
  })
}

export function useFormulas() {
  return useQuery({ queryKey: inventoryKeys.formulas(), queryFn: mapped(() => inventory.listFormulas()) })
}

export function usePurchaseOrders(filters: PurchaseOrderFilters = {}) {
  return useQuery({
    queryKey: inventoryKeys.purchases(filters),
    queryFn: mapped(() => inventory.listPurchaseOrders(filters)),
  })
}

export function usePurchaseOrder(id: string | null | undefined) {
  return useQuery({
    queryKey: inventoryKeys.purchase(id ?? ""),
    queryFn: mapped(() => inventory.getPurchaseOrder(id as string)),
    enabled: Boolean(id),
  })
}

export function useInventoryCounts() {
  return useQuery({ queryKey: inventoryKeys.counts(), queryFn: mapped(() => inventory.listCounts()) })
}

export function useInventoryCount(id: string | null | undefined) {
  return useQuery({
    queryKey: inventoryKeys.count(id ?? ""),
    queryFn: mapped(() => inventory.getCount(id as string)),
    enabled: Boolean(id),
  })
}

export function useProductionBatches() {
  return useQuery({ queryKey: inventoryKeys.batches(), queryFn: mapped(() => inventory.listBatches()) })
}

export function useInventoryOverview(days = 30) {
  return useQuery({
    queryKey: inventoryKeys.overview(days),
    queryFn: mapped(() => inventory.getInventoryOverview(days)),
    placeholderData: keepPreviousData,
  })
}
