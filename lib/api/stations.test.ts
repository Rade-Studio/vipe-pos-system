import { beforeEach, describe, expect, it, vi } from "vitest"

/** F6 — stations and routes through the typed API client. */

const api = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn(), PUT: vi.fn(), DELETE: vi.fn() }))
vi.mock("@/lib/api/client", () => ({ api }))

import {
  createStarterStations,
  createStation,
  deleteStation,
  fetchStationRoutes,
  listStations,
  setCategoryStation,
  setDishStation,
  updateStation,
  type StationDto,
} from "./stations"

const station: StationDto = {
  id: "s-1",
  name: "Cocina",
  kind: "prep",
  color: "kitchen",
  sortOrder: 0,
  isDefault: true,
  createdAt: "2026-11-07T11:00:00.000Z",
  updatedAt: "2026-11-07T11:00:00.000Z",
}
const byId = (id: string) => ({ params: { path: { id } } })

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset().mockResolvedValue({ data: station })
})

describe("stations requests", () => {
  it("lists and creates stations, and the starter set", async () => {
    api.GET.mockResolvedValueOnce({ data: [station] })
    await expect(listStations()).resolves.toEqual([station])
    expect(api.GET).toHaveBeenCalledWith("/api/stations")
    await createStation({ name: "Postres", color: "free" })
    expect(api.POST).toHaveBeenCalledWith("/api/stations", { body: { name: "Postres", color: "free" } })
    api.POST.mockResolvedValueOnce({ data: [station] })
    await expect(createStarterStations()).resolves.toEqual([station])
    expect(api.POST).toHaveBeenLastCalledWith("/api/stations/starter")
  })

  it("renames and deletes with the move target", async () => {
    await updateStation("s-1", { name: "Cocina caliente" })
    expect(api.PATCH).toHaveBeenCalledWith("/api/stations/{id}", { ...byId("s-1"), body: { name: "Cocina caliente" } })
    api.DELETE.mockResolvedValueOnce({ data: undefined })
    await deleteStation("s-2", "s-1")
    expect(api.DELETE).toHaveBeenCalledWith("/api/stations/{id}", { ...byId("s-2"), body: { moveTo: "s-1" } })
  })

  it("reads and writes the routes", async () => {
    const routes = { categories: [], dishes: [], unroutedDishes: [] }
    api.GET.mockResolvedValueOnce({ data: routes })
    await expect(fetchStationRoutes()).resolves.toEqual(routes)
    expect(api.GET).toHaveBeenCalledWith("/api/stations/routes")
    api.PUT.mockResolvedValue({ data: undefined })
    await setCategoryStation("c-1", "s-1")
    expect(api.PUT).toHaveBeenCalledWith("/api/stations/routes/categories/{id}", { ...byId("c-1"), body: { stationId: "s-1" } })
    await setDishStation("d-1", null)
    expect(api.PUT).toHaveBeenLastCalledWith("/api/stations/routes/dishes/{id}", { ...byId("d-1"), body: { stationId: null } })
  })

  it("throws on a 2xx without body", async () => {
    api.GET.mockResolvedValueOnce({ data: undefined })
    await expect(listStations()).rejects.toMatchObject({ status: 500 })
  })
})
