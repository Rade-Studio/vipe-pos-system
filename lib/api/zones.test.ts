import { beforeEach, describe, expect, it, vi } from "vitest"

/** T4 (S4) — floor plan zones through the typed API client. */

const api = vi.hoisted(() => ({
  GET: vi.fn(),
  POST: vi.fn(),
  PATCH: vi.fn(),
  DELETE: vi.fn(),
}))
vi.mock("@/lib/api/client", () => ({ api }))

import { create, delete as deleteZone, getAll, update, type ZoneDto } from "./zones"

const zone: ZoneDto = {
  id: "z-1",
  name: "Terraza",
  aspect: 2,
  sortOrder: 1,
  labels: [{ text: "Entrada", side: "bottom" }],
  active: true,
  createdAt: "2026-11-04T11:00:00.000Z",
  updatedAt: "2026-11-04T12:00:00.000Z",
}

const byId = { params: { path: { id: "z-1" } } }

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset().mockResolvedValue({ data: zone })
})

describe("zones requests", () => {
  it("lists the active zones, or every zone for the admin editor", async () => {
    api.GET.mockResolvedValue({ data: [zone] })
    await expect(getAll()).resolves.toEqual([zone])
    expect(api.GET).toHaveBeenCalledWith("/api/zones", { params: { query: {} } })
    await getAll({ includeInactive: true })
    expect(api.GET).toHaveBeenLastCalledWith("/api/zones", { params: { query: { includeInactive: "true" } } })
  })

  it("creates, updates and deletes a zone", async () => {
    await expect(create({ name: "Terraza", aspect: 2 })).resolves.toEqual(zone)
    expect(api.POST).toHaveBeenCalledWith("/api/zones", { body: { name: "Terraza", aspect: 2 } })

    await update("z-1", { labels: [{ text: "Cocina", side: "top" }] })
    expect(api.PATCH).toHaveBeenCalledWith("/api/zones/{id}", { ...byId, body: { labels: [{ text: "Cocina", side: "top" }] } })

    api.DELETE.mockResolvedValueOnce({ data: undefined })
    await deleteZone("z-1")
    expect(api.DELETE).toHaveBeenCalledWith("/api/zones/{id}", byId)
  })

  it("throws on a 2xx without body", async () => {
    api.GET.mockResolvedValueOnce({ data: undefined })
    await expect(getAll()).rejects.toMatchObject({ status: 500 })
  })
})
