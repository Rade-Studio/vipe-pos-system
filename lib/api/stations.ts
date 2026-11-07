import { api } from "./client"
import { ApiError } from "./errors"
import type { components } from "./schema"

/**
 * Stations and routes through the API (F6, odd/tasks/fase3-operacion.md L10,
 * L11). Every staff member lists the stations (the kitchen screen filters by
 * them); the admin creates, renames and deletes them and routes categories
 * and dishes. A station is deleted only by moving its routes to another one
 * (422 `move_required`); Caja cannot be deleted (409 `cashier_station`) nor
 * receive dishes (422 `cashier_route`). Refusals carry `code` and a Spanish
 * message in `ApiError`.
 */

type Schemas = components["schemas"]
export type StationDto = Schemas["Station"]
export type StationColor = StationDto["color"]
export type StationRoutesDto = Schemas["StationRoutes"]
export type CategoryRouteDto = Schemas["CategoryRoute"]
export type DishRouteDto = Schemas["DishRoute"]
/** The contract marks the defaulted fields (kind prep, color kitchen) as required; the API does not. */
export type CreateStationBody = Omit<Schemas["CreateStationRequest"], "kind" | "color"> & {
  kind?: StationDto["kind"]
  color?: StationColor
}
export type UpdateStationBody = Schemas["UpdateStationRequest"]

/** One cache slot for the stations list (admin page and kitchen selector). */
export const STATIONS_QUERY_KEY = ["stations"] as const
export const STATION_ROUTES_QUERY_KEY = ["stations", "routes"] as const

function required<T>(data: T | undefined): T {
  if (data === undefined) throw new ApiError(500, "Internal Server Error", "Empty API response")
  return data
}

const byId = (id: string) => ({ params: { path: { id } } })

/** Prep stations first (sort order, name), then Caja. */
export async function listStations(): Promise<StationDto[]> {
  const { data } = await api.GET("/api/stations")
  return required(data)
}

export async function createStation(body: CreateStationBody): Promise<StationDto> {
  const { data } = await api.POST("/api/stations", { body: body as Schemas["CreateStationRequest"] })
  return required(data)
}

/** The empty state's "Crear Cocina, Barra y Caja"; 409 `stations_exist` once any station exists. */
export async function createStarterStations(): Promise<StationDto[]> {
  const { data } = await api.POST("/api/stations/starter")
  return required(data)
}

export async function updateStation(id: string, body: UpdateStationBody): Promise<StationDto> {
  const { data } = await api.PATCH("/api/stations/{id}", { ...byId(id), body })
  return required(data)
}

/** Moves its categories, dish exceptions and sent lines to `moveTo`, then deletes it, in one transaction. */
export async function deleteStation(id: string, moveTo: string | null): Promise<void> {
  await api.DELETE("/api/stations/{id}", { ...byId(id), body: { moveTo } })
}

export async function fetchStationRoutes(): Promise<StationRoutesDto> {
  const { data } = await api.GET("/api/stations/routes")
  return required(data)
}

/** null: no route (its dishes go to the default station, with a warning). */
export async function setCategoryStation(categoryId: string, stationId: string | null): Promise<void> {
  await api.PUT("/api/stations/routes/categories/{id}", { ...byId(categoryId), body: { stationId } })
}

/** null: the dish follows its category. */
export async function setDishStation(dishId: string, stationId: string | null): Promise<void> {
  await api.PUT("/api/stations/routes/dishes/{id}", { ...byId(dishId), body: { stationId } })
}
