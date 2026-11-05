import { beforeEach, describe, expect, it, vi } from "vitest"

import { ApiError } from "./errors"

/**
 * T7b (S4) — the catalog reads and writes go through the typed API client
 * (`/api/catalog/...`), with camelCase bodies, instead of Supabase.
 */

const api = vi.hoisted(() => ({
  GET: vi.fn(),
  POST: vi.fn(),
  PATCH: vi.fn(),
  PUT: vi.fn(),
  DELETE: vi.fn(),
}))
vi.mock("@/lib/api/client", () => ({ api }))

import {
  createCategory,
  createDish,
  createPromotion,
  deleteCategory,
  deleteDish,
  deletePromotion,
  fetchCategories,
  fetchDishes,
  fetchPromotionDishes,
  fetchPromotions,
  setPromotionDishes,
  updateCategory,
  updateDish,
  updatePromotion,
} from "./catalog"

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset().mockResolvedValue({ data: [] })
})

describe("categories", () => {
  it("lists every category, or only the active ones", async () => {
    api.GET.mockResolvedValueOnce({ data: [{ id: "c-1" }] })
    await expect(fetchCategories()).resolves.toEqual([{ id: "c-1" }])
    expect(api.GET).toHaveBeenLastCalledWith("/api/catalog/categories", { params: { query: {} } })

    await fetchCategories({ active: true })
    expect(api.GET).toHaveBeenLastCalledWith("/api/catalog/categories", { params: { query: { active: "true" } } })
  })

  it("creates, updates and deletes with camelCase bodies and the id in the path", async () => {
    api.POST.mockResolvedValueOnce({ data: { id: "c-1" } })
    api.PATCH.mockResolvedValueOnce({ data: { id: "c-1" } })
    api.DELETE.mockResolvedValueOnce({ data: undefined })

    await createCategory({ name: "Entradas", icon: "Coffee", description: null, active: true })
    await updateCategory("c-1", { active: false })
    await deleteCategory("c-1")

    expect(api.POST).toHaveBeenCalledWith("/api/catalog/categories", {
      body: { name: "Entradas", icon: "Coffee", description: null, active: true },
    })
    expect(api.PATCH).toHaveBeenCalledWith("/api/catalog/categories/{id}", {
      params: { path: { id: "c-1" } },
      body: { active: false },
    })
    expect(api.DELETE).toHaveBeenCalledWith("/api/catalog/categories/{id}", { params: { path: { id: "c-1" } } })
  })

  it("passes the API's 409 through as an ApiError with its message", async () => {
    api.DELETE.mockRejectedValueOnce(new ApiError(409, "Conflict", "Category has dishes"))
    await expect(deleteCategory("c-1")).rejects.toMatchObject({ status: 409, message: "Category has dishes" })
  })
})

describe("dishes", () => {
  it("lists with the category, active and pricing filters", async () => {
    await fetchDishes()
    expect(api.GET).toHaveBeenLastCalledWith("/api/catalog/dishes", { params: { query: {} } })

    await fetchDishes({ categoryId: "c-1", active: true, pricing: "promotions" })
    expect(api.GET).toHaveBeenLastCalledWith("/api/catalog/dishes", {
      params: { query: { categoryId: "c-1", active: "true", pricing: "promotions" } },
    })
  })

  it("creates, updates and deletes with camelCase bodies", async () => {
    api.POST.mockResolvedValueOnce({ data: { id: "d-1" } })
    api.PATCH.mockResolvedValueOnce({ data: { id: "d-1" } })
    const body = { name: "Sopa", price: 12000, categoryId: "c-1", imageUrl: null, active: true, allowComments: true }

    await createDish(body)
    await updateDish("d-1", { price: 13000 })
    await deleteDish("d-1")

    expect(api.POST).toHaveBeenCalledWith("/api/catalog/dishes", { body })
    expect(api.PATCH).toHaveBeenCalledWith("/api/catalog/dishes/{id}", {
      params: { path: { id: "d-1" } },
      body: { price: 13000 },
    })
    expect(api.DELETE).toHaveBeenCalledWith("/api/catalog/dishes/{id}", { params: { path: { id: "d-1" } } })
  })

  it("rejects an empty write response instead of returning undefined", async () => {
    api.POST.mockResolvedValueOnce({ data: undefined })
    await expect(createDish({ name: "Sopa", price: 1, active: true, allowComments: false })).rejects.toBeInstanceOf(ApiError)
  })
})

describe("promotions", () => {
  it("lists, creates, updates and deletes", async () => {
    api.POST.mockResolvedValueOnce({ data: { id: "p-1" } })
    api.PATCH.mockResolvedValueOnce({ data: { id: "p-1" } })
    const body = {
      name: "2x1",
      description: null,
      discountType: "percentage" as const,
      discountValue: 20,
      startDate: "2026-11-01T00:00:00.000Z",
      endDate: "2026-12-01T00:00:00.000Z",
      active: true,
    }

    await fetchPromotions()
    await createPromotion(body)
    await updatePromotion("p-1", { discountValue: 25 })
    await deletePromotion("p-1")

    expect(api.GET).toHaveBeenCalledWith("/api/catalog/promotions")
    expect(api.POST).toHaveBeenCalledWith("/api/catalog/promotions", { body })
    expect(api.PATCH).toHaveBeenCalledWith("/api/catalog/promotions/{id}", {
      params: { path: { id: "p-1" } },
      body: { discountValue: 25 },
    })
    expect(api.DELETE).toHaveBeenCalledWith("/api/catalog/promotions/{id}", { params: { path: { id: "p-1" } } })
  })

  it("reads the assigned dishes and replaces the whole set with one PUT", async () => {
    api.GET.mockResolvedValueOnce({ data: [{ id: "d-1" }] })
    api.PUT.mockResolvedValueOnce({ data: [{ id: "d-2" }] })

    await expect(fetchPromotionDishes("p-1")).resolves.toEqual([{ id: "d-1" }])
    await expect(setPromotionDishes("p-1", ["d-2"])).resolves.toEqual([{ id: "d-2" }])

    expect(api.GET).toHaveBeenCalledWith("/api/catalog/promotions/{id}/dishes", { params: { path: { id: "p-1" } } })
    expect(api.PUT).toHaveBeenCalledTimes(1)
    expect(api.PUT).toHaveBeenCalledWith("/api/catalog/promotions/{id}/dishes", {
      params: { path: { id: "p-1" } },
      body: { dishIds: ["d-2"] },
    })
  })
})
