import { describe, expect, it } from "vitest"
import type { StationDto, StationRoutesDto } from "@/lib/api/stations"
import { dishCountByStation, joinNames, searchRoutes, splitPreview, unroutedGroups } from "./stations"

/** F6 — derivations of the Estaciones y rutas page. */

const station = (id: string, name: string, extra: Partial<StationDto> = {}): StationDto => ({
  id,
  name,
  kind: "prep",
  color: "kitchen",
  sortOrder: 0,
  isDefault: false,
  createdAt: "2026-11-07T11:00:00.000Z",
  updatedAt: "2026-11-07T11:00:00.000Z",
  ...extra,
})
const stations = [station("k", "Cocina", { isDefault: true }), station("b", "Barra", { sortOrder: 1 }), station("c", "Caja", { kind: "cashier" })]

const routes: StationRoutesDto = {
  categories: [
    { id: "pf", name: "Platos fuertes", stationId: "k", dishCount: 2 },
    { id: "be", name: "Bebidas", stationId: "b", dishCount: 2 },
    { id: "es", name: "Especiales del día", stationId: null, dishCount: 2 },
  ],
  dishes: [
    { id: "d1", name: "Bandeja paisa", categoryId: "pf", active: true, stationId: null, routedStationId: "k", source: "category" },
    { id: "d2", name: "Ajiaco santafereño", categoryId: "pf", active: true, stationId: null, routedStationId: "k", source: "category" },
    { id: "d3", name: "Jugo de lulo", categoryId: "be", active: true, stationId: null, routedStationId: "b", source: "category" },
    { id: "d4", name: "Limonada de coco", categoryId: "be", active: true, stationId: "k", routedStationId: "k", source: "dish" },
    { id: "d5", name: "Cazuela de mariscos", categoryId: "es", active: true, stationId: null, routedStationId: "k", source: "fallback" },
    { id: "d6", name: "Lechona tolimense", categoryId: "es", active: false, stationId: null, routedStationId: "k", source: "fallback" },
  ],
  unroutedDishes: [
    { id: "d5", name: "Cazuela de mariscos", categoryId: "es", categoryName: "Especiales del día" },
    { id: "d7", name: "Arepa", categoryId: null, categoryName: null },
  ],
}

describe("stations page derivations", () => {
  it("counts the active dishes each station receives", () => {
    expect(Object.fromEntries(dishCountByStation(routes))).toEqual({ k: 4, b: 1 })
    expect(dishCountByStation(undefined).size).toBe(0)
  })

  it("groups the dishes without a route by category for the banner", () => {
    expect(unroutedGroups(routes)).toEqual([
      { categoryId: "es", categoryName: "Especiales del día", dishes: ["Cazuela de mariscos"] },
      { categoryId: null, categoryName: "Sin categoría", dishes: ["Arepa"] },
    ])
    expect(joinNames(["A", "B", "C"])).toBe("A, B y C")
    expect(joinNames(["A"])).toBe("A")
  })

  it("searches categories and dishes, without accents or case", () => {
    expect(searchRoutes(routes, "").map((row) => row.category.id)).toEqual(["pf", "be", "es"])
    const lulo = searchRoutes(routes, "LULO")
    expect(lulo.map((row) => [row.category.id, row.dishes.map((d) => d.id), row.matched])).toEqual([["be", ["d3"], true]])
    expect(searchRoutes(routes, "especiales del dia")[0]).toMatchObject({ matched: false })
    expect(searchRoutes(routes, "xyz")).toEqual([])
  })

  it("builds the split preview from the restaurant's own dishes, exception first", () => {
    const preview = splitPreview(routes, stations)!
    expect(preview.lines.map((line) => line.name)).toEqual(["Limonada de coco", "Jugo de lulo", "Bandeja paisa", "Cazuela de mariscos"])
    expect(preview.tickets.map((t) => [t.station.name, t.lines.map((l) => l.name)])).toEqual([
      ["Cocina", ["Limonada de coco", "Bandeja paisa", "Cazuela de mariscos"]],
      ["Barra", ["Jugo de lulo"]],
    ])
    expect(preview.exception).toMatchObject({ name: "Limonada de coco", categoryName: "Bebidas" })
    expect(splitPreview({ categories: [], dishes: [], unroutedDishes: [] }, stations)).toBeNull()
  })
})
