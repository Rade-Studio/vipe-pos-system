import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * T7b (S3, S4) — the POS menu reads the active categories and the dishes of
 * one category with the promotion pricing the API applies (`pricing:
 * "promotions"`); no promotion rule runs in the browser any more.
 */

const catalog = vi.hoisted(() => ({ fetchCategories: vi.fn(), fetchDishes: vi.fn() }))
vi.mock("@/lib/api/catalog", () => catalog)
vi.mock("@/lib/api/inventory", () => ({ checkStockForDishes: vi.fn() }))

import { fetchMenuCategories, fetchMenuDishes } from "@/hooks/use-menu"

beforeEach(() => {
  catalog.fetchCategories.mockReset()
  catalog.fetchDishes.mockReset()
})

describe("fetchMenuCategories", () => {
  it("reads only the active categories", async () => {
    catalog.fetchCategories.mockResolvedValue([{ id: "c-1", name: "Platos", icon: "Soup", active: true }])
    const categories = await fetchMenuCategories()
    expect(catalog.fetchCategories).toHaveBeenCalledWith({ active: true })
    expect(categories).toEqual([expect.objectContaining({ id: "c-1", name: "Platos", icon: "Soup" })])
  })
})

describe("fetchMenuDishes", () => {
  it("asks the server for active dishes of the category with promotion pricing", async () => {
    catalog.fetchDishes.mockResolvedValue([])
    await fetchMenuDishes("c-1")
    expect(catalog.fetchDishes).toHaveBeenCalledWith({ categoryId: "c-1", active: true, pricing: "promotions" })
  })

  it("returns the server's promoted price and promotion fields untouched", async () => {
    catalog.fetchDishes.mockResolvedValue([
      {
        id: "d-1",
        name: "Bandeja",
        description: null,
        price: 18000,
        categoryId: "c-1",
        imageUrl: "https://img/d-1.png",
        active: true,
        allowComments: true,
        createdAt: null,
        updatedAt: null,
        originalPrice: 20000,
        discountAmount: 2000,
        discountPercentage: 10,
        promotionId: "p-1",
        promotionName: "Martes",
      },
      {
        id: "d-2",
        name: "Sopa",
        description: null,
        price: 9000,
        categoryId: "c-1",
        imageUrl: null,
        active: true,
        allowComments: false,
        createdAt: null,
        updatedAt: null,
      },
    ])

    const [promoted, plain] = await fetchMenuDishes("c-1")

    expect(promoted).toMatchObject({
      id: "d-1",
      price: 18000,
      categoryId: "c-1",
      image: "https://img/d-1.png",
      originalPrice: 20000,
      discountAmount: 2000,
      discountPercentage: 10,
      promotionId: "p-1",
      promotionName: "Martes",
    })
    expect(plain).toMatchObject({ id: "d-2", price: 9000, image: "/placeholder.svg?height=80&width=80" })
    expect(plain.promotionName ?? null).toBeNull()
  })
})
