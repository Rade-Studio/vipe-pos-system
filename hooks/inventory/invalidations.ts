import type { QueryKey } from "@tanstack/react-query"

import { inventoryKeys, menuStockKey } from "@/lib/inventory/query-keys"

/** Every inventory write the hooks expose, with what its invalidation depends on. */
export type InventoryMutation =
  | { type: "adjust"; itemId: string }
  | { type: "transfer"; itemId: string }
  | { type: "receivePurchase" }
  | { type: "applyCount" }
  | { type: "produce" }
  | { type: "consumeOrder" }
  | { type: "saveFormula" }
  | { type: "saveItem" }
  | { type: "saveCategory" }
  | { type: "saveLocation" }
  | { type: "saveSupplier" }
  | { type: "savePurchase" }
  /** Header and lines of one existing order (one PUT). */
  | { type: "updatePurchase"; purchaseId: string }
  | { type: "openCount" }
  | { type: "cancelCount" }
  | { type: "countLine"; countId: string }

/** Keys touched by any write that moves stock (single item when known). */
const stockChange = (itemId?: string): QueryKey[] => [
  inventoryKeys.items(),
  inventoryKeys.lots(itemId),
  inventoryKeys.movements(),
  inventoryKeys.overview(),
  menuStockKey,
]

/** The exact query keys a mutation makes stale. Pure, so it is tested without React. */
export function invalidationsFor(mutation: InventoryMutation): QueryKey[] {
  switch (mutation.type) {
    case "adjust":
    case "transfer":
      return stockChange(mutation.itemId)
    case "receivePurchase":
      return [...stockChange(), inventoryKeys.purchases()]
    case "applyCount":
      return [...stockChange(), inventoryKeys.counts()]
    case "produce":
      return [...stockChange(), inventoryKeys.batches()]
    case "consumeOrder":
      return stockChange()
    case "saveFormula":
      return [inventoryKeys.formulas(), menuStockKey]
    case "saveItem":
      return [inventoryKeys.items(), inventoryKeys.overview()]
    case "saveCategory":
      return [inventoryKeys.categories(), inventoryKeys.items()]
    case "saveLocation":
      return [inventoryKeys.locations()]
    case "saveSupplier":
      return [inventoryKeys.suppliers()]
    case "savePurchase":
    case "updatePurchase":
      return [inventoryKeys.purchases(), inventoryKeys.overview()]
    case "openCount":
    case "cancelCount":
      return [inventoryKeys.counts()]
    case "countLine":
      return [inventoryKeys.count(mutation.countId)]
  }
}

/**
 * Keys a FAILED mutation makes stale. A purchase order save that fails (a
 * `lineId` removed elsewhere answers 422) refetches the order, so the sheet
 * does not reload the cached stale lines; `purchases()` is the prefix of both
 * the list and `purchase(id)`.
 */
export function failureInvalidationsFor(mutation: InventoryMutation): QueryKey[] {
  return mutation.type === "updatePurchase" ? [inventoryKeys.purchases()] : []
}
