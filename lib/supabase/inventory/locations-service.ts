/** Inventory locations (bodegas). Soft-deleted through `is_active`; no DELETE policy. */

import { db, unwrap } from "./shared"
import type { InventoryLocation, InventoryLocationInput } from "./types"

const COLUMNS = "id, name, code, is_default, is_active"

interface LocationRow {
  id: string
  name: string
  code: string
  is_default: boolean
  is_active: boolean
}

const mapLocation = (r: LocationRow): InventoryLocation => ({
  id: r.id,
  name: r.name,
  code: r.code,
  isDefault: r.is_default,
  isActive: r.is_active,
})

const toPatch = (input: Partial<InventoryLocationInput>): Record<string, unknown> => {
  const patch: Record<string, unknown> = {}
  if (input.name !== undefined) patch.name = input.name.trim()
  if (input.code !== undefined) patch.code = input.code.trim().toUpperCase()
  if (input.isDefault !== undefined) patch.is_default = input.isDefault
  if (input.isActive !== undefined) patch.is_active = input.isActive
  return patch
}

/** Default location first, then by name. */
export async function listLocations(): Promise<InventoryLocation[]> {
  const rows = await unwrap<LocationRow[] | null>(
    db.from("inventory_locations").select(COLUMNS).order("is_default", { ascending: false }).order("name", { ascending: true }),
  )
  return (rows ?? []).map(mapLocation)
}

export async function createLocation(input: InventoryLocationInput): Promise<InventoryLocation> {
  return mapLocation(await unwrap<LocationRow>(db.from("inventory_locations").insert(toPatch(input)).select(COLUMNS).single()))
}

export async function updateLocation(id: string, input: Partial<InventoryLocationInput>): Promise<InventoryLocation> {
  return mapLocation(
    await unwrap<LocationRow>(db.from("inventory_locations").update(toPatch(input)).eq("id", id).select(COLUMNS).single()),
  )
}
