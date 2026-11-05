import { api } from "./client"
import { ApiError } from "./errors"
import type { components } from "./schema"

/**
 * Catalog through the API (T7b): categories, dishes and promotions as the
 * camelCase DTOs of the generated contract. The server owns the business
 * rules the web used to split with SQL: promotion pricing (`pricing:
 * "promotions"`), the "category has dishes" 409, cascading promotion deletes
 * and the atomic dish set of a promotion.
 */

type Schemas = components["schemas"]
export type CategoryDto = Schemas["Category"]
export type DishDto = Schemas["Dish"]
export type PromotionDto = Schemas["Promotion"]
export type CreateCategoryBody = Schemas["CreateCategoryRequest"]
export type UpdateCategoryBody = Schemas["UpdateCategoryRequest"]
export type CreateDishBody = Schemas["CreateDishRequest"]
export type UpdateDishBody = Schemas["UpdateDishRequest"]
export type CreatePromotionBody = Schemas["CreatePromotionRequest"]
export type UpdatePromotionBody = Schemas["UpdatePromotionRequest"]

/** A 2xx without the body the contract promises. */
function required<T>(data: T | undefined): T {
  if (data === undefined) throw new ApiError(500, "Internal Server Error", "Empty API response")
  return data
}

const flag = (value: boolean | undefined): "true" | "false" | undefined =>
  value === undefined ? undefined : value ? "true" : "false"

/** Drop undefined entries so the query string carries only the given filters. */
function defined<T extends Record<string, unknown>>(query: T): T {
  return Object.fromEntries(Object.entries(query).filter(([, value]) => value !== undefined)) as T
}

const byId = (id: string) => ({ params: { path: { id } } })

// ---- Categories -------------------------------------------------------------

export async function fetchCategories(filter: { active?: boolean } = {}): Promise<CategoryDto[]> {
  const { data } = await api.GET("/api/catalog/categories", {
    params: { query: defined({ active: flag(filter.active) }) },
  })
  return required(data)
}

export async function createCategory(body: CreateCategoryBody): Promise<CategoryDto> {
  const { data } = await api.POST("/api/catalog/categories", { body })
  return required(data)
}

export async function updateCategory(id: string, body: UpdateCategoryBody): Promise<CategoryDto> {
  const { data } = await api.PATCH("/api/catalog/categories/{id}", { ...byId(id), body })
  return required(data)
}

/** Rejects with the API's 409 `Category has dishes` when dishes still reference it. */
export async function deleteCategory(id: string): Promise<void> {
  await api.DELETE("/api/catalog/categories/{id}", byId(id))
}

// ---- Dishes -----------------------------------------------------------------

export interface DishFilter {
  categoryId?: string
  active?: boolean
  /** Apply the best promotion active now, server-side. */
  pricing?: "promotions"
}

/** Dishes ordered by name. */
export async function fetchDishes(filter: DishFilter = {}): Promise<DishDto[]> {
  const { data } = await api.GET("/api/catalog/dishes", {
    params: {
      query: defined({ categoryId: filter.categoryId, active: flag(filter.active), pricing: filter.pricing }),
    },
  })
  return required(data)
}

export async function createDish(body: CreateDishBody): Promise<DishDto> {
  const { data } = await api.POST("/api/catalog/dishes", { body })
  return required(data)
}

export async function updateDish(id: string, body: UpdateDishBody): Promise<DishDto> {
  const { data } = await api.PATCH("/api/catalog/dishes/{id}", { ...byId(id), body })
  return required(data)
}

export async function deleteDish(id: string): Promise<void> {
  await api.DELETE("/api/catalog/dishes/{id}", byId(id))
}

// ---- Promotions -------------------------------------------------------------

/** Every promotion, newest first. */
export async function fetchPromotions(): Promise<PromotionDto[]> {
  const { data } = await api.GET("/api/catalog/promotions")
  return required(data)
}

export async function createPromotion(body: CreatePromotionBody): Promise<PromotionDto> {
  const { data } = await api.POST("/api/catalog/promotions", { body })
  return required(data)
}

export async function updatePromotion(id: string, body: UpdatePromotionBody): Promise<PromotionDto> {
  const { data } = await api.PATCH("/api/catalog/promotions/{id}", { ...byId(id), body })
  return required(data)
}

/** Also removes the promotion's dish assignments, in the same transaction. */
export async function deletePromotion(id: string): Promise<void> {
  await api.DELETE("/api/catalog/promotions/{id}", byId(id))
}

export async function fetchPromotionDishes(id: string): Promise<DishDto[]> {
  const { data } = await api.GET("/api/catalog/promotions/{id}/dishes", byId(id))
  return required(data)
}

/** Replace the promotion's dish set with exactly `dishIds`, atomically. */
export async function setPromotionDishes(id: string, dishIds: string[]): Promise<DishDto[]> {
  const { data } = await api.PUT("/api/catalog/promotions/{id}/dishes", { ...byId(id), body: { dishIds } })
  return required(data)
}
