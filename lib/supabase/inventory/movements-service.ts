/**
 * Stock reads (lots, movement ledger) and the stock RPCs that move a single
 * item: `inventory_adjust` (opening / adjustment / waste) and
 * `inventory_transfer` (FEFO between locations). Lots and movements are
 * read-only for the client.
 */

import { db, embeddedName, num, rpc, unwrap } from "./shared"
import type {
  AdjustMovementType,
  AdjustStockInput,
  AdjustStockResult,
  Lot,
  Movement,
  MovementFilters,
  MovementPage,
  MovementType,
  TransferStockInput,
  TransferStockResult,
} from "./types"

export const DEFAULT_MOVEMENTS_PAGE_SIZE = 50

// ---------------- lots ----------------

interface LotRow {
  id: string
  ingredient_id: string
  location_id: string
  lot_code: string | null
  expires_on: string | null
  quantity: number | string
  unit_cost: number | string
  received_at: string
  inventory_locations?: { name: string } | null
}

const mapLot = (r: LotRow): Lot => ({
  id: r.id,
  itemId: r.ingredient_id,
  locationId: r.location_id,
  locationName: embeddedName(r.inventory_locations),
  lotCode: r.lot_code,
  expiresOn: r.expires_on,
  quantity: num(r.quantity),
  unitCost: num(r.unit_cost),
  receivedAt: r.received_at,
})

/** Lots of one item in FEFO order (expires_on ASC NULLS LAST, received_at). Empty lots included. */
export async function listLots(itemId: string): Promise<Lot[]> {
  const rows = await unwrap<LotRow[] | null>(
    db
      .from("inventory_lots")
      .select("id, ingredient_id, location_id, lot_code, expires_on, quantity, unit_cost, received_at, inventory_locations(name)")
      .eq("ingredient_id", itemId)
      .order("expires_on", { ascending: true, nullsFirst: false })
      .order("received_at", { ascending: true }),
  )
  return (rows ?? []).map(mapLot)
}

// ---------------- movements ----------------

interface MovementRow {
  id: string
  ingredient_id: string
  location_id: string
  lot_id: string | null
  movement_type: string
  quantity: number | string
  unit_cost: number | string
  total_cost: number | string
  reason: string | null
  notes: string | null
  reference_type: string | null
  reference_id: string | null
  created_by: string | null
  created_at: string
  ingredients?: { name: string; sku: string; unit: string } | null
  inventory_locations?: { name: string } | null
}

const mapMovement = (r: MovementRow): Movement => ({
  id: r.id,
  itemId: r.ingredient_id,
  itemName: r.ingredients?.name ?? null,
  sku: r.ingredients?.sku ?? null,
  unit: r.ingredients?.unit ?? null,
  locationId: r.location_id,
  locationName: embeddedName(r.inventory_locations),
  lotId: r.lot_id,
  movementType: r.movement_type as MovementType,
  quantity: num(r.quantity),
  unitCost: num(r.unit_cost),
  totalCost: num(r.total_cost),
  reason: r.reason,
  notes: r.notes,
  referenceType: r.reference_type,
  referenceId: r.reference_id,
  createdBy: r.created_by,
  createdAt: r.created_at,
})

/** A bare date as `to` means the whole day. */
const endOfDay = (to: string) => (to.includes("T") ? to : `${to}T23:59:59.999`)

/** Newest first, one page (1-based) plus the exact total for the filters. */
export async function listMovements(filters: MovementFilters = {}): Promise<MovementPage> {
  const pageSize = filters.pageSize && filters.pageSize > 0 ? filters.pageSize : DEFAULT_MOVEMENTS_PAGE_SIZE
  const page = filters.page && filters.page > 0 ? filters.page : 1
  const offset = (page - 1) * pageSize

  let query = db
    .from("inventory_movements")
    .select(
      "id, ingredient_id, location_id, lot_id, movement_type, quantity, unit_cost, total_cost, reason, notes, " +
        "reference_type, reference_id, created_by, created_at, ingredients(name, sku, unit), inventory_locations(name)",
      { count: "exact" },
    )
  if (filters.itemId) query = query.eq("ingredient_id", filters.itemId)
  if (filters.locationId) query = query.eq("location_id", filters.locationId)
  if (filters.types && filters.types.length > 0) query = query.in("movement_type", filters.types)
  if (filters.from) query = query.gte("created_at", filters.from)
  if (filters.to) query = query.lte("created_at", endOfDay(filters.to))

  const { data, error, count } = await query.order("created_at", { ascending: false }).range(offset, offset + pageSize - 1)
  if (error) throw error
  return { rows: ((data as MovementRow[] | null) ?? []).map(mapMovement), total: count ?? 0 }
}

// ---------------- RPCs ----------------

export async function adjustStock(input: AdjustStockInput): Promise<AdjustStockResult> {
  const r = await rpc<Record<string, unknown>>("inventory_adjust", {
    p_ingredient_id: input.itemId,
    p_location_id: input.locationId,
    p_movement_type: input.movementType,
    p_quantity: input.quantity,
    p_unit_cost: input.unitCost ?? null,
    p_reason: input.reason ?? null,
    p_notes: input.notes ?? null,
    p_lot_id: input.lotId ?? null,
    p_lot_code: input.lotCode ?? null,
    p_expires_on: input.expiresOn ?? null,
  })
  return {
    itemId: r.ingredient_id as string,
    locationId: r.location_id as string,
    movementType: r.movement_type as AdjustMovementType,
    quantity: num(r.quantity),
    totalCost: num(r.total_cost),
    stock: num(r.stock),
  }
}

export async function transferStock(input: TransferStockInput): Promise<TransferStockResult> {
  const r = await rpc<Record<string, unknown>>("inventory_transfer", {
    p_ingredient_id: input.itemId,
    p_from_location_id: input.fromLocationId,
    p_to_location_id: input.toLocationId,
    p_quantity: input.quantity,
    p_notes: input.notes ?? null,
  })
  return {
    transferId: r.transfer_id as string,
    itemId: r.ingredient_id as string,
    fromLocationId: r.from_location_id as string,
    toLocationId: r.to_location_id as string,
    quantity: num(r.quantity),
    totalCost: num(r.total_cost),
  }
}
