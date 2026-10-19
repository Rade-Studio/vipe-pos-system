/**
 * Physical counts. `open_inventory_count` snapshots expected quantities, the
 * admin then updates `counted_quantity` line by line (RLS), and
 * `apply_inventory_count` sets the final balance = counted. A count can be
 * cancelled by update while open.
 */

import { db, embeddedName, num, numOrNull, rpc, unwrap } from "./shared"
import type {
  ApplyCountResult,
  CountLine,
  CountStatus,
  InventoryCount,
  InventoryCountDetail,
  OpenCountInput,
  OpenCountResult,
} from "./types"

const COUNT_COLUMNS = "id, number, location_id, status, notes, applied_at, created_at, inventory_locations(name)"

interface CountRow {
  id: string
  number: number
  location_id: string
  status: string
  notes: string | null
  applied_at: string | null
  created_at: string
  inventory_locations?: { name: string } | null
  inventory_count_lines?: CountLineRow[] | null
}

interface CountLineRow {
  id: string
  ingredient_id: string
  expected_quantity: number | string
  counted_quantity: number | string | null
  notes: string | null
  ingredients?: { name: string; sku: string; unit: string } | null
}

const mapCount = (r: CountRow): InventoryCount => ({
  id: r.id,
  number: r.number,
  locationId: r.location_id,
  locationName: embeddedName(r.inventory_locations),
  status: r.status as CountStatus,
  notes: r.notes,
  appliedAt: r.applied_at,
  createdAt: r.created_at,
})

const mapLine = (r: CountLineRow): CountLine => ({
  id: r.id,
  itemId: r.ingredient_id,
  itemName: r.ingredients?.name ?? null,
  sku: r.ingredients?.sku ?? null,
  unit: r.ingredients?.unit ?? null,
  expectedQuantity: num(r.expected_quantity),
  countedQuantity: numOrNull(r.counted_quantity),
  notes: r.notes,
})

/** Newest first. */
export async function listCounts(): Promise<InventoryCount[]> {
  const rows = await unwrap<CountRow[] | null>(
    db.from("inventory_counts").select(COUNT_COLUMNS).order("number", { ascending: false }),
  )
  return (rows ?? []).map(mapCount)
}

/** Lines sorted by item name. */
export async function getCount(id: string): Promise<InventoryCountDetail> {
  const row = await unwrap<CountRow>(
    db
      .from("inventory_counts")
      .select(`${COUNT_COLUMNS}, inventory_count_lines(id, ingredient_id, expected_quantity, counted_quantity, notes, ingredients(name, sku, unit))`)
      .eq("id", id)
      .single(),
  )
  const lines = (row.inventory_count_lines ?? []).map(mapLine)
  lines.sort((a, b) => (a.itemName ?? "").localeCompare(b.itemName ?? "", "es"))
  return { ...mapCount(row), lines }
}

export async function openCount(input: OpenCountInput = {}): Promise<OpenCountResult> {
  const r = await rpc<Record<string, unknown>>("open_inventory_count", {
    p_location_id: input.locationId ?? null,
    p_ingredient_ids: input.itemIds ?? null,
    p_notes: input.notes ?? null,
  })
  return {
    countId: r.count_id as string,
    number: num(r.number),
    locationId: r.location_id as string,
    status: r.status as CountStatus,
    linesCount: num(r.lines_count),
  }
}

/** null clears the line (not counted yet). */
export async function setCountedQuantity(lineId: string, countedQuantity: number | null): Promise<void> {
  await unwrap(db.from("inventory_count_lines").update({ counted_quantity: countedQuantity }).eq("id", lineId))
}

export async function applyCount(countId: string): Promise<ApplyCountResult> {
  const r = await rpc<Record<string, unknown>>("apply_inventory_count", { p_count_id: countId })
  return {
    countId: r.count_id as string,
    status: r.status as CountStatus,
    adjustedLines: num(r.adjusted_lines),
    valueDelta: num(r.value_delta),
  }
}

export async function cancelCount(countId: string): Promise<void> {
  await unwrap(db.from("inventory_counts").update({ status: "cancelled" }).eq("id", countId))
}
