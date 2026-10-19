/**
 * Inventory items (`ingredients`) and their categories. Admin writes go
 * straight to the tables through RLS; `stock` is never written here (the
 * inventory RPCs own it) and a blank SKU lets the server assign MP-/PR-####.
 */

import { db, embeddedName, num, numOrNull, unwrap } from "./shared"
import type {
  CreatePreparationInput,
  InventoryCategory,
  InventoryItem,
  InventoryItemInput,
  ItemKind,
} from "./types"

const ITEM_COLUMNS =
  "id, sku, name, description, kind, unit, barcode, cost, stock, min_stock, max_stock, purchase_unit, purchase_factor, " +
  "default_supplier_id, track_lots, shelf_life_days, is_active, category_id, ingredient_categories(name)"

export interface ItemRow {
  id: string
  sku: string
  name: string
  description: string | null
  kind: string
  unit: string
  barcode: string | null
  cost: number | string | null
  stock: number | string
  min_stock: number | string
  max_stock: number | string | null
  purchase_unit: string | null
  purchase_factor: number | string
  default_supplier_id: string | null
  track_lots: boolean
  shelf_life_days: number | null
  is_active: boolean
  category_id: string | null
  ingredient_categories?: { name: string } | null
}

export const mapItem = (r: ItemRow): InventoryItem => ({
  id: r.id,
  sku: r.sku,
  name: r.name,
  description: r.description,
  kind: r.kind === "prep" ? "prep" : "raw",
  unit: r.unit,
  barcode: r.barcode,
  cost: num(r.cost),
  stock: num(r.stock),
  minStock: num(r.min_stock),
  maxStock: numOrNull(r.max_stock),
  purchaseUnit: r.purchase_unit,
  purchaseFactor: num(r.purchase_factor) || 1,
  defaultSupplierId: r.default_supplier_id,
  trackLots: r.track_lots,
  shelfLifeDays: r.shelf_life_days,
  isActive: r.is_active,
  categoryId: r.category_id,
  categoryName: embeddedName(r.ingredient_categories),
})

/** Only the keys present in the input, so updates are partial. */
const toItemPatch = (input: Partial<InventoryItemInput>): Record<string, unknown> => {
  const patch: Record<string, unknown> = {}
  const set = (key: string, value: unknown) => {
    if (value !== undefined) patch[key] = value
  }
  set("name", input.name?.trim())
  set("unit", input.unit)
  set("kind", input.kind)
  if (input.sku !== undefined) patch.sku = input.sku?.trim() ? input.sku.trim().toUpperCase() : null
  set("description", input.description)
  set("barcode", input.barcode)
  set("min_stock", input.minStock)
  set("max_stock", input.maxStock)
  set("purchase_unit", input.purchaseUnit)
  set("purchase_factor", input.purchaseFactor)
  set("default_supplier_id", input.defaultSupplierId)
  set("track_lots", input.trackLots)
  set("shelf_life_days", input.shelfLifeDays)
  set("is_active", input.isActive)
  set("category_id", input.categoryId)
  return patch
}

export interface ListItemsOptions {
  kind?: ItemKind
  includeInactive?: boolean
}

export async function listItems(options: ListItemsOptions = {}): Promise<InventoryItem[]> {
  let query = db.from("ingredients").select(ITEM_COLUMNS)
  if (options.kind) query = query.eq("kind", options.kind)
  if (options.includeInactive === false) query = query.eq("is_active", true)
  const rows = await unwrap<ItemRow[] | null>(query.order("name", { ascending: true }))
  return (rows ?? []).map(mapItem)
}

export async function getItem(id: string): Promise<InventoryItem> {
  return mapItem(await unwrap<ItemRow>(db.from("ingredients").select(ITEM_COLUMNS).eq("id", id).single()))
}

export async function createItem(input: InventoryItemInput): Promise<InventoryItem> {
  const row = await unwrap<ItemRow>(db.from("ingredients").insert(toItemPatch(input)).select(ITEM_COLUMNS).single())
  return mapItem(row)
}

export async function updateItem(id: string, input: Partial<InventoryItemInput>): Promise<InventoryItem> {
  const row = await unwrap<ItemRow>(
    db.from("ingredients").update(toItemPatch(input)).eq("id", id).select(ITEM_COLUMNS).single(),
  )
  return mapItem(row)
}

/**
 * A `kind = 'prep'` item ready to receive a formula (save_formula with
 * targetType 'prep'). The SKU is assigned by the server; `yieldQuantity` is
 * not an item column, the caller passes it to save_formula.
 */
export async function createPreparation(input: CreatePreparationInput): Promise<InventoryItem> {
  const row = await unwrap<ItemRow>(
    db
      .from("ingredients")
      .insert({ name: input.name.trim(), unit: input.unit, kind: "prep", category_id: input.categoryId ?? null })
      .select(ITEM_COLUMNS)
      .single(),
  )
  return mapItem(row)
}

// ---------------- categories ----------------

interface CategoryRow {
  id: string
  name: string
  description: string | null
}

const mapCategory = (r: CategoryRow): InventoryCategory => ({ id: r.id, name: r.name, description: r.description })

export async function listCategories(): Promise<InventoryCategory[]> {
  const rows = await unwrap<CategoryRow[] | null>(
    db.from("ingredient_categories").select("id, name, description").order("name", { ascending: true }),
  )
  return (rows ?? []).map(mapCategory)
}

export async function createCategory(input: { name: string; description?: string | null }): Promise<InventoryCategory> {
  const row = await unwrap<CategoryRow>(
    db
      .from("ingredient_categories")
      .insert({ name: input.name.trim(), description: input.description ?? null })
      .select("id, name, description")
      .single(),
  )
  return mapCategory(row)
}

export async function updateCategory(
  id: string,
  input: { name?: string; description?: string | null },
): Promise<InventoryCategory> {
  const patch: Record<string, unknown> = {}
  if (input.name !== undefined) patch.name = input.name.trim()
  if (input.description !== undefined) patch.description = input.description
  const row = await unwrap<CategoryRow>(
    db.from("ingredient_categories").update(patch).eq("id", id).select("id, name, description").single(),
  )
  return mapCategory(row)
}

/** Items of a deleted category keep existing with `category_id = null` (FK ON DELETE SET NULL). */
export async function deleteCategory(id: string): Promise<void> {
  await unwrap(db.from("ingredient_categories").delete().eq("id", id))
}
