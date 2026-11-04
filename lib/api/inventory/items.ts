/**
 * Inventory items (`ingredients`) and their categories. `stock` moves only
 * through the stock endpoints; a blank SKU lets the server assign MP-/PR-####.
 */

import { api } from "@/lib/api/client"
import { byId, defined, flag, required } from "./shared"
import type {
  CreateItemInput,
  CreatePreparationInput,
  InventoryCategory,
  InventoryItem,
  InventoryItemInput,
  ItemKind,
} from "./types"

export interface ListItemsOptions {
  kind?: ItemKind
  /** false = active only. */
  includeInactive?: boolean
}

/** By name. */
export async function listItems(options: ListItemsOptions = {}): Promise<InventoryItem[]> {
  const { data } = await api.GET("/api/inventory/items", {
    params: { query: defined({ kind: options.kind, includeInactive: flag(options.includeInactive) }) },
  })
  return required(data)
}

export async function getItem(id: string): Promise<InventoryItem> {
  const { data } = await api.GET("/api/inventory/items/{id}", byId(id))
  return required(data)
}

/** The insert and the optional opening stock share one transaction: a failed opening leaves no item. */
export async function createItem(input: CreateItemInput): Promise<InventoryItem> {
  const { data } = await api.POST("/api/inventory/items", { body: input })
  return required(data)
}

export async function updateItem(id: string, input: Partial<InventoryItemInput>): Promise<InventoryItem> {
  const { data } = await api.PATCH("/api/inventory/items/{id}", { ...byId(id), body: input })
  return required(data)
}

/**
 * A `kind = 'prep'` item ready to receive a formula (save_formula with
 * targetType 'prep'). The SKU is assigned by the server; `yieldQuantity` is
 * not an item column, the caller passes it to save_formula.
 */
export async function createPreparation(input: CreatePreparationInput): Promise<InventoryItem> {
  const { data } = await api.POST("/api/inventory/items/preparations", { body: input })
  return required(data)
}

// ---------------- categories ----------------

export async function listCategories(): Promise<InventoryCategory[]> {
  const { data } = await api.GET("/api/inventory/item-categories")
  return required(data)
}

export async function createCategory(input: { name: string; description?: string | null }): Promise<InventoryCategory> {
  const { data } = await api.POST("/api/inventory/item-categories", { body: defined(input) })
  return required(data)
}

export async function updateCategory(
  id: string,
  input: { name?: string; description?: string | null },
): Promise<InventoryCategory> {
  const { data } = await api.PATCH("/api/inventory/item-categories/{id}", { ...byId(id), body: defined(input) })
  return required(data)
}

/** Items of a deleted category keep existing without category. */
export async function deleteCategory(id: string): Promise<void> {
  await api.DELETE("/api/inventory/item-categories/{id}", byId(id))
}
