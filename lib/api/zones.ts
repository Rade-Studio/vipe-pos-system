import { api } from "./client"
import { ApiError } from "./errors"
import type { components } from "./schema"

/**
 * Floor plan zones through the API (T4). Any staff role lists the active
 * zones; the admin editor also sees inactive ones and writes them. Deleting a
 * zone that still has tables answers 409
 * `La zona tiene mesas; muévelas o elimínalas primero`; a duplicate name 409
 * `Ya existe una zona con ese nombre`.
 */

type Schemas = components["schemas"]
export type ZoneDto = Schemas["Zone"]
export type ZoneLabelDto = Schemas["ZoneLabel"]
export type UpdateZoneBody = Schemas["UpdateZoneRequest"]

/** A 2xx without the body the contract promises. */
function required<T>(data: T | undefined): T {
  if (data === undefined) throw new ApiError(500, "Internal Server Error", "Empty API response")
  return data
}

const byId = (id: string) => ({ params: { path: { id } } })

/** By sort order then name. `includeInactive` is admin only (403 otherwise). */
export async function getAll(options: { includeInactive?: boolean } = {}): Promise<ZoneDto[]> {
  const query = options.includeInactive ? { includeInactive: "true" as const } : {}
  const { data } = await api.GET("/api/zones", { params: { query } })
  return required(data)
}

export async function create(body: { name: string } & UpdateZoneBody): Promise<ZoneDto> {
  const { data } = await api.POST("/api/zones", { body: body as Schemas["CreateZoneRequest"] })
  return required(data)
}

export async function update(zoneId: string, body: UpdateZoneBody): Promise<ZoneDto> {
  const { data } = await api.PATCH("/api/zones/{id}", { ...byId(zoneId), body })
  return required(data)
}

async function deleteZone(zoneId: string): Promise<void> {
  await api.DELETE("/api/zones/{id}", byId(zoneId))
}
export { deleteZone as delete }
