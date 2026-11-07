/**
 * Ajustes → Estaciones y rutas (F6, design/admin-stations/02-tabla-por-categoria.html).
 * Pure derivations of GET /stations and GET /stations/routes for the page:
 * how many dishes each station receives, the categories whose dishes go to the
 * default station only because nothing routes them (the warning banner), the
 * search over categories and dishes, and the "Así se parte una comanda"
 * preview built from the restaurant's own dishes (S6: no invented data).
 */
import type { DishRouteDto, StationDto, StationRoutesDto } from "@/lib/api/stations"

export const prepStations = (stations: readonly StationDto[]) => stations.filter((station) => station.kind === "prep")
export const cashierStation = (stations: readonly StationDto[]) => stations.find((station) => station.kind === "cashier") ?? null
export const defaultStation = (stations: readonly StationDto[]) =>
  stations.find((station) => station.isDefault) ?? prepStations(stations)[0] ?? null

/** Active dishes each station receives now (routedStationId). */
export function dishCountByStation(routes: StationRoutesDto | undefined): Map<string, number> {
  const counts = new Map<string, number>()
  for (const dish of routes?.dishes ?? []) {
    if (!dish.active || !dish.routedStationId) continue
    counts.set(dish.routedStationId, (counts.get(dish.routedStationId) ?? 0) + 1)
  }
  return counts
}

export interface UnroutedGroup {
  categoryId: string | null
  categoryName: string
  dishes: string[]
}

/** The banner: active dishes without a route, by category (a dish without category under "Sin categoría"). */
export function unroutedGroups(routes: StationRoutesDto | undefined): UnroutedGroup[] {
  const groups = new Map<string, UnroutedGroup>()
  for (const dish of routes?.unroutedDishes ?? []) {
    const key = dish.categoryId ?? ""
    const group = groups.get(key) ?? { categoryId: dish.categoryId, categoryName: dish.categoryName ?? "Sin categoría", dishes: [] }
    group.dishes.push(dish.name)
    groups.set(key, group)
  }
  return [...groups.values()]
}

/** "Cazuela" / "Cazuela y Lechona" / "Cazuela, Lechona y Ajiaco". */
export function joinNames(names: readonly string[]): string {
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}`
}

const fold = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim()

/** Category rows to show for `query`, each with the dishes that matched (all of them when the category name matched). */
export function searchRoutes(routes: StationRoutesDto | undefined, query: string) {
  const q = fold(query)
  const byCategory = new Map<string, DishRouteDto[]>()
  for (const dish of routes?.dishes ?? []) {
    if (dish.categoryId) byCategory.set(dish.categoryId, [...(byCategory.get(dish.categoryId) ?? []), dish])
  }
  return (routes?.categories ?? []).flatMap((category) => {
    const dishes = byCategory.get(category.id) ?? []
    if (!q || fold(category.name).includes(q)) return [{ category, dishes, matched: false }]
    const hits = dishes.filter((dish) => fold(dish.name).includes(q))
    return hits.length ? [{ category, dishes: hits, matched: true }] : []
  })
}

export interface PreviewLine {
  name: string
  categoryName: string
  stationId: string
  exception: boolean
}

export interface SplitPreview {
  lines: PreviewLine[]
  tickets: { station: StationDto; lines: PreviewLine[] }[]
  exception: PreviewLine | null
}

/**
 * A sample comanda from the restaurant's own dishes (at most four): one
 * exception when there is one, a dish of every station that receives
 * something, then the first dish of other categories; split by the station
 * each goes to now. Null when there is nothing to show.
 */
export function splitPreview(routes: StationRoutesDto | undefined, stations: readonly StationDto[]): SplitPreview | null {
  const names = new Map((routes?.categories ?? []).map((category) => [category.id, category.name]))
  const active = (routes?.dishes ?? []).filter((dish) => dish.active && dish.routedStationId)
  const exception = active.find((dish) => dish.source === "dish")
  const picked: DishRouteDto[] = exception ? [exception] : []
  // Every station that receives something shows a ticket.
  for (const prep of prepStations(stations)) {
    const dish = active.find((candidate) => candidate.routedStationId === prep.id && candidate.source !== "dish")
    if (dish && picked.length < 4 && !picked.some((other) => other.routedStationId === prep.id)) picked.push(dish)
  }
  for (const dish of active) {
    if (picked.length >= 4) break
    if (picked.some((other) => other.id === dish.id || other.categoryId === dish.categoryId)) continue
    picked.push(dish)
  }
  if (picked.length === 0) return null
  const lines = picked.map((dish) => ({
    name: dish.name,
    categoryName: (dish.categoryId && names.get(dish.categoryId)) || "Sin categoría",
    stationId: dish.routedStationId as string,
    exception: dish.source === "dish",
  }))
  const tickets = prepStations(stations)
    .map((station) => ({ station, lines: lines.filter((line) => line.stationId === station.id) }))
    .filter((ticket) => ticket.lines.length > 0)
  return { lines, tickets, exception: lines.find((line) => line.exception) ?? null }
}
