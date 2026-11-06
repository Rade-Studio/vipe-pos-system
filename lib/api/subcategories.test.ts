import { beforeEach, describe, expect, it, vi } from "vitest"

import { ApiError } from "./errors"

/** T8 (S5) — menu subcategories through the typed API client. */

const api = vi.hoisted(() => ({
  GET: vi.fn(),
  POST: vi.fn(),
  PATCH: vi.fn(),
  PUT: vi.fn(),
  DELETE: vi.fn(),
}))
vi.mock("@/lib/api/client", () => ({ api }))

import { create, delete as deleteSubcategory, getAll, reorder, type SubcategoryDto, update } from "./subcategories"

const subcategory: SubcategoryDto = {
  id: "s-1",
  categoryId: "c-1",
  name: "Parrilla",
  sortOrder: 0,
  active: true,
  createdAt: "2026-11-06T11:00:00.000Z",
  updatedAt: "2026-11-06T12:00:00.000Z",
}

const byId = { params: { path: { id: "s-1" } } }

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset().mockResolvedValue({ data: subcategory })
})

describe("subcategories requests", () => {
  it("lists the active subcategories of a category, or every one for the admin editor", async () => {
    api.GET.mockResolvedValue({ data: [subcategory] })
    await expect(getAll()).resolves.toEqual([subcategory])
    expect(api.GET).toHaveBeenCalledWith("/api/catalog/subcategories", { params: { query: {} } })
    await getAll({ categoryId: "c-1", includeInactive: true })
    expect(api.GET).toHaveBeenLastCalledWith("/api/catalog/subcategories", {
      params: { query: { categoryId: "c-1", includeInactive: "true" } },
    })
  })

  it("creates, updates and deletes a subcategory", async () => {
    await expect(create({ categoryId: "c-1", name: "Parrilla" })).resolves.toEqual(subcategory)
    expect(api.POST).toHaveBeenCalledWith("/api/catalog/subcategories", { body: { categoryId: "c-1", name: "Parrilla" } })

    await update("s-1", { name: "Asados", active: false })
    expect(api.PATCH).toHaveBeenCalledWith("/api/catalog/subcategories/{id}", { ...byId, body: { name: "Asados", active: false } })

    api.DELETE.mockResolvedValueOnce({ data: undefined })
    await deleteSubcategory("s-1")
    expect(api.DELETE).toHaveBeenCalledWith("/api/catalog/subcategories/{id}", byId)
  })

  it("saves the order of one category with one PUT", async () => {
    api.PUT.mockResolvedValueOnce({ data: [subcategory] })
    await expect(reorder("c-1", ["s-1"])).resolves.toEqual([subcategory])
    expect(api.PUT).toHaveBeenCalledWith("/api/catalog/subcategories/order", { body: { categoryId: "c-1", ids: ["s-1"] } })
  })

  it("passes the Spanish 409 through and throws on a 2xx without body", async () => {
    const message = "La subcategoría tiene platos; muévelos primero"
    api.DELETE.mockRejectedValueOnce(new ApiError(409, "Conflict", message))
    await expect(deleteSubcategory("s-1")).rejects.toMatchObject({ status: 409, message })
    api.GET.mockResolvedValueOnce({ data: undefined })
    await expect(getAll()).rejects.toMatchObject({ status: 500 })
  })
})
