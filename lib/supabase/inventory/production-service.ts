/** Batch production of preparations (`produce_preparation`) and the batch history. */

import { db, embeddedName, num, rpc, unwrap } from "./shared"
import type { ProducePreparationInput, ProducePreparationResult, ProductionBatch } from "./types"

interface BatchRow {
  id: string
  ingredient_id: string
  location_id: string
  lot_id: string | null
  quantity: number | string
  unit_cost: number | string
  total_cost: number | string
  expires_on: string | null
  notes: string | null
  created_at: string
  ingredients?: { name: string; unit: string } | null
  inventory_locations?: { name: string } | null
  inventory_lots?: { lot_code: string | null } | null
}

const mapBatch = (r: BatchRow): ProductionBatch => ({
  id: r.id,
  itemId: r.ingredient_id,
  itemName: r.ingredients?.name ?? null,
  unit: r.ingredients?.unit ?? null,
  locationId: r.location_id,
  locationName: embeddedName(r.inventory_locations),
  lotId: r.lot_id,
  lotCode: r.inventory_lots?.lot_code ?? null,
  quantity: num(r.quantity),
  unitCost: num(r.unit_cost),
  totalCost: num(r.total_cost),
  expiresOn: r.expires_on,
  notes: r.notes,
  createdAt: r.created_at,
})

/** Newest first, optionally for one preparation. */
export async function listBatches(options: { itemId?: string; limit?: number } = {}): Promise<ProductionBatch[]> {
  let query = db
    .from("production_batches")
    .select(
      "id, ingredient_id, location_id, lot_id, quantity, unit_cost, total_cost, expires_on, notes, created_at, " +
        "ingredients(name, unit), inventory_locations(name), inventory_lots(lot_code)",
    )
  if (options.itemId) query = query.eq("ingredient_id", options.itemId)
  const rows = await unwrap<BatchRow[] | null>(query.order("created_at", { ascending: false }).limit(options.limit ?? 100))
  return (rows ?? []).map(mapBatch)
}

/** Insufficient stock rejects with P0001 whose `details` lists the shortages (see toInventoryError). */
export async function producePreparation(input: ProducePreparationInput): Promise<ProducePreparationResult> {
  const r = await rpc<Record<string, unknown>>("produce_preparation", {
    p_ingredient_id: input.itemId,
    p_quantity: input.quantity,
    p_location_id: input.locationId ?? null,
    p_lot_code: input.lotCode ?? null,
    p_notes: input.notes ?? null,
  })
  const consumed = (Array.isArray(r.consumed) ? r.consumed : []) as Array<Record<string, unknown>>
  return {
    batchId: r.batch_id as string,
    lotId: r.lot_id as string,
    lotCode: r.lot_code as string,
    itemId: r.ingredient_id as string,
    locationId: r.location_id as string,
    quantity: num(r.quantity),
    unitCost: num(r.unit_cost),
    totalCost: num(r.total_cost),
    expiresOn: (r.expires_on as string | null) ?? null,
    consumed: consumed.map((c) => ({
      itemId: c.ingredient_id as string,
      name: c.name as string,
      quantity: num(c.quantity),
      totalCost: num(c.total_cost),
    })),
  }
}
