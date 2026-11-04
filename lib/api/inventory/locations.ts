/** Inventory locations (bodegas). Soft-deleted through `isActive`. */

import { api } from "@/lib/api/client"
import { byId, required } from "./shared"
import type { InventoryLocation, InventoryLocationInput } from "./types"

/** Default location first, then by name. */
export async function listLocations(): Promise<InventoryLocation[]> {
  const { data } = await api.GET("/api/inventory/locations")
  return required(data)
}

export async function createLocation(input: InventoryLocationInput): Promise<InventoryLocation> {
  const { data } = await api.POST("/api/inventory/locations", { body: input })
  return required(data)
}

/** `isDefault: true` moves the default here. */
export async function updateLocation(id: string, input: Partial<InventoryLocationInput>): Promise<InventoryLocation> {
  const { data } = await api.PATCH("/api/inventory/locations/{id}", { ...byId(id), body: input })
  return required(data)
}
